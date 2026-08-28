"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus, Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import {
  createTeamGoalAction,
  getMyGoalsAction,
  setMyGoalStatusAction,
  updateTeamGoalAction,
} from "@/app/actions";
import type { TeamGoal, TeamGoalHorizon, TeamMember } from "@/lib/types";

const HORIZON_LABEL: Record<TeamGoalHorizon, string> = { week: "This week", month: "This month", quarter: "This quarter" };

function GoalItem({ goal, onToggle }: { goal: TeamGoal; onToggle?: () => void }) {
  const done = goal.status === "done";
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-card p-2.5">
      {onToggle ? (
        <button
          onClick={onToggle}
          aria-label={done ? "Mark active" : "Mark done"}
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition",
            done ? "border-success bg-success text-white" : "border-border hover:border-foreground",
          )}
        >
          {done && <Check className="h-3 w-3" />}
        </button>
      ) : (
        <div
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0 rounded-full border",
            done ? "border-success bg-success" : "border-border",
          )}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm", done && "text-muted-foreground line-through")}>{goal.title}</div>
        {goal.detail && <p className="mt-0.5 text-xs text-muted-foreground">{goal.detail}</p>}
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="rounded-full bg-muted px-1.5 py-0.5 font-semibold uppercase tracking-wide">
            {HORIZON_LABEL[goal.horizon]}
          </span>
          {goal.scope === "individual" && goal.member_names.length > 0 && (
            <span>· {goal.member_names.join(", ")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function GoalGroup({ title, goals, onToggle }: { title: string; goals: TeamGoal[]; onToggle?: (g: TeamGoal) => void }) {
  if (!goals.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold">{title}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {goals.map((g) => (
          <GoalItem key={g.id} goal={g} onToggle={onToggle ? () => onToggle(g) : undefined} />
        ))}
      </div>
    </div>
  );
}

function ManagerGoalDialog({
  open,
  reports,
  onClose,
  onSaved,
}: {
  open: boolean;
  reports: TeamMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [horizon, setHorizon] = useState<TeamGoalHorizon>("month");
  const [scope, setScope] = useState<"team" | "individual">("individual");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle("");
    setDetail("");
    setHorizon("month");
    setScope("individual");
    setMemberIds([]);
  }, [open, reports]);

  async function save() {
    if (!title.trim()) {
      setError("Give the goal a title.");
      return;
    }
    if (scope === "individual" && !memberIds.length) {
      setError("Pick who the goal is for.");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await createTeamGoalAction({
      title,
      detail,
      horizon,
      scope,
      member_ids: scope === "individual" ? memberIds : [],
    });
    setSaving(false);
    if ("ok" in r && r.ok) {
      onSaved();
      onClose();
    } else {
      setError("error" in r ? r.error : "Couldn't set the goal.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Set a goal">
      <div className="flex flex-col gap-3">
        <div>
          <Label>Goal *</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Close 5 deals this month" />
        </div>
        <div>
          <Label>Detail (optional)</Label>
          <Textarea rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </div>
        <div>
          <Label>Horizon</Label>
          <Segmented
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "quarter", label: "Quarter" },
            ]}
            value={horizon}
            onChange={(v) => setHorizon(v as TeamGoalHorizon)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div>
            <Label>For</Label>
            <Segmented
              options={[
                { value: "team", label: "Whole team" },
                { value: "individual", label: "Reports" },
              ]}
              value={scope}
              onChange={(v) => setScope(v as "team" | "individual")}
            />
          </div>
          {scope === "individual" && (
            <div>
              <Label>Who (pick one or more)</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {reports.map((r) => {
                  const on = memberIds.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setMemberIds((prev) => (on ? prev.filter((x) => x !== r.id) : [...prev, r.id]))}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition",
                        on
                          ? "border-primary bg-primary/12 text-primary"
                          : "border-border text-muted-foreground hover:border-foreground",
                      )}
                    >
                      {r.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Set goal
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function GoalsSection({ isManager, reports }: { isManager: boolean; reports: TeamMember[] }) {
  const [goals, setGoals] = useState<{ team: TeamGoal[]; mine: TeamGoal[]; reports: TeamGoal[] }>({
    team: [],
    mine: [],
    reports: [],
  });
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function refresh() {
    setGoals(await getMyGoalsAction());
    setLoading(false);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function toggleMine(g: TeamGoal) {
    await setMyGoalStatusAction(g.id, g.status === "done" ? "active" : "done");
    await refresh();
  }
  async function toggleManaged(g: TeamGoal) {
    await updateTeamGoalAction(g.id, { status: g.status === "done" ? "active" : "done" });
    await refresh();
  }

  const empty = goals.team.length === 0 && goals.mine.length === 0 && goals.reports.length === 0;
  if (loading || empty) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Target className="h-4 w-4 text-muted-foreground" /> Goals
        </div>
        {isManager && reports.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Set a goal
          </Button>
        )}
      </div>

      <GoalGroup title="Team goals" goals={goals.team} onToggle={isManager ? toggleManaged : undefined} />
      <GoalGroup title="My goals" goals={goals.mine} onToggle={toggleMine} />
      {isManager && <GoalGroup title="My team's goals" goals={goals.reports} onToggle={toggleManaged} />}

      <ManagerGoalDialog open={dialogOpen} reports={reports} onClose={() => setDialogOpen(false)} onSaved={refresh} />
    </div>
  );
}
