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
    const { submissionId, focusProfileId } = await req.json();

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Update submission status
    await supabaseClient
      .from('submissions')
      .update({ status: 'processing' })
      .eq('id', submissionId);

    // Get submission details
    const { data: submission, error: submissionError } = await supabaseClient
      .from('submissions')
      .select('*, assignments!inner(rubric_id)')
      .eq('id', submissionId)
      .single();

    if (submissionError) throw submissionError;

    // Get rubric and focus profile
    const { data: rubric } = await supabaseClient
      .from('rubrics')
      .select('name, criteria')
      .eq('id', (submission.assignments as any).rubric_id)
      .single();

    const { data: profile } = await supabaseClient
      .from('focus_profiles')
      .select('selected_criteria')
      .eq('id', focusProfileId)
      .single();

    if (!rubric || !profile) throw new Error('Rubric or profile not found');

    // Filter criteria based on focus profile
    const allCriteria = rubric.criteria as any[];
    const selectedCriteria = allCriteria.filter(c => 
      (profile.selected_criteria as string[]).includes(c.id)
    );

    // Download submission file
    const { data: fileData, error: downloadError } = await supabaseClient.storage
      .from('submissions')
      .download(submission.file_path);

    if (downloadError) throw downloadError;

    const submissionText = await fileData.text();

    // Call Lovable AI to grade
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const criteriaContext = selectedCriteria.map(c => 
      `${c.name} (${c.weight} points): ${c.description}`
    ).join('\n');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5',
        messages: [
          {
            role: 'system',
            content: `You are an expert teacher grading student work. Grade ONLY based on the provided criteria. For each criterion, provide a score (0 to max points), rationale (2-3 sentences), and relevant evidence quotes from the text.`
          },
          {
            role: 'user',
            content: `Rubric: ${rubric.name}\n\nFocus on these criteria ONLY:\n${criteriaContext}\n\nStudent submission:\n${submissionText}\n\nProvide scores, rationale, and evidence for each criterion. Also identify 2-3 key strengths and 2-3 areas for improvement.`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "grade_submission",
              description: "Grade a student submission based on rubric criteria",
              parameters: {
                type: "object",
                properties: {
                  criteria_scores: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        criterion_id: { type: "string" },
                        score: { type: "number" },
                        rationale: { type: "string" },
                        evidence: { type: "array", items: { type: "string" } }
                      },
                      required: ["criterion_id", "score", "rationale", "evidence"]
                    }
                  },
                  strengths: {
                    type: "array",
                    items: { type: "string" }
                  },
                  improvements: {
                    type: "array",
                    items: { type: "string" }
                  },
                  confidence: {
                    type: "string",
                    enum: ["high", "medium", "low"]
                  }
                },
                required: ["criteria_scores", "strengths", "improvements", "confidence"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "grade_submission" } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI Error:', aiResponse.status, errorText);
      throw new Error(`AI grading failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    console.log('AI Response:', JSON.stringify(aiData, null, 2));

    let gradingResult;
    if (aiData.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments) {
      gradingResult = JSON.parse(aiData.choices[0].message.tool_calls[0].function.arguments);
    } else {
      throw new Error('Invalid AI response format');
    }

    // Calculate overall score
    const totalScore = gradingResult.criteria_scores.reduce((sum: number, cs: any) => sum + cs.score, 0);
    const maxScore = selectedCriteria.reduce((sum: number, c: any) => sum + c.weight, 0);
    const overallScore = (totalScore / maxScore) * 100;

    // Store result
    const { error: resultError } = await supabaseClient
      .from('results')
      .insert({
        submission_id: submissionId,
        user_id: submission.user_id,
        overall_score: overallScore,
        criteria_scores: gradingResult.criteria_scores,
        strengths: gradingResult.strengths,
        improvements: gradingResult.improvements,
        confidence: gradingResult.confidence,
        flags: []
      });

    if (resultError) throw resultError;

    // Update submission status
    await supabaseClient
      .from('submissions')
      .update({ status: 'graded' })
      .eq('id', submissionId);

    return new Response(
      JSON.stringify({ success: true, overallScore }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Grade submission error:', error);
    
    // Update submission status to error
    const { submissionId } = await req.json();
    if (submissionId) {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await supabaseClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
    }

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
