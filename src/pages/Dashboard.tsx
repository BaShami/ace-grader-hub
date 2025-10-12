import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  BookOpen,
  FileText,
  Target,
  Upload,
  AlertCircle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Settings,
  LogOut,
} from "lucide-react";
import heroGrading from "@/assets/hero-grading.jpg";

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }
    setUser(session.user);
    setLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
    navigate("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const stats = [
    {
      icon: Clock,
      title: "Pending Grades",
      value: "0",
      description: "No submissions waiting",
      color: "orange",
    },
    {
      icon: CheckCircle2,
      title: "Recent Results",
      value: "0",
      description: "No graded submissions yet",
      color: "success",
    },
    {
      icon: AlertCircle,
      title: "Flagged",
      value: "0",
      description: "No items need attention",
      color: "warning",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card shadow-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              Academic ACE Grader
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon">
              <HelpCircle className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon">
              <Settings className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleSignOut}>
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
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
              Ready to grade some papers? Let's get started.
            </p>
          </div>
        </div>

        {/* At-A-Glance Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {stats.map((stat, index) => (
            <Card
              key={index}
              className="p-6 shadow-card hover:shadow-elegant transition-shadow"
            >
              <div className="flex items-start gap-4">
                <div
                  className={`p-3 rounded-lg bg-${stat.color}/10`}
                >
                  <stat.icon className={`w-6 h-6 text-${stat.color}`} />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-card-foreground mb-1">
                    {stat.title}
                  </h3>
                  <p className="text-3xl font-bold text-card-foreground mb-1">
                    {stat.value}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {stat.description}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Primary Actions */}
        <div className="max-w-2xl mx-auto text-center space-y-6 mb-12">
          <Button
            size="lg"
            className="bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-elegant text-lg px-8 py-6"
          >
            <Upload className="w-5 h-5 mr-2" />
            Upload Papers to Grade
          </Button>
          <div>
            <Button variant="ghost" className="text-muted-foreground">
              or <span className="underline ml-1">Upload a New Rubric</span>
            </Button>
          </div>
        </div>

        {/* Quick Access - Empty State */}
        <div>
          <h2 className="text-2xl font-bold mb-6 text-foreground">
            Your Subjects
          </h2>
          <Card className="p-12 text-center shadow-card">
            <div className="max-w-md mx-auto space-y-4">
              <div className="w-20 h-20 mx-auto rounded-full bg-muted flex items-center justify-center">
                <BookOpen className="w-10 h-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold text-card-foreground">
                No subjects yet
              </h3>
              <p className="text-muted-foreground">
                Create your first subject to organize rubrics and assignments
              </p>
              <Button className="mt-4">
                <BookOpen className="w-4 h-4 mr-2" />
                Create Subject
              </Button>
            </div>
          </Card>
        </div>

        {/* Bottom Navigation Hint */}
        <div className="mt-12 text-center">
          <p className="text-sm text-muted-foreground">
            Navigate using the menu above to access{" "}
            <span className="font-medium">Subjects</span>,{" "}
            <span className="font-medium">Assignments</span>, and{" "}
            <span className="font-medium">Results</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
