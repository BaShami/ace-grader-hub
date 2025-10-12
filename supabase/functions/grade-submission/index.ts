import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schemas
const requestSchema = z.object({
  submissionId: z.string().uuid(),
  focusProfileId: z.string().uuid()
});

const criterionScoreSchema = z.object({
  criterion_id: z.string().max(100),
  score: z.number().min(0).max(100),
  rationale: z.string().max(2000),
  evidence: z.array(z.string().max(500)).max(10)
});

const aiGradingResponseSchema = z.object({
  criteria_scores: z.array(criterionScoreSchema).max(50),
  strengths: z.array(z.string().max(500)).max(10),
  improvements: z.array(z.string().max(500)).max(10),
  confidence: z.enum(['low', 'medium', 'high'])
});

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_LENGTH = 200000; // 200k chars - more reasonable for academic papers

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let submissionId: string | undefined;
  let serviceClient: any;

  try {
    // Validate input
    const body = await req.json();
    const validatedInput = requestSchema.parse(body);
    submissionId = validatedInput.submissionId;
    const focusProfileId = validatedInput.focusProfileId;

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
    const { data: submission, error: submissionError } = await userClient
      .from('submissions')
      .select('user_id, file_path, assignment_id, status')
      .eq('id', submissionId)
      .single();

    if (submissionError || !submission) {
      console.error('[grade-submission] Authorization failed:', submissionError);
      return new Response(
        JSON.stringify({ error: 'Submission not found or access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create service client only after ownership verification
    serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Update submission status to processing
    await serviceClient
      .from('submissions')
      .update({ status: 'processing' })
      .eq('id', submissionId);

    // Fetch rubric and focus profile (verify ownership through user client)
    const { data: focusProfile, error: focusError } = await userClient
      .from('focus_profiles')
      .select('selected_criteria, rubric_id')
      .eq('id', focusProfileId)
      .single();

    if (focusError || !focusProfile) {
      console.error('[grade-submission] Focus profile not found:', focusError);
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: 'Focus profile not found or access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get rubric data
    const { data: rubric, error: rubricError } = await userClient
      .from('rubrics')
      .select('name, criteria')
      .eq('id', focusProfile.rubric_id)
      .single();

    if (rubricError || !rubric) {
      console.error('[grade-submission] Rubric not found:', rubricError);
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: 'Rubric not found or access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter criteria based on focus profile
    const allCriteria = rubric.criteria as any[];
    const selectedCriteria = allCriteria.filter(c => 
      (focusProfile.selected_criteria as string[]).includes(c.id)
    );

    // Download the submission file with size validation
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from('submissions')
      .download(submission.file_path);

    if (downloadError) {
      console.error('[grade-submission] Storage download failed:', downloadError);
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: 'Failed to download submission file' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate file size
    if (fileData.size > MAX_FILE_SIZE) {
      console.error('[grade-submission] File too large:', fileData.size);
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: 'File size exceeds 10MB limit' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const submissionText = await fileData.text();
    
    // Intelligently truncate if text is too long
    let processedText = submissionText;
    if (submissionText.length > MAX_TEXT_LENGTH) {
      console.log('[grade-submission] Text too long, truncating intelligently:', submissionText.length);
      
      // Keep first 60% and last 20% of the text to preserve intro and conclusion
      const keepFirst = Math.floor(MAX_TEXT_LENGTH * 0.7);
      const keepLast = Math.floor(MAX_TEXT_LENGTH * 0.3);
      
      const firstPart = submissionText.substring(0, keepFirst);
      const lastPart = submissionText.substring(submissionText.length - keepLast);
      
      processedText = firstPart + '\n\n[... middle section truncated due to length ...]\n\n' + lastPart;
      
      console.log('[grade-submission] Truncated to:', processedText.length);
    }

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
            content: `Rubric: ${rubric.name}\n\nFocus on these criteria ONLY:\n${criteriaContext}\n\nStudent submission:\n${processedText}\n\nProvide scores, rationale, and evidence for each criterion. Also identify 2-3 key strengths and 2-3 areas for improvement.`
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
      console.error('[grade-submission] AI Error:', aiResponse.status, errorText);
      
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
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
        JSON.stringify({ error: 'AI grading failed. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();

    let gradingResult: z.infer<typeof aiGradingResponseSchema>;
    
    if (aiData.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments) {
      const rawResult = JSON.parse(aiData.choices[0].message.tool_calls[0].function.arguments);
      
      // Validate AI response structure
      try {
        gradingResult = aiGradingResponseSchema.parse(rawResult);
      } catch (validationError) {
        console.error('[grade-submission] AI response validation failed:', validationError);
        await serviceClient
          .from('submissions')
          .update({ status: 'error' })
          .eq('id', submissionId);
        
        return new Response(
          JSON.stringify({ error: 'Invalid AI grading response format' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      console.error('[grade-submission] No AI response data');
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: 'Invalid AI response format' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate overall score
    const totalScore = gradingResult.criteria_scores.reduce((sum, cs) => sum + cs.score, 0);
    const maxScore = selectedCriteria.reduce((sum, c) => sum + c.weight, 0);
    const overallScore = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

    // Store grading results
    const { error: resultError } = await serviceClient
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

    if (resultError) {
      console.error('[grade-submission] Failed to store results:', resultError);
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: 'Failed to store grading results' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update submission status
    await serviceClient
      .from('submissions')
      .update({ status: 'graded' })
      .eq('id', submissionId);

    return new Response(
      JSON.stringify({ success: true, overallScore }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[grade-submission] Error:', error);
    
    // Update submission status to error if we have the ID
    if (submissionId && serviceClient) {
      try {
        await serviceClient
          .from('submissions')
          .update({ status: 'error' })
          .eq('id', submissionId);
      } catch (updateError) {
        console.error('[grade-submission] Failed to update error status:', updateError);
      }
    }
    
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
        error: 'Failed to grade submission. Please try again.',
        code: 'GRADING_ERROR'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
