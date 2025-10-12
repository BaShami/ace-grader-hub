import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schema
const requestSchema = z.object({
  rubricId: z.string().uuid(),
  filePath: z.string().min(1).max(500)
});

const criterionSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  weight: z.number().min(0).max(100),
  category: z.string().min(1).max(100)
});

const aiResponseSchema = z.object({
  criteria: z.array(criterionSchema).max(50)
});

type Criterion = z.infer<typeof criterionSchema>;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let rubricId: string | undefined;

  try {
    // Validate input
    const body = await req.json();
    const validatedInput = requestSchema.parse(body);
    rubricId = validatedInput.rubricId;
    const filePath = validatedInput.filePath;

    // Extract user from JWT
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user JWT for authorization
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify ownership - use user client to respect RLS
    const { data: rubric, error: rubricError } = await userClient
      .from('rubrics')
      .select('user_id, file_path')
      .eq('id', rubricId)
      .single();

    if (rubricError || !rubric) {
      console.error('[process-rubric] Authorization failed:', rubricError);
      return new Response(
        JSON.stringify({ error: 'Rubric not found or access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create service client only after ownership verification
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Download the rubric file with size validation
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from('rubrics')
      .download(filePath);

    if (downloadError) {
      console.error('[process-rubric] Storage download failed:', downloadError);
      return new Response(
        JSON.stringify({ error: 'Failed to download rubric file' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate file size
    if (fileData.size > MAX_FILE_SIZE) {
      console.error('[process-rubric] File too large:', fileData.size);
      return new Response(
        JSON.stringify({ error: 'File size exceeds 5MB limit' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fileText = await fileData.text();
    
    // Validate text length
    if (fileText.length > 100000) {
      console.error('[process-rubric] Text too long:', fileText.length);
      return new Response(
        JSON.stringify({ error: 'File content exceeds maximum length' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
      console.error('[process-rubric] AI Error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'AI service rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI service payment required. Please contact support.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'AI processing failed. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();

    let criteria: Criterion[] = [];
    
    if (aiData.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments) {
      const parsedArgs = JSON.parse(aiData.choices[0].message.tool_calls[0].function.arguments);
      
      // Validate AI response structure
      try {
        const validated = aiResponseSchema.parse(parsedArgs);
        criteria = validated.criteria;
      } catch (validationError) {
        console.error('[process-rubric] AI response validation failed:', validationError);
        return new Response(
          JSON.stringify({ error: 'Invalid AI response format' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Update rubric with extracted criteria (using service client after ownership verified)
    const { error: updateError } = await serviceClient
      .from('rubrics')
      .update({ criteria })
      .eq('id', rubricId);

    if (updateError) {
      console.error('[process-rubric] Database update failed:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save rubric criteria' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create default focus profile with all criteria selected
    const selectedCriteria = criteria.map((c) => c.id);
    
    const { error: profileError } = await serviceClient
      .from('focus_profiles')
      .insert({
        name: 'All Criteria',
        rubric_id: rubricId,
        user_id: rubric.user_id,
        selected_criteria: selectedCriteria,
        is_default: true
      });

    if (profileError) {
      console.error('[process-rubric] Failed to create focus profile:', profileError);
      // Non-fatal error, continue
    }

    return new Response(
      JSON.stringify({ success: true, criteria }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[process-rubric] Error:', error);
    
    // Handle validation errors
    if (error.name === 'ZodError') {
      return new Response(
        JSON.stringify({ 
          error: 'Invalid input parameters',
          code: 'VALIDATION_ERROR'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Generic error response
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process rubric. Please try again.',
        code: 'PROCESSING_ERROR'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
