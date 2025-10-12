import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Loader2 } from "lucide-react";

interface RetryGradingButtonProps {
  submissionId: string;
  focusProfileId: string;
  onSuccess?: () => void;
}

export function RetryGradingButton({ submissionId, focusProfileId, onSuccess }: RetryGradingButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleRetry = async () => {
    setLoading(true);
    try {
      // Reset submission status to pending
      const { error: updateError } = await supabase
        .from("submissions")
        .update({ status: 'pending' })
        .eq("id", submissionId);

      if (updateError) throw updateError;

      // Trigger grading again
      const { error: gradeError } = await supabase.functions.invoke('grade-submission', {
        body: { 
          submissionId,
          focusProfileId
        }
      });

      if (gradeError) throw gradeError;

      toast.success("Retrying grading...");
      onSuccess?.();
    } catch (error: any) {
      console.error("Retry error:", error);
      toast.error(error.message || "Failed to retry grading");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRetry}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </>
      )}
    </Button>
  );
}
