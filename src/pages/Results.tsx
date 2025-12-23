import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RetryGradingButton } from "@/components/RetryGradingButton";

export default function Results() {
  const navigate = useNavigate();
  const [results, setResults] = useState<any[]>([]);
  const [pendingSubmissions, setPendingSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadResults();
    loadPendingSubmissions();
    
    // Poll for updates every 5 seconds
    const interval = setInterval(() => {
      loadResults();
      loadPendingSubmissions();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadResults = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("results")
        .select(`
          *,
          submissions!inner(
            student_name,
            status,
            created_at,
            file_path,
            assignment_id,
            assignments!inner(focus_profile_id)
          )
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setResults(data || []);
    } catch (error: any) {
      console.error("Load results error:", error);
      toast.error("Failed to load results");
    } finally {
      setLoading(false);
    }
  };

  const loadPendingSubmissions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("submissions")
        .select(`
          id, 
          student_name, 
          status, 
          created_at,
          file_path,
          assignment_id,
          assignments!inner(focus_profile_id)
        `)
        .eq("user_id", user.id)
        .in("status", ["pending", "processing", "error"])
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPendingSubmissions(data || []);
    } catch (error: any) {
      console.error("Load pending submissions error:", error);
    }
  };

  const handleDeleteSubmission = async (submissionId: string, filePath: string) => {
    try {
      // Delete file from storage
      if (filePath) {
        await supabase.storage.from('submissions').remove([filePath]);
      }

      // Delete any associated result
      await supabase.from('results').delete().eq('submission_id', submissionId);

      // Delete submission
      await supabase.from('submissions').delete().eq('id', submissionId);

      toast.success("Paper deleted successfully");
      loadPendingSubmissions();
      loadResults();
    } catch (error: any) {
      console.error("Delete submission error:", error);
      toast.error("Failed to delete paper");
    }
  };

  const handleDeleteResult = async (resultId: string, submissionId: string) => {
    try {
      // Get the submission file path first
      const { data: submission } = await supabase
        .from('submissions')
        .select('file_path')
        .eq('id', submissionId)
        .single();

      // Delete file from storage
      if (submission?.file_path) {
        await supabase.storage.from('submissions').remove([submission.file_path]);
      }

      // Delete result
      await supabase.from('results').delete().eq('id', resultId);

      // Delete submission
      await supabase.from('submissions').delete().eq('id', submissionId);

      toast.success("Paper deleted successfully");
      loadResults();
    } catch (error: any) {
      console.error("Delete result error:", error);
      toast.error("Failed to delete paper");
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return "bg-green-500";
    if (score >= 70) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getConfidenceBadge = (confidence: string) => {
    const colors = {
      high: "bg-green-100 text-green-800",
      medium: "bg-yellow-100 text-yellow-800",
      low: "bg-red-100 text-red-800"
    };
    return colors[confidence as keyof typeof colors] || colors.medium;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h1 className="text-3xl font-bold">Grading Results</h1>
          </div>
        </div>

        {/* Pending Submissions Progress */}
        {pendingSubmissions.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Grading in Progress ({pendingSubmissions.length} paper{pendingSubmissions.length > 1 ? 's' : ''})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {pendingSubmissions.map((submission) => (
                  <div key={submission.id} className="space-y-2">
                    <div className="flex items-center justify-between text-sm gap-2">
                      <span className="font-medium flex-1">{submission.student_name}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={submission.status === 'error' ? 'destructive' : 'secondary'}>
                          {submission.status === 'error' ? 'Failed' : 'Processing...'}
                        </Badge>
                        {submission.status === 'error' && (
                          <>
                            <RetryGradingButton
                              submissionId={submission.id}
                              focusProfileId={(submission.assignments as any)?.focus_profile_id}
                              onSuccess={() => {
                                loadPendingSubmissions();
                                loadResults();
                              }}
                            />
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Failed Paper?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently delete "{submission.student_name}" and cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction 
                                    onClick={() => handleDeleteSubmission(submission.id, submission.file_path)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                      </div>
                    </div>
                    {submission.status !== 'error' && <Progress value={undefined} className="h-2" />}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {results.length === 0 && pendingSubmissions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No results yet. Upload and grade papers to see results here.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {results.map((result) => (
              <Card
                key={result.id}
                className="hover:shadow-lg transition-shadow"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 cursor-pointer" onClick={() => navigate(`/results/${result.id}`)}>
                      <CardTitle className="text-xl">
                        {(result.submissions as any).student_name}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {new Date((result.submissions as any).created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-end gap-2">
                        <div className={`${getScoreColor(result.overall_score)} text-white px-4 py-2 rounded-lg font-bold text-xl`}>
                          {Math.round(result.overall_score)}%
                        </div>
                        <Badge className={getConfidenceBadge(result.confidence)}>
                          {result.confidence} confidence
                        </Badge>
                      </div>
                      <div className="flex flex-col gap-1">
                        <RetryGradingButton
                          submissionId={result.submission_id}
                          focusProfileId={(result.submissions as any).assignments?.focus_profile_id}
                          onSuccess={() => {
                            loadResults();
                            loadPendingSubmissions();
                          }}
                        />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Graded Paper?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete "{(result.submissions as any).student_name}" and its grading results. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => handleDeleteResult(result.id, result.submission_id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="cursor-pointer" onClick={() => navigate(`/results/${result.id}`)}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-semibold text-sm mb-2 text-green-600">Strengths</h4>
                      <ul className="text-sm space-y-1">
                        {(result.strengths as string[]).slice(0, 2).map((strength, i) => (
                          <li key={i} className="text-muted-foreground">• {strength}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm mb-2 text-yellow-600">Areas to Improve</h4>
                      <ul className="text-sm space-y-1">
                        {(result.improvements as string[]).slice(0, 2).map((improvement, i) => (
                          <li key={i} className="text-muted-foreground">• {improvement}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
