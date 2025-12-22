import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { PaperUpload } from "./PaperUpload";
import { FocusSelector } from "./FocusSelector";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Rubric {
  id: string;
  name: string;
  criteria: any;
  created_at: string;
  file_path?: string | null;
}

interface SubjectCardProps {
  subject: {
    id: string;
    name: string;
    color: string;
  };
  rubrics: Rubric[];
  onRefresh: () => void;
}

export function SubjectCard({ subject, rubrics, onRefresh }: SubjectCardProps) {
  const [paperUploadOpen, setPaperUploadOpen] = useState(false);
  const [focusSelectorOpen, setFocusSelectorOpen] = useState(false);
  const [selectedRubricId, setSelectedRubricId] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSelectFocus = (rubricId: string) => {
    setSelectedRubricId(rubricId);
    setFocusSelectorOpen(true);
  };

  const handleDeleteSubject = async () => {
    setIsDeleting(true);
    try {
      // Get all rubric IDs for this subject
      const rubricIds = rubrics.map(r => r.id);

      if (rubricIds.length > 0) {
        // Get all focus profiles for these rubrics
        const { data: focusProfiles } = await supabase
          .from('focus_profiles')
          .select('id')
          .in('rubric_id', rubricIds);

        const focusProfileIds = focusProfiles?.map(fp => fp.id) || [];

        // Get all assignments for these rubrics
        const { data: assignments } = await supabase
          .from('assignments')
          .select('id')
          .in('rubric_id', rubricIds);

        const assignmentIds = assignments?.map(a => a.id) || [];

        if (assignmentIds.length > 0) {
          // Get all submissions for these assignments
          const { data: submissions } = await supabase
            .from('submissions')
            .select('id, file_path')
            .in('assignment_id', assignmentIds);

          const submissionIds = submissions?.map(s => s.id) || [];

          // Delete results for these submissions
          if (submissionIds.length > 0) {
            await supabase
              .from('results')
              .delete()
              .in('submission_id', submissionIds);

            // Delete submission files from storage
            const filePaths = submissions?.map(s => s.file_path).filter(Boolean) || [];
            if (filePaths.length > 0) {
              await supabase.storage.from('submissions').remove(filePaths);
            }

            // Delete submissions
            await supabase
              .from('submissions')
              .delete()
              .in('id', submissionIds);
          }

          // Delete assignments
          await supabase
            .from('assignments')
            .delete()
            .in('id', assignmentIds);
        }

        // Delete focus profiles
        if (focusProfileIds.length > 0) {
          await supabase
            .from('focus_profiles')
            .delete()
            .in('id', focusProfileIds);
        }

        // Delete rubric files from storage
        const rubricFilePaths = rubrics.map(r => r.file_path).filter(Boolean) as string[];
        if (rubricFilePaths.length > 0) {
          await supabase.storage.from('rubrics').remove(rubricFilePaths);
        }

        // Delete rubrics
        await supabase
          .from('rubrics')
          .delete()
          .in('id', rubricIds);
      }

      // Finally delete the subject
      const { error } = await supabase
        .from('subjects')
        .delete()
        .eq('id', subject.id);

      if (error) throw error;

      toast.success(`Subject "${subject.name}" deleted successfully`);
      onRefresh();
    } catch (error: any) {
      console.error('Error deleting subject:', error);
      toast.error('Failed to delete subject');
    } finally {
      setIsDeleting(false);
    }
  };

  const getRubricStatus = (rubric: Rubric) => {
    if (!rubric.criteria || (Array.isArray(rubric.criteria) && rubric.criteria.length === 0)) {
      return "processing";
    }
    return "ready";
  };

  const getCriteriaCount = (rubric: Rubric) => {
    if (Array.isArray(rubric.criteria)) {
      return rubric.criteria.length;
    }
    return 0;
  };

  return (
    <>
      <Card 
        className="hover:shadow-lg transition-all border-l-4 group"
        style={{ borderLeftColor: subject.color }}
      >
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: subject.color }}
              />
              {subject.name}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {rubrics.length} {rubrics.length === 1 ? 'rubric' : 'rubrics'}
              </Badge>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Subject</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete "{subject.name}"? This will also delete all rubrics, assignments, submissions, and grading results associated with this subject. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={handleDeleteSubject}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Rubrics List */}
          {rubrics.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No rubrics yet. Upload one to get started!
            </p>
          ) : (
            <div className="space-y-3">
              {rubrics.map((rubric) => {
                const status = getRubricStatus(rubric);
                return (
                  <div
                    key={rubric.id}
                    className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                          <p className="font-medium text-sm truncate">{rubric.name}</p>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          {status === "processing" ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin text-orange-500" />
                              <span className="text-orange-600">Processing with AI...</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-3 w-3 text-green-500" />
                              <span className="text-green-600">
                                {getCriteriaCount(rubric)} criteria ready
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {status === "ready" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSelectFocus(rubric.id)}
                          className="flex-shrink-0"
                        >
                          Focus
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Upload Papers Button */}
          {rubrics.some(r => getRubricStatus(r) === "ready") && (
            <Button 
              onClick={() => setPaperUploadOpen(true)}
              className="w-full"
              size="lg"
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload Papers for this Subject
            </Button>
          )}

          {rubrics.length > 0 && !rubrics.some(r => getRubricStatus(r) === "ready") && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-50 dark:bg-orange-950/20 text-orange-800 dark:text-orange-200 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>Waiting for AI to process rubrics...</span>
            </div>
          )}
        </CardContent>
      </Card>

      <PaperUpload
        open={paperUploadOpen}
        onOpenChange={setPaperUploadOpen}
        preSelectedSubjectId={subject.id}
        onSuccess={() => {
          onRefresh();
          setPaperUploadOpen(false);
        }}
      />

      <FocusSelector
        rubricId={selectedRubricId}
        open={focusSelectorOpen}
        onOpenChange={setFocusSelectorOpen}
        onSuccess={onRefresh}
      />
    </>
  );
}
