import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Criterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  category: string;
}

interface FocusSelectorProps {
  rubricId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function FocusSelector({ rubricId, open, onOpenChange, onSuccess }: FocusSelectorProps) {
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profileName, setProfileName] = useState("Custom Focus");
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (open && rubricId) {
      loadCriteria();
    }
  }, [open, rubricId]);

  const loadCriteria = async () => {
    setLoadingData(true);
    try {
      const { data, error } = await supabase
        .from("rubrics")
        .select("criteria")
        .eq("id", rubricId)
        .single();

      if (error) throw error;

      const criteriaList = (data.criteria as unknown as Criterion[]) || [];
      setCriteria(criteriaList);
      setSelected(new Set(criteriaList.map(c => c.id)));
    } catch (error: any) {
      toast.error("Failed to load criteria");
      console.error(error);
    } finally {
      setLoadingData(false);
    }
  };

  const toggleCriterion = (id: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const selectAll = () => {
    setSelected(new Set(criteria.map(c => c.id)));
  };

  const clearAll = () => {
    setSelected(new Set());
  };

  const handleSave = async () => {
    if (selected.size === 0) {
      toast.error("Please select at least one criterion");
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Check for duplicate profile name
      const { data: existingProfile } = await supabase
        .from("focus_profiles")
        .select("id")
        .eq("user_id", user.id)
        .eq("rubric_id", rubricId)
        .eq("name", profileName)
        .maybeSingle();

      if (existingProfile) {
        toast.error("A focus profile with this name already exists for this rubric");
        setLoading(false);
        return;
      }

      const { error } = await supabase
        .from("focus_profiles")
        .insert({
          name: profileName,
          rubric_id: rubricId,
          user_id: user.id,
          selected_criteria: Array.from(selected),
          is_default: false
        });

      if (error) throw error;

      toast.success("Focus profile created!");
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      toast.error(error.message || "Failed to create focus profile");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const groupedCriteria = criteria.reduce((acc, criterion) => {
    if (!acc[criterion.category]) {
      acc[criterion.category] = [];
    }
    acc[criterion.category].push(criterion);
    return acc;
  }, {} as Record<string, Criterion[]>);

  const totalWeight = criteria
    .filter(c => selected.has(c.id))
    .reduce((sum, c) => sum + c.weight, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Select Focus Criteria</DialogTitle>
        </DialogHeader>

        {loadingData ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <Label htmlFor="profile-name">Profile Name</Label>
              <Input
                id="profile-name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="e.g., Content Focus"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {selected.size} of {criteria.length} selected • {totalWeight} points
              </div>
              <div className="space-x-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={clearAll}>
                  Clear All
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              {Object.entries(groupedCriteria).map(([category, items]) => (
                <div key={category} className="space-y-2">
                  <h3 className="font-semibold text-sm">{category}</h3>
                  <div className="space-y-2 pl-4">
                    {items.map((criterion) => (
                      <div key={criterion.id} className="flex items-start space-x-3 p-2 rounded-lg hover:bg-muted/50">
                        <Checkbox
                          id={criterion.id}
                          checked={selected.has(criterion.id)}
                          onCheckedChange={() => toggleCriterion(criterion.id)}
                        />
                        <div className="flex-1">
                          <Label
                            htmlFor={criterion.id}
                            className="cursor-pointer font-medium"
                          >
                            {criterion.name} ({criterion.weight} pts)
                          </Label>
                          <p className="text-sm text-muted-foreground mt-1">
                            {criterion.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Button onClick={handleSave} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Focus Profile"
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
