-- Create rate_limits table for tracking API usage
CREATE TABLE public.rate_limits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  window_minute TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create unique constraint for user+endpoint+window combination
CREATE UNIQUE INDEX rate_limits_user_endpoint_window_idx 
ON public.rate_limits (user_id, endpoint, window_minute);

-- Create index for cleanup queries
CREATE INDEX rate_limits_created_at_idx ON public.rate_limits (created_at);

-- Enable RLS
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Create function to check and increment rate limit
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id UUID,
  p_endpoint TEXT,
  p_max_requests INTEGER DEFAULT 10
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count INTEGER;
  v_window_minute TEXT;
BEGIN
  -- Use text representation of the current minute as window key
  v_window_minute := to_char(now(), 'YYYY-MM-DD-HH24-MI');
  
  -- Try to insert or update the rate limit record
  INSERT INTO public.rate_limits (user_id, endpoint, window_minute, request_count)
  VALUES (p_user_id, p_endpoint, v_window_minute, 1)
  ON CONFLICT (user_id, endpoint, window_minute)
  DO UPDATE SET request_count = rate_limits.request_count + 1
  RETURNING request_count INTO v_current_count;
  
  -- Return true if within limit, false if exceeded
  RETURN v_current_count <= p_max_requests;
END;
$$;

-- Create function to clean up old rate limit records
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limits 
  WHERE created_at < now() - INTERVAL '1 hour';
END;
$$;