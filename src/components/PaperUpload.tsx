import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileText, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PaperUploadProps {
  onSuccess?: () => void;
}

interface FileWithMeta {
  file: File;
  studentName: string;
  id: string;
}

export function PaperUpload({ onSuccess }: PaperUploadProps) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<FileWithMeta[]>([]);
  const [rubrics, setRubrics] = useState<any[]>([]);
  const [focusProfiles, setFocusProfiles] = useState<any[]>([]);
  const [selectedRubric, setSelectedRubric] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) loadRubrics();
  }, [open]);

  useEffect(() => {
    if (selectedRubric) loadFocusProfiles();
  }, [selectedRubric]);

  const loadRubrics = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("rubrics")
      .select("*")
      .eq("user_id", user.id);
    
    if (!error && data) setRubrics(data);
  };

  const loadFocusProfiles = async () => {
    const { data, error } = await supabase
      .from("focus_profiles")
      .select("*")
      .eq("rubric_id", selectedRubric);
    
    if (!error && data) {
      setFocusProfiles(data);
      const defaultProfile = data.find(p => p.is_default);
      if (defaultProfile) setSelectedProfile(defaultProfile.id);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    
    const validFiles = selectedFiles.filter(file => {
      if (!allowedTypes.includes(file.type)) {
        toast.error(`${file.name}: Only PDF, DOCX, and TXT files are supported`);
        return false;
      }
      return true;
    });

    const newFiles = validFiles.map(file => ({
      file,
      studentName: file.name.replace(/\.[^/.]+$/, ""),
      id: crypto.randomUUID()
    }));

    setFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const updateStudentName = (id: string, name: string) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, studentName: name } : f));
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      toast.error("Please select at least one file");
      return;
    }
    if (!selectedRubric || !selectedProfile) {
      toast.error("Please select a rubric and focus profile");
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const uploadPromises = files.map(async ({ file, studentName }) => {
        const fileExt = file.name.split('.').pop();
        const filePath = `${user.id}/${crypto.randomUUID()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from("submissions")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: submission, error: submissionError } = await supabase
          .from("submissions")
          .insert({
            student_name: studentName,
            file_path: filePath,
            assignment_id: selectedRubric,
            user_id: user.id,
            status: 'pending'
          })
          .select()
          .single();

        if (submissionError) throw submissionError;

        // Trigger grading
        supabase.functions.invoke('grade-submission', {
          body: { 
            submissionId: submission.id,
            focusProfileId: selectedProfile
          }
        });

        return submission;
      });

      await Promise.all(uploadPromises);

      toast.success(`${files.length} paper(s) uploaded! Grading in progress...`);
      setOpen(false);
      setFiles([]);
      setSelectedRubric("");
      setSelectedProfile("");
      onSuccess?.();
    } catch (error: any) {
      console.error("Upload error:", error);
      toast.error(error.message || "Failed to upload papers");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="w-full" disabled={rubrics.length === 0}>
          <Upload className="mr-2 h-5 w-5" />
          Upload Papers
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Student Papers</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Rubric</Label>
            <Select value={selectedRubric} onValueChange={setSelectedRubric}>
              <SelectTrigger>
                <SelectValue placeholder="Select rubric" />
              </SelectTrigger>
              <SelectContent>
                {rubrics.map((rubric) => (
                  <SelectItem key={rubric.id} value={rubric.id}>
                    {rubric.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedRubric && (
            <div>
              <Label>Focus Profile</Label>
              <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                <SelectTrigger>
                  <SelectValue placeholder="Select focus profile" />
                </SelectTrigger>
                <SelectContent>
                  {focusProfiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name} {profile.is_default && "(Default)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="file-upload">Upload Files</Label>
            <div className="mt-2 flex items-center justify-center w-full">
              <label
                htmlFor="file-upload"
                className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-muted/50 hover:bg-muted transition-colors"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="h-8 w-8 mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Drop papers here or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PDF, DOCX, TXT
                  </p>
                </div>
                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.txt"
                  multiple
                  onChange={handleFileChange}
                />
              </label>
            </div>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <Label>Files to Upload ({files.length})</Label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {files.map((fileWithMeta) => (
                  <div key={fileWithMeta.id} className="flex items-center gap-2 p-2 border rounded-lg">
                    <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                    <Input
                      value={fileWithMeta.studentName}
                      onChange={(e) => updateStudentName(fileWithMeta.id, e.target.value)}
                      placeholder="Student name"
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFile(fileWithMeta.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button onClick={handleUpload} disabled={loading || files.length === 0} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              `Upload & Grade ${files.length} Paper${files.length !== 1 ? 's' : ''}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
