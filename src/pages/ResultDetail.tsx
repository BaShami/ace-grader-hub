import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ResultDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<any>(null);
  const [rubric, setRubric] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => navigate("/results")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Results
          </Button>
        </div>

        <div className="space-y-6">
          {/* Header Card */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-2xl">
                    {(result.submissions as any).student_name}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {rubric.name} • {new Date((result.submissions as any).created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-bold text-primary">
                    {Math.round(result.overall_score)}%
                  </div>
                  <Badge className="mt-2">
                    {result.confidence} confidence
                  </Badge>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Summary Card */}
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
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
          </Card>

          {/* Detailed Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Detailed Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                {(result.criteria_scores as any[]).map((cs, index) => {
                  const criterion = criteriaMap.get(cs.criterion_id);
                  if (!criterion) return null;

                  return (
                    <AccordionItem key={index} value={`item-${index}`}>
                      <AccordionTrigger>
                        <div className="flex items-center justify-between w-full pr-4">
                          <span className="font-medium">{criterion.name}</span>
                          <span className={`font-bold ${getScoreColor(cs.score, criterion.weight)}`}>
                            {cs.score}/{criterion.weight}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4 pt-2">
                          <div>
                            <h4 className="font-semibold text-sm mb-2">Rationale</h4>
                            <p className="text-sm text-muted-foreground">{cs.rationale}</p>
                          </div>
                          {cs.evidence && cs.evidence.length > 0 && (
                            <div>
                              <h4 className="font-semibold text-sm mb-2">Evidence</h4>
                              <div className="space-y-2">
                                {cs.evidence.map((quote: string, i: number) => (
                                  <div key={i} className="text-sm bg-muted/50 p-3 rounded border-l-2 border-primary">
                                    "{quote}"
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
