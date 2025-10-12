import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { PaperUpload } from "./PaperUpload";
import { FocusSelector } from "./FocusSelector";

interface Rubric {
  id: string;
  name: string;
  criteria: any;
  created_at: string;
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

  const handleSelectFocus = (rubricId: string) => {
    setSelectedRubricId(rubricId);
    setFocusSelectorOpen(true);
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
            <Badge variant="secondary">
              {rubrics.length} {rubrics.length === 1 ? 'rubric' : 'rubrics'}
            </Badge>
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
