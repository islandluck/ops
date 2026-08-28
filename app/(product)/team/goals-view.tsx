"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import {
  createTeamGoalAction,
  deleteTeamGoalAction,
  listTeamGoalsAction,
  updateTeamGoalAction,
} from "@/app/actions";
import type { TeamGoal, TeamGoalHorizon, TeamGoalScope, TeamMember } from "@/lib/types";

const HORIZONS: { key: TeamGoalHorizon; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
];

function GoalDialog({
  open,
  goal,
  members,
  onClose,
  onSaved,
}: {
  open: boolean;
  goal: TeamGoal | null;
  members: TeamMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [horizon, setHorizon] = useState<TeamGoalHorizon>("month");
  const [scope, setScope] = useState<TeamGoalScope>("team");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle(goal?.title ?? "");
    setDetail(goal?.detail ?? "");
    setHorizon(goal?.horizon ?? "month");
    setScope(goal?.scope ?? "team");
    setMemberIds(goal?.member_ids ?? []);
  }, [open, goal]);

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
    const payload = { title, detail, horizon, scope, member_ids: scope === "individual" ? memberIds : [] };
    const r = goal ? await updateTeamGoalAction(goal.id, payload) : await createTeamGoalAction(payload);
    setSaving(false);
    if ("ok" in r && r.ok) {
      onSaved();
      onClose();
    } else {
      setError("error" in r ? r.error : "Couldn't save the goal.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={goal ? "Edit goal" : "New goal"}>
      <div className="flex flex-col gap-3">
        <div>
          <Label>Goal *</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ship the Q3 launch" />
        </div>
        <div>
          <Label>Context (what does hitting this look like?)</Label>
          <Textarea
            rows={4}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Add detail, success criteria, links, or anything the team should know."
          />
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
                { value: "individual", label: "Specific people" },
              ]}
              value={scope}
              onChange={(v) => setScope(v as TeamGoalScope)}
            />
          </div>
          {scope === "individual" && (
            <div>
              <Label>Who (pick one or more)</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const on = memberIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMemberIds((prev) => (on ? prev.filter((x) => x !== m.id) : [...prev, m.id]))}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition",
                        on
                          ? "border-primary bg-primary/12 text-primary"
                          : "border-border text-muted-foreground hover:border-foreground",
                      )}
                    >
                      {m.name}
                    </button>
                  );
                })}
                {members.length === 0 && <span className="text-xs text-muted-foreground">Add team members first.</span>}
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
            {goal ? "Save" : "Add goal"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function GoalCard({
  goal,
  onToggle,
  onEdit,
  onDelete,
}: {
  goal: TeamGoal;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const done = goal.status === "done";
  return (
    <Card className="group flex items-start gap-3 p-3">
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
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", done && "text-muted-foreground line-through")}>{goal.title}</div>
        {goal.detail && <p className="mt-0.5 text-xs text-muted-foreground">{goal.detail}</p>}
        <span
          className={cn(
            "mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            goal.scope === "team" ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {goal.scope === "team" ? "Whole team" : goal.member_names.join(", ") || "Someone"}
        </span>
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>
    </Card>
  );
}

export function GoalsView({ members }: { members: TeamMember[] }) {
  const [goals, setGoals] = useState<TeamGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; goal: TeamGoal | null }>({ open: false, goal: null });

  async function refresh() {
    setGoals(await listTeamGoalsAction());
    setLoading(false);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function toggle(g: TeamGoal) {
    setGoals((prev) => prev.map((x) => (x.id === g.id ? { ...x, status: x.status === "done" ? "active" : "done" } : x)));
    await updateTeamGoalAction(g.id, { status: g.status === "done" ? "active" : "done" });
  }
  async function remove(g: TeamGoal) {
    if (!confirm(`Delete the goal "${g.title}"?`)) return;
    setGoals((prev) => prev.filter((x) => x.id !== g.id));
    await deleteTeamGoalAction(g.id);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Set what the team — and each person — is aiming at this week, month, and quarter. Your team sees these in
          their portal, and the Executive factors them into planning.
        </p>
        <Button size="sm" onClick={() => setDialog({ open: true, goal: null })}>
          <Plus className="h-4 w-4" /> New goal
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : goals.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <Target className="h-10 w-10 opacity-40" />
          <p className="max-w-sm text-sm">
            No goals yet. Set a weekly, monthly, or quarterly goal — for the whole team or one person.
          </p>
          <Button onClick={() => setDialog({ open: true, goal: null })}>
            <Plus className="h-4 w-4" /> Set your first goal
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {HORIZONS.map((h) => {
            const hg = goals.filter((g) => g.horizon === h.key);
            if (!hg.length) return null;
            return (
              <div key={h.key} className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h.label}</h3>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {hg.map((g) => (
                    <GoalCard
                      key={g.id}
                      goal={g}
                      onToggle={() => toggle(g)}
                      onEdit={() => setDialog({ open: true, goal: g })}
                      onDelete={() => remove(g)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <GoalDialog
        open={dialog.open}
        goal={dialog.goal}
        members={members}
        onClose={() => setDialog({ open: false, goal: null })}
        onSaved={refresh}
      />
    </div>
  );
}
