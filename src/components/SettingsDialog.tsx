import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const navigate = useNavigate();
  const [deleteDialog, setDeleteDialog] = useState<'account' | 'rubrics' | 'papers' | null>(null);
  const [loading, setLoading] = useState(false);

  const handleDeleteAccount = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Delete all user data first
      await Promise.all([
        supabase.from("results").delete().eq("user_id", user.id),
        supabase.from("submissions").delete().eq("user_id", user.id),
        supabase.from("focus_profiles").delete().eq("user_id", user.id),
        supabase.from("assignments").delete().eq("user_id", user.id),
        supabase.from("rubrics").delete().eq("user_id", user.id),
        supabase.from("subjects").delete().eq("user_id", user.id),
      ]);

      // Delete storage files
      await Promise.all([
        supabase.storage.from("rubrics").remove([`${user.id}/`]),
        supabase.storage.from("submissions").remove([`${user.id}/`]),
      ]);

      // Sign out
      await supabase.auth.signOut();
      toast.success("Account deleted successfully");
      navigate("/");
    } catch (error: any) {
      toast.error(error.message || "Failed to delete account");
    } finally {
      setLoading(false);
      setDeleteDialog(null);
    }
  };

  const handleDeleteRubrics = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Delete related data
      await Promise.all([
        supabase.from("results").delete().eq("user_id", user.id),
        supabase.from("submissions").delete().eq("user_id", user.id),
        supabase.from("focus_profiles").delete().eq("user_id", user.id),
        supabase.from("assignments").delete().eq("user_id", user.id),
        supabase.from("rubrics").delete().eq("user_id", user.id),
      ]);

      // Delete rubric files from storage
      await supabase.storage.from("rubrics").remove([`${user.id}/`]);

      toast.success("All rubrics deleted successfully");
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || "Failed to delete rubrics");
    } finally {
      setLoading(false);
      setDeleteDialog(null);
    }
  };

  const handleDeletePapers = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Delete submissions and results
      await Promise.all([
        supabase.from("results").delete().eq("user_id", user.id),
        supabase.from("submissions").delete().eq("user_id", user.id),
      ]);

      // Delete submission files from storage
      await supabase.storage.from("submissions").remove([`${user.id}/`]);

      toast.success("All papers deleted successfully");
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || "Failed to delete papers");
    } finally {
      setLoading(false);
      setDeleteDialog(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Manage your account and data
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Danger Zone</h3>
              <div className="space-y-2">
                <Button
                  variant="destructive"
                  className="w-full justify-start"
                  onClick={() => setDeleteDialog('papers')}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete All Papers
                </Button>
                
                <Button
                  variant="destructive"
                  className="w-full justify-start"
                  onClick={() => setDeleteDialog('rubrics')}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete All Rubrics
                </Button>
                
                <Button
                  variant="destructive"
                  className="w-full justify-start"
                  onClick={() => setDeleteDialog('account')}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Account
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialogs */}
      <AlertDialog open={deleteDialog === 'account'} onOpenChange={() => setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your account and all associated data including rubrics, papers, and results. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAccount} disabled={loading} className="bg-destructive hover:bg-destructive/90">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete Account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialog === 'rubrics'} onOpenChange={() => setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Rubrics?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all rubrics, focus profiles, and grading results. Submitted papers will also be removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRubrics} disabled={loading} className="bg-destructive hover:bg-destructive/90">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete Rubrics"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialog === 'papers'} onOpenChange={() => setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Papers?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all submitted papers and their grading results. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePapers} disabled={loading} className="bg-destructive hover:bg-destructive/90">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete Papers"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
