-- Create storage buckets for rubrics and submissions
INSERT INTO storage.buckets (id, name, public) VALUES 
  ('rubrics', 'rubrics', false),
  ('submissions', 'submissions', false);

-- RLS policies for rubrics bucket - users can only access their own rubric files
CREATE POLICY "Users can upload their own rubrics"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'rubrics' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own rubrics"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'rubrics' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own rubrics"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'rubrics' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- RLS policies for submissions bucket - users can only access their own submission files
CREATE POLICY "Users can upload their own submissions"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'submissions' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own submissions"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'submissions' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own submissions"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'submissions' AND
  auth.uid()::text = (storage.foldername(name))[1]
);