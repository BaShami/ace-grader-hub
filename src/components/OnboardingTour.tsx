import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, ArrowRight } from "lucide-react";

interface OnboardingTourProps {
  onComplete: () => void;
}

const steps = [
  {
    title: "Upload Rubric",
    description: "Start by uploading your grading rubric. AI will extract the criteria automatically.",
    highlight: "rubric-card"
  },
  {
    title: "Select Subject",
    description: "Your rubric creates a subject. Select focus criteria for targeted grading.",
    highlight: "subjects-section"
  },
  {
    title: "View Results",
    description: "Upload papers and view detailed AI-powered grading results here.",
    highlight: "results-card"
  }
];

export function OnboardingTour({ onComplete }: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Check if user has seen the tour
    const hasSeenTour = localStorage.getItem("hasSeenOnboarding");
    if (!hasSeenTour) {
      setShow(true);
    }
  }, []);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = () => {
    localStorage.setItem("hasSeenOnboarding", "true");
    setShow(false);
    onComplete();
  };

  if (!show) return null;

  const step = steps[currentStep];

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={handleComplete} />
      
      {/* Tour Card */}
      <Card className="fixed bottom-8 right-8 w-80 z-50 shadow-2xl">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h3 className="font-semibold text-lg">{step.title}</h3>
              <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleComplete} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {steps.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    idx === currentStep ? "bg-primary" : "bg-muted"
                  }`}
                />
              ))}
            </div>
            
            <Button onClick={handleNext} size="sm">
              {currentStep < steps.length - 1 ? (
                <>
                  Next <ArrowRight className="ml-2 h-4 w-4" />
                </>
              ) : (
                "Got it!"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
