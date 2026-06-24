"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/constants";
import type { Category, RiskLevel } from "@/lib/types";

export function CreateTaskDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { createTask } = useStore();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("growth");
  const [risk, setRisk] = useState<RiskLevel>("low");
  const [description, setDescription] = useState("");

  function submit() {
    if (!title.trim()) return;
    createTask({
      title: title.trim(),
      category,
      risk_level: risk,
      description: description.trim() || undefined,
    });
    setTitle("");
    setDescription("");
    setCategory("growth");
    setRisk("low");
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create a task"
      description="Add a task for an agent to pick up. It will land in the New column."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!title.trim()}>
            Create task
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ct-title">Title</Label>
          <Input
            id="ct-title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. Follow up with this week's webinar signups"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ct-cat">Category</Label>
            <Select
              id="ct-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_META[c].label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-risk">Risk level</Label>
            <Select
              id="ct-risk"
              value={risk}
              onChange={(e) => setRisk(e.target.value as RiskLevel)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-desc">Notes (optional)</Label>
          <Textarea
            id="ct-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Anything the agent should know…"
          />
        </div>
      </div>
    </Dialog>
  );
}
