"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { hasSupabaseClientEnv } from "@/lib/config";

export function CreateTaskDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { createTask } = useStore();
  const serverMode = hasSupabaseClientEnv;
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  function submit() {
    if (!title.trim()) return;
    // Fire-and-forget: in server mode this kicks off Operator's planning and
    // surfaces progress via toasts; the task appears when it's ready.
    void createTask({ title: title.trim(), description: notes.trim() || undefined });
    setTitle("");
    setNotes("");
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="What do you need done?"
      description={
        serverMode
          ? "Describe it in plain words. Operator works out the steps, picks the integrations it needs, and prepares a draft for you to approve."
          : "Add a task for an agent to pick up. It will land in the New column."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!title.trim()}>
            <Sparkles className="h-4 w-4" />
            {serverMode ? "Plan it" : "Create task"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ct-title">Task</Label>
          <Input
            id="ct-title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. Send a test email to myself"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-notes">Details (optional)</Label>
          <Textarea
            id="ct-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything Operator should know — who it's for, tone, specifics…"
          />
        </div>
        {serverMode && (
          <p className="flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Operator thinks it through and drafts the work. Nothing runs until you approve.
          </p>
        )}
      </div>
    </Dialog>
  );
}
