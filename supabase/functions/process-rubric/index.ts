import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { rubricId, filePath } = await req.json();

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Download the rubric file
    const { data: fileData, error: downloadError } = await supabaseClient.storage
      .from('rubrics')
      .download(filePath);

    if (downloadError) throw downloadError;

    const fileText = await fileData.text();

    // Call Lovable AI to extract criteria
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at analyzing educational rubrics. Extract all grading criteria from the rubric and return them as a structured JSON array. Each criterion should have: name, description, weight (points), and category.'
          },
          {
            role: 'user',
            content: `Extract all grading criteria from this rubric:\n\n${fileText}\n\nReturn ONLY a JSON object with this structure: {"criteria": [{"id": "unique_id", "name": "criterion name", "description": "what this measures", "weight": 5, "category": "Content/Style/Mechanics"}]}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_criteria",
              description: "Extract grading criteria from a rubric",
              parameters: {
                type: "object",
                properties: {
                  criteria: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        description: { type: "string" },
                        weight: { type: "number" },
                        category: { type: "string" }
                      },
                      required: ["id", "name", "description", "weight", "category"],
                      additionalProperties: false
                    }
                  }
                },
                required: ["criteria"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_criteria" } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI Error:', aiResponse.status, errorText);
      throw new Error(`AI processing failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    console.log('AI Response:', JSON.stringify(aiData, null, 2));

    let criteria = [];
    
    if (aiData.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments) {
      const parsedArgs = JSON.parse(aiData.choices[0].message.tool_calls[0].function.arguments);
      criteria = parsedArgs.criteria || [];
    }

    // Update rubric with extracted criteria
    const { error: updateError } = await supabaseClient
      .from('rubrics')
      .update({ criteria })
      .eq('id', rubricId);

    if (updateError) throw updateError;

    // Create default focus profile with all criteria selected
    const { data: rubricData } = await supabaseClient
      .from('rubrics')
      .select('user_id')
      .eq('id', rubricId)
      .single();

    if (rubricData) {
      const selectedCriteria = criteria.map((c: any) => c.id);
      
      await supabaseClient
        .from('focus_profiles')
        .insert({
          name: 'All Criteria',
          rubric_id: rubricId,
          user_id: rubricData.user_id,
          selected_criteria: selectedCriteria,
          is_default: true
        });
    }

    return new Response(
      JSON.stringify({ success: true, criteria }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Process rubric error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
