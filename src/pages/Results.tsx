import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Results() {
  const navigate = useNavigate();
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadResults();
    
    // Poll for updates every 5 seconds
    const interval = setInterval(loadResults, 5000);
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
            created_at
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

        {results.length === 0 ? (
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
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => navigate(`/results/${result.id}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-xl">
                        {(result.submissions as any).student_name}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {new Date((result.submissions as any).created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className={`${getScoreColor(result.overall_score)} text-white px-4 py-2 rounded-lg font-bold text-xl`}>
                        {Math.round(result.overall_score)}%
                      </div>
                      <Badge className={getConfidenceBadge(result.confidence)}>
                        {result.confidence} confidence
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
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
