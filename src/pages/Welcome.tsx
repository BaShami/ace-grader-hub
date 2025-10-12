import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Upload, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import welcomeIllustration from "@/assets/welcome-illustration.jpg";

const Welcome = () => {
  const navigate = useNavigate();

  const steps = [
    {
      icon: Upload,
      title: "Upload your rubric",
      description: "Drag-drop or browse PDF, DOCX, TXT files",
    },
    {
      icon: Settings,
      title: "Pick what to check",
      description: "Create focus profiles for different grading aspects",
    },
    {
      icon: CheckCircle2,
      title: "Drop student papers & done",
      description: "AI grades in minutes while you focus on teaching",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16 space-y-6">
          <h1 className="text-5xl md:text-6xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Academic ACE Grader
          </h1>
          <p className="text-2xl md:text-3xl text-foreground font-medium max-w-3xl mx-auto">
            Grade 30 papers in 10 minutes. Focus on teaching, not tedium.
          </p>
        </div>

        {/* Illustration */}
        <div className="max-w-2xl mx-auto mb-16">
          <img
            src={welcomeIllustration}
            alt="AI Grading Concept"
            className="w-full h-auto rounded-2xl shadow-elegant"
          />
        </div>

        {/* Quick Start Steps */}
        <div className="max-w-5xl mx-auto mb-12">
          <h2 className="text-3xl font-bold text-center mb-8 text-foreground">
            Get Started in 3 Steps
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((step, index) => (
              <Card
                key={index}
                className="p-6 text-center space-y-4 shadow-card hover:shadow-elegant transition-shadow bg-card"
              >
                <div className="w-16 h-16 mx-auto rounded-full bg-gradient-primary flex items-center justify-center">
                  <step.icon className="w-8 h-8 text-primary-foreground" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold text-card-foreground">
                    {index + 1}. {step.title}
                  </h3>
                  <p className="text-muted-foreground">{step.description}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Button
            size="lg"
            className="bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-elegant text-lg px-8 py-6"
            onClick={() => navigate("/auth")}
          >
            Get Started Free
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="text-lg px-8 py-6"
            onClick={() => navigate("/auth")}
          >
            Sign In
          </Button>
        </div>

        {/* Skip Button */}
        <div className="text-center mt-8">
          <Button
            variant="ghost"
            onClick={() => navigate("/auth")}
            className="text-muted-foreground hover:text-foreground"
          >
            Skip Introduction →
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Welcome;
