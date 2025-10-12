import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, LogOut, FileText, Upload, GraduationCap, Loader2 } from "lucide-react";
import { RubricUpload } from "@/components/RubricUpload";
import { PaperUpload } from "@/components/PaperUpload";
import { SubjectCard } from "@/components/SubjectCard";
import { SettingsDialog } from "@/components/SettingsDialog";
import { OnboardingTour } from "@/components/OnboardingTour";
import heroGrading from "@/assets/hero-grading.jpg";

interface Subject {
  id: string;
  name: string;
  color: string;
  user_id: string;
}

interface Rubric {
  id: string;
  name: string;
  subject_id: string;
  criteria: any;
  created_at: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState({
    rubrics: 0,
    pendingSubmissions: 0,
    totalSubmissions: 0,
    results: 0
  });
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    checkUser();
  }, []);

  useEffect(() => {
    if (user) {
      loadStats(user.id);
      loadSubjectsAndRubrics();
      
      // Set up realtime subscription for rubric updates
      const channel = supabase
        .channel('rubrics-changes')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'rubrics',
            filter: `user_id=eq.${user.id}`
          },
          () => {
            loadSubjectsAndRubrics();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/auth");
      return;
    }
    setUser(user);
    loadStats(user.id);
    setLoading(false);
  };

  const loadStats = async (userId: string) => {
    const [rubrics, pendingSubmissions, totalSubmissions, results] = await Promise.all([
      supabase.from("rubrics").select("id", { count: "exact" }).eq("user_id", userId),
      supabase.from("submissions").select("id", { count: "exact" }).eq("user_id", userId).in("status", ["pending", "processing"]),
      supabase.from("submissions").select("id", { count: "exact" }).eq("user_id", userId),
      supabase.from("results").select("id", { count: "exact" }).eq("user_id", userId)
    ]);

    setStats({
      rubrics: rubrics.count || 0,
      pendingSubmissions: pendingSubmissions.count || 0,
      totalSubmissions: totalSubmissions.count || 0,
      results: results.count || 0
    });
  };

  const loadSubjectsAndRubrics = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [subjectsData, rubricsData] = await Promise.all([
      supabase
        .from("subjects")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("rubrics")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
    ]);

    if (subjectsData.data) setSubjects(subjectsData.data);
    if (rubricsData.data) setRubrics(rubricsData.data);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const refreshStats = () => {
    if (user) {
      loadStats(user.id);
      loadSubjectsAndRubrics();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Academic ACE Grader
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)}>
              <Settings className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleSignOut}>
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Welcome Banner */}
        <div
          className="relative rounded-2xl overflow-hidden mb-8 shadow-elegant"
          style={{
            backgroundImage: `linear-gradient(135deg, rgba(147, 51, 234, 0.9), rgba(59, 130, 246, 0.9)), url(${heroGrading})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="p-8 text-white">
            <h2 className="text-3xl font-bold mb-2">
              Welcome back, {user?.email?.split("@")[0]}! 👋
            </h2>
            <p className="text-lg opacity-90">
              Upload rubrics, select focus criteria, and let AI grade your papers.
            </p>
          </div>
        </div>

        {/* Main Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Rubrics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-3xl font-bold">{stats.rubrics}</div>
              <p className="text-sm text-muted-foreground">
                Upload rubrics and AI will extract grading criteria
              </p>
              <RubricUpload onSuccess={refreshStats} />
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                Upload Papers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-3xl font-bold">{stats.totalSubmissions}</div>
              <p className="text-sm text-muted-foreground">
                {stats.pendingSubmissions > 0 
                  ? `${stats.pendingSubmissions} being graded` 
                  : "Select a subject below or upload directly"}
              </p>
              <PaperUpload onSuccess={refreshStats} />
            </CardContent>
          </Card>

          <Card 
            className="hover:shadow-lg transition-shadow cursor-pointer"
            onClick={() => navigate("/results")}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-primary" />
                Results
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-3xl font-bold">{stats.results}</div>
              <p className="text-sm text-muted-foreground">
                View detailed grading results and feedback
              </p>
              <Button variant="outline" size="lg" className="w-full">
                View Results
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Subjects Section */}
        {subjects.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Your Subjects</h2>
              <p className="text-sm text-muted-foreground">
                Click on a subject to upload papers
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {subjects.map((subject) => {
                const subjectRubrics = rubrics.filter(r => r.subject_id === subject.id);
                return (
                  <SubjectCard
                    key={subject.id}
                    subject={subject}
                    rubrics={subjectRubrics}
                    onRefresh={refreshStats}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
      
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <OnboardingTour onComplete={() => {}} />
    </div>
  );
}
