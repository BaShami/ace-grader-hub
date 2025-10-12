import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface RubricUploadProps {
  onSuccess?: () => void;
}

export function RubricUpload({ onSuccess }: RubricUploadProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [subjectId, setSubjectId] = useState<string>("");
  const [newSubjectName, setNewSubjectName] = useState("");
  const [rubricName, setRubricName] = useState("");
  const [subjects, setSubjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createNew, setCreateNew] = useState(false);

  const loadSubjects = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("subjects")
      .select("*")
      .eq("user_id", user.id);
    
    if (!error && data) setSubjects(data);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) loadSubjects();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown'];
      if (!allowedTypes.includes(selectedFile.type)) {
        toast.error("Please upload PDF, DOCX, TXT, or MD files only");
        return;
      }
      setFile(selectedFile);
      if (!rubricName) setRubricName(selectedFile.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleUpload = async () => {
    if (!file || !rubricName) {
      toast.error("Please select a file and enter a rubric name");
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      let finalSubjectId = subjectId;

      // Create new subject if needed
      if (createNew && newSubjectName) {
        const { data: newSubject, error: subjectError } = await supabase
          .from("subjects")
          .insert({ name: newSubjectName, user_id: user.id })
          .select()
          .single();
        
        if (subjectError) throw subjectError;
        finalSubjectId = newSubject.id;
      }

      if (!finalSubjectId) {
        toast.error("Please select or create a subject");
        setLoading(false);
        return;
      }

      // Upload file to storage
      const fileExt = file.name.split('.').pop();
      const filePath = `${user.id}/${crypto.randomUUID()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("rubrics")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Create rubric record
      const { data: rubric, error: rubricError } = await supabase
        .from("rubrics")
        .insert({
          name: rubricName,
          subject_id: finalSubjectId,
          user_id: user.id,
          file_path: filePath,
          criteria: []
        })
        .select()
        .single();

      if (rubricError) throw rubricError;

      // Call edge function to process rubric
      toast.info("Processing rubric with AI...");
      
      const { data: processData, error: processError } = await supabase.functions.invoke('process-rubric', {
        body: { rubricId: rubric.id, filePath }
      });

      if (processError) throw processError;

      toast.success("Rubric uploaded and processed successfully!");
      setOpen(false);
      setFile(null);
      setRubricName("");
      setSubjectId("");
      setNewSubjectName("");
      setCreateNew(false);
      onSuccess?.();
    } catch (error: any) {
      console.error("Upload error:", error);
      toast.error(error.message || "Failed to upload rubric");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="lg" className="w-full">
          <Upload className="mr-2 h-5 w-5" />
          Upload Rubric
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Upload Rubric</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="rubric-name">Rubric Name</Label>
            <Input
              id="rubric-name"
              value={rubricName}
              onChange={(e) => setRubricName(e.target.value)}
              placeholder="Essay Rubric"
            />
          </div>

          <div>
            <Label>Subject</Label>
            {!createNew ? (
              <div className="space-y-2">
                <Select value={subjectId} onValueChange={setSubjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((subject) => (
                      <SelectItem key={subject.id} value={subject.id}>
                        {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateNew(true)}
                  className="w-full"
                >
                  + Create New Subject
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="New subject name"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateNew(false)}
                  className="w-full"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="file-upload">Upload File</Label>
            <div className="mt-2 flex items-center justify-center w-full">
              <label
                htmlFor="file-upload"
                className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-muted/50 hover:bg-muted transition-colors"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  {file ? (
                    <>
                      <FileText className="h-8 w-8 mb-2 text-primary" />
                      <p className="text-sm text-muted-foreground">{file.name}</p>
                    </>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Drop rubric here or click to browse
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        PDF, DOCX, TXT, MD
                      </p>
                    </>
                  )}
                </div>
                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.txt,.md"
                  onChange={handleFileChange}
                />
              </label>
            </div>
          </div>

          <Button onClick={handleUpload} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Upload & Process"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
