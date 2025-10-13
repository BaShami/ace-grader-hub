import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Loader2, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";

export default function ResultDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<any>(null);
  const [rubric, setRubric] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [breakdownOpen, setBreakdownOpen] = useState(true);

  useEffect(() => {
    loadResult();
  }, [id]);

  const loadResult = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: resultData, error: resultError } = await supabase
        .from("results")
        .select(`
          *,
          submissions!inner(
            student_name,
            created_at,
            assignment_id,
            file_path,
            assignments!inner(
              rubric_id
            )
          )
        `)
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (resultError) throw resultError;

      const rubricId = (resultData.submissions as any).assignments.rubric_id;
      const { data: rubricData } = await supabase
        .from("rubrics")
        .select("name, criteria")
        .eq("id", rubricId)
        .single();

      setResult(resultData);
      setRubric(rubricData);
    } catch (error: any) {
      console.error("Load result error:", error);
      toast.error("Failed to load result");
      navigate("/results");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!result) return;
    
    setDeleting(true);
    try {
      const submission = result.submissions as any;
      const filePath = submission.file_path;

      // Delete from storage
      if (filePath) {
        await supabase.storage.from('submissions').remove([filePath]);
      }

      // Delete result
      await supabase.from('results').delete().eq('id', id);

      // Delete submission
      await supabase.from('submissions').delete().eq('id', result.submission_id);

      toast.success("Result deleted successfully");
      navigate("/results");
    } catch (error: any) {
      console.error("Delete error:", error);
      toast.error("Failed to delete result");
      setDeleting(false);
    }
  };

  const getScoreColor = (score: number, max: number) => {
    const percentage = (score / max) * 100;
    if (percentage >= 90) return "text-green-600";
    if (percentage >= 70) return "text-yellow-600";
    return "text-red-600";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!result || !rubric) return null;

  const criteriaMap = new Map(
    (rubric.criteria as any[]).map(c => [c.id, c])
  );

  // Calculate total marks
  const totalPossibleMarks = (rubric.criteria as any[]).reduce((sum, c) => sum + c.weight, 0);
  const totalEarnedMarks = (result.criteria_scores as any[]).reduce((sum, cs) => sum + cs.score, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/results")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Results
          </Button>
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={deleting}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Grading Result?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the result and submission. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="space-y-6">
          {/* Section 1 - Summary Feedback */}
          <Card>
            <Collapsible open={summaryOpen} onOpenChange={setSummaryOpen}>
              <CardHeader>
                <CollapsibleTrigger className="flex items-center justify-between w-full hover:opacity-80 transition-opacity">
                  <div className="flex items-start justify-between w-full">
                    <div>
                      <CardTitle className="text-2xl text-left">
                        {(result.submissions as any).student_name}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1 text-left">
                        {rubric.name} • {new Date((result.submissions as any).created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-4xl font-bold text-primary">
                          {Math.round(result.overall_score)}%
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {totalEarnedMarks} / {totalPossibleMarks} marks
                        </div>
                      </div>
                      <ChevronDown className={`h-5 w-5 transition-transform ${summaryOpen ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  <div className="mb-4">
                    <Badge>{result.confidence} confidence</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-semibold mb-3 text-green-600 flex items-center">
                        ✓ Strengths
                      </h3>
                      <ul className="space-y-2">
                        {(result.strengths as string[]).map((strength, i) => (
                          <li key={i} className="text-sm">• {strength}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-semibold mb-3 text-yellow-600 flex items-center">
                        → Areas to Improve
                      </h3>
                      <ul className="space-y-2">
                        {(result.improvements as string[]).map((improvement, i) => (
                          <li key={i} className="text-sm">• {improvement}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Section 2 - Criteria Breakdown */}
          <Card>
            <Collapsible open={breakdownOpen} onOpenChange={setBreakdownOpen}>
              <CardHeader>
                <CollapsibleTrigger className="flex items-center justify-between w-full hover:opacity-80 transition-opacity">
                  <CardTitle>Criteria Breakdown</CardTitle>
                  <ChevronDown className={`h-5 w-5 transition-transform ${breakdownOpen ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[30%]">Criterion</TableHead>
                          <TableHead className="w-[10%] text-center">Score</TableHead>
                          <TableHead className="w-[10%] text-center">Weight</TableHead>
                          <TableHead className="w-[35%]">Rationale</TableHead>
                          <TableHead className="w-[15%] text-center">Evidence</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(result.criteria_scores as any[]).map((cs, index) => {
                          const criterion = criteriaMap.get(cs.criterion_id);
                          if (!criterion) return null;

                          return (
                            <TableRow key={index} className="hover:bg-muted/50">
                              <TableCell className="font-medium">{criterion.name}</TableCell>
                              <TableCell className={`text-center font-bold ${getScoreColor(cs.score, criterion.weight)}`}>
                                {cs.score}
                              </TableCell>
                              <TableCell className="text-center text-muted-foreground">
                                {criterion.weight}
                              </TableCell>
                              <TableCell className="text-sm">{cs.rationale}</TableCell>
                              <TableCell className="text-center">
                                {cs.evidence && cs.evidence.length > 0 ? (
                                  <Collapsible>
                                    <CollapsibleTrigger asChild>
                                      <Button variant="ghost" size="sm">
                                        <Badge variant="secondary">{cs.evidence.length} quotes</Badge>
                                      </Button>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="mt-2">
                                      <div className="space-y-2 text-left">
                                        {cs.evidence.map((quote: string, i: number) => (
                                          <div key={i} className="text-xs bg-muted/50 p-2 rounded border-l-2 border-primary">
                                            "{quote}"
                                          </div>
                                        ))}
                                      </div>
                                    </CollapsibleContent>
                                  </Collapsible>
                                ) : (
                                  <span className="text-muted-foreground text-sm">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  
                  {/* Total Marks Footer */}
                  <div className="mt-4 flex justify-end">
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">Total Marks</div>
                      <div className="text-2xl font-bold text-primary">
                        {totalEarnedMarks} / {totalPossibleMarks}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>
      </div>
    </div>
  );
}
