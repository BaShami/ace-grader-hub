import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import * as path from "https://deno.land/std@0.168.0/path/mod.ts";
import { ZipReader, BlobReader, TextWriter } from "https://deno.land/x/zipjs@v2.7.32/index.js";

// Helper function to extract text from DOCX
async function extractTextFromDocx(fileData: Blob): Promise<string> {
  try {
    const zipReader = new ZipReader(new BlobReader(fileData));
    const entries = await zipReader.getEntries();
    
    // Find the main document content
    const documentEntry = entries.find(e => e.filename === 'word/document.xml');
    if (!documentEntry) {
      throw new Error('No document.xml found in DOCX');
    }
    
    const textWriter = new TextWriter();
    const xmlContent = await documentEntry.getData!(textWriter);
    await zipReader.close();
    
    // Parse XML and extract text - add paragraph breaks where there are paragraph markers
    const withParagraphs = xmlContent
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    return withParagraphs;
  } catch (error) {
    console.error('[process-rubric] DOCX extraction error:', error);
    throw error;
  }
}

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

  let rubricId: string | undefined;
  let serviceClient: any;

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

    // Get user ID from JWT for rate limiting
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      console.error('[process-rubric] Failed to get user:', userError?.message);
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.AUTH_FAILED }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create service client for rate limiting and other operations
    serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check rate limit (10 requests per minute for rubric processing)
    const { data: withinLimit, error: rateLimitError } = await serviceClient.rpc('check_rate_limit', {
      p_user_id: user.id,
      p_endpoint: 'process-rubric',
      p_max_requests: 10
    });

    if (rateLimitError) {
      console.error('[process-rubric] Rate limit check failed:', rateLimitError.message);
    } else if (!withinLimit) {
      console.log('[process-rubric] Rate limit exceeded for user:', user.id);
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please wait a minute before trying again.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify ownership - use user client to respect RLS
    const { data: rubric, error: rubricError } = await userClient
      .from('rubrics')
      .select('user_id, file_path')
      .eq('id', rubricId)
      .single();

    if (rubricError || !rubric) {
      console.error('[process-rubric] Authorization failed:', { rubricId, error: rubricError?.message });
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_FOUND }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // serviceClient already created above for rate limiting

    // Check file metadata before downloading (prevents resource exhaustion)
    const dirPath = path.dirname(filePath);
    const fileName = path.basename(filePath);
    
    const { data: fileList, error: listError } = await serviceClient.storage
      .from('rubrics')
      .list(dirPath, { search: fileName });

    if (listError || !fileList) {
      console.error('[process-rubric] Error listing file:', { error: listError?.message });
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_FOUND }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fileInfo = fileList.find((f: any) => f.name === fileName);
    if (!fileInfo) {
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_FOUND }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check size before download to prevent bandwidth waste
    const fileSize = (fileInfo.metadata as any)?.size || 0;
    if (fileSize > MAX_FILE_SIZE) {
      console.error('[process-rubric] File too large:', { size: fileSize, limit: MAX_FILE_SIZE });
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.FILE_TOO_LARGE }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Now safe to download the file
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from('rubrics')
      .download(filePath);

    if (downloadError) {
      console.error('[process-rubric] Storage download failed:', { error: downloadError?.message });
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.PROCESSING_FAILED }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine file type and extract text accordingly
    const fileExtension = path.extname(filePath).toLowerCase();
    let fileText: string;

    if (fileExtension === '.txt' || fileExtension === '.md') {
      // Plain text files can be read directly
      fileText = await fileData.text();
      console.log('[process-rubric] Read plain text file, length:', fileText.length);
    } else if (fileExtension === '.docx') {
      // Parse DOCX files by extracting XML content
      console.log('[process-rubric] Parsing DOCX file');
      try {
        fileText = await extractTextFromDocx(fileData);
        console.log('[process-rubric] Extracted text from DOCX, length:', fileText.length);
      } catch (docxError) {
        console.error('[process-rubric] DOCX parsing failed:', docxError);
        return new Response(
          JSON.stringify({ error: 'Could not parse DOCX file. Please ensure the file is valid.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (fileExtension === '.pdf') {
      // For PDF files, use AI vision to extract text
      console.log('[process-rubric] Using AI vision to extract text from PDF');
      
      const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
      if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

      // Convert file to base64
      const arrayBuffer = await fileData.arrayBuffer();
      const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      
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
                  text: 'Extract ALL text content from this PDF rubric document. Return ONLY the extracted text, preserving the original structure and formatting. Include all grading criteria, point values, and descriptions exactly as written.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:application/pdf;base64,${base64Data}`
                  }
                }
              ]
            }
          ]
        }),
      });

      if (!extractionResponse.ok) {
        console.error('[process-rubric] PDF text extraction failed:', { status: extractionResponse.status });
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.PROCESSING_FAILED }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const extractionData = await extractionResponse.json();
      fileText = extractionData.choices?.[0]?.message?.content || '';
      console.log('[process-rubric] Extracted text from PDF, length:', fileText.length);
    } else {
      // Unsupported file type
      console.error('[process-rubric] Unsupported file type:', fileExtension);
      return new Response(
        JSON.stringify({ error: 'Unsupported file type. Please upload PDF, DOCX, or TXT files.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!fileText || fileText.length < 20) {
      console.error('[process-rubric] Insufficient text extracted from document');
      return new Response(
        JSON.stringify({ error: 'Could not extract text from document. Please ensure the file is readable.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Validate text length
    if (fileText.length > 100000) {
      console.error('[process-rubric] Text exceeds limit');
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INVALID_INPUT }),
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
      console.error('[process-rubric] AI API error:', { status: aiResponse.status });
      
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

    let criteria: Criterion[] = [];
    
    if (aiData.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments) {
      const parsedArgs = JSON.parse(aiData.choices[0].message.tool_calls[0].function.arguments);
      
      // Validate AI response structure
      try {
        const validated = aiResponseSchema.parse(parsedArgs);
        criteria = validated.criteria;
      } catch (validationError) {
        console.error('[process-rubric] AI response validation failed');
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.AI_ERROR }),
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
      console.error('[process-rubric] Database update failed:', { error: updateError?.message });
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.PROCESSING_FAILED }),
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
      console.error('[process-rubric] Failed to create focus profile:', { error: profileError?.message });
      // Non-fatal error, continue
    }

    return new Response(
      JSON.stringify({ success: true, criteria }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[process-rubric] Error:', { name: error.name, message: error.message });
    
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
