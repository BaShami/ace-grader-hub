import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import * as path from "https://deno.land/std@0.168.0/path/mod.ts";

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

// Generic error messages to avoid information leakage
const ERROR_MESSAGES = {
  AUTH_FAILED: 'Authentication required',
  NOT_FOUND: 'Resource not found',
  INVALID_INPUT: 'Invalid request',
  PROCESSING_FAILED: 'Processing failed',
  AI_ERROR: 'Service temporarily unavailable',
  FILE_TOO_LARGE: 'File size exceeds limit'
};

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
        JSON.stringify({ error: ERROR_MESSAGES.AUTH_FAILED }),
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
      console.error('[grade-submission] Authorization failed:', { submissionId, error: submissionError?.message });
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_FOUND }),
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
      console.error('[grade-submission] Focus profile not found:', { focusProfileId, error: focusError?.message });
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_FOUND }),
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
      console.error('[grade-submission] Rubric not found:', { error: rubricError?.message });
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_FOUND }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter criteria based on focus profile
    const allCriteria = rubric.criteria as any[];
    const selectedCriteria = allCriteria.filter(c => 
      (focusProfile.selected_criteria as string[]).includes(c.id)
    );

    // Check file metadata before downloading (prevents resource exhaustion)
    const dirPath = path.dirname(submission.file_path);
    const fileName = path.basename(submission.file_path);
    
    const { data: fileList, error: listError } = await serviceClient.storage
      .from('submissions')
      .list(dirPath, { search: fileName });

    if (listError || !fileList) {
      console.error('[grade-submission] Error listing file:', { error: listError?.message });
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_FOUND }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fileInfo = fileList.find((f: any) => f.name === fileName);
    if (!fileInfo) {
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_FOUND }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check size before download to prevent bandwidth waste
    const fileSize = (fileInfo.metadata as any)?.size || 0;
    if (fileSize > MAX_FILE_SIZE) {
      console.error('[grade-submission] File too large:', { size: fileSize, limit: MAX_FILE_SIZE });
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.FILE_TOO_LARGE }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Now safe to download the file
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from('submissions')
      .download(submission.file_path);

    if (downloadError) {
      console.error('[grade-submission] Storage download failed:', { error: downloadError?.message });
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.PROCESSING_FAILED }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine file type and extract text accordingly
    const fileExtension = path.extname(submission.file_path).toLowerCase();
    let submissionText: string;

    if (fileExtension === '.txt' || fileExtension === '.md') {
      // Plain text files can be read directly
      submissionText = await fileData.text();
      console.log('[grade-submission] Read plain text file, length:', submissionText.length);
    } else {
      // For PDF and DOCX, use Lovable AI vision to extract text
      console.log('[grade-submission] Using AI vision to extract text from:', fileExtension);
      
      const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
      if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

      // Convert file to base64
      const arrayBuffer = await fileData.arrayBuffer();
      const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      
      // Determine MIME type
      let mimeType = 'application/octet-stream';
      if (fileExtension === '.pdf') mimeType = 'application/pdf';
      else if (fileExtension === '.docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      
      const extractionResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-pro',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Extract ALL text content from this document. Return ONLY the extracted text, preserving the original structure and formatting as much as possible. Do not summarize or interpret - just extract the complete text verbatim.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64Data}`
                  }
                }
              ]
            }
          ]
        }),
      });

      if (!extractionResponse.ok) {
        console.error('[grade-submission] Text extraction failed:', { status: extractionResponse.status });
        await serviceClient
          .from('submissions')
          .update({ status: 'error' })
          .eq('id', submissionId);
        
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.PROCESSING_FAILED }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const extractionData = await extractionResponse.json();
      submissionText = extractionData.choices?.[0]?.message?.content || '';
      console.log('[grade-submission] Extracted text from document, length:', submissionText.length);
      
      if (!submissionText || submissionText.length < 50) {
        console.error('[grade-submission] Insufficient text extracted from document');
        await serviceClient
          .from('submissions')
          .update({ status: 'error' })
          .eq('id', submissionId);
        
        return new Response(
          JSON.stringify({ error: 'Could not extract text from document. Please ensure the file is readable.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    
    // Intelligently truncate if text is too long
    let processedText = submissionText;
    if (submissionText.length > MAX_TEXT_LENGTH) {
      console.log('[grade-submission] Text exceeds limit, truncating');
      
      // Keep first 60% and last 20% of the text to preserve intro and conclusion
      const keepFirst = Math.floor(MAX_TEXT_LENGTH * 0.7);
      const keepLast = Math.floor(MAX_TEXT_LENGTH * 0.3);
      
      const firstPart = submissionText.substring(0, keepFirst);
      const lastPart = submissionText.substring(submissionText.length - keepLast);
      
      processedText = firstPart + '\n\n[... middle section truncated due to length ...]\n\n' + lastPart;
    }

    // Call Lovable AI to grade
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const criteriaContext = selectedCriteria.map(c => 
      `- ${c.name} (Max ${c.weight} points): ${c.description}`
    ).join('\n');

    const totalMaxPoints = selectedCriteria.reduce((sum, c) => sum + c.weight, 0);

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
            content: `You are an experienced teacher providing detailed, constructive feedback on student work. Your goal is to help students understand exactly what they did well and what they need to improve.

GRADING INSTRUCTIONS:
1. Read the entire submission carefully before scoring.
2. For EACH criterion, you MUST:
   - Assign a score from 0 to the maximum points for that criterion
   - Write a specific rationale explaining WHY you gave that score (not generic statements)
   - Quote 2-3 specific passages from the student's work as evidence (use exact quotes with quotation marks)
   
3. Your rationale should reference SPECIFIC parts of the submission. Avoid vague statements like "good work" or "needs improvement."

4. For evidence, copy EXACT quotes from the student text that support your score. These quotes prove your assessment is based on the actual content.

5. Strengths should highlight specific things the student did well with examples.

6. Improvements should be actionable - tell the student exactly what to do differently next time.

SCORING GUIDELINES:
- Full points (90-100%): Exceeds expectations, demonstrates mastery
- Most points (70-89%): Meets expectations with minor issues
- Half points (50-69%): Partially meets expectations, significant gaps
- Few points (25-49%): Below expectations, major issues
- Minimal points (0-24%): Does not meet expectations`
          },
          {
            role: 'user',
            content: `RUBRIC: ${rubric.name}
TOTAL POSSIBLE POINTS: ${totalMaxPoints}

GRADING CRITERIA (grade ONLY these):
${criteriaContext}

---
STUDENT SUBMISSION:
---
${processedText}
---

Grade this submission using the criteria above. For each criterion:
1. Use the criterion's id field as the criterion_id
2. Score from 0 to the max points listed
3. Explain your score with specific references to the student's work
4. Include 2-3 direct quotes from the submission as evidence

Then identify 2-3 specific strengths (things done well with examples) and 2-3 specific areas for improvement (actionable suggestions).`
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
      console.error('[grade-submission] AI API error:', { status: aiResponse.status });
      
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.AI_ERROR }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.AI_ERROR }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.AI_ERROR }),
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
        console.error('[grade-submission] AI response validation failed');
        await serviceClient
          .from('submissions')
          .update({ status: 'error' })
          .eq('id', submissionId);
        
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.AI_ERROR }),
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
        JSON.stringify({ error: ERROR_MESSAGES.AI_ERROR }),
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
      console.error('[grade-submission] Failed to store results:', { error: resultError?.message });
      await serviceClient
        .from('submissions')
        .update({ status: 'error' })
        .eq('id', submissionId);
      
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.PROCESSING_FAILED }),
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
    console.error('[grade-submission] Error:', { name: error.name, message: error.message });
    
    // Update submission status to error if we have the ID
    if (submissionId && serviceClient) {
      try {
        await serviceClient
          .from('submissions')
          .update({ status: 'error' })
          .eq('id', submissionId);
      } catch (updateError: any) {
        console.error('[grade-submission] Failed to update error status:', { error: updateError?.message });
      }
    }
    
    // Handle validation errors
    if (error.name === 'ZodError') {
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INVALID_INPUT }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Generic error response
    return new Response(
      JSON.stringify({ error: ERROR_MESSAGES.PROCESSING_FAILED }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
