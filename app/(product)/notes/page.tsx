"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  NotebookPen,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { CATEGORY_META } from "@/lib/constants";
import {
  actionNoteAction,
  analyzeNoteAction,
  createNoteAction,
  deleteNoteAction,
  listNotesAction,
  updateNoteAction,
} from "@/app/actions";
import type { Category, Note, NoteProposal } from "@/lib/types";

export default function NotesPage() {
  const { reloadWorkspace } = useStore();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void listNotesAction()
      .then((rows) => {
        setNotes(rows);
        setSelectedId((cur) => cur ?? rows[0]?.id ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const patchNote = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  async function newNote() {
    const n = await createNoteAction();
    if (!n) return;
    setNotes((prev) => [n, ...prev]);
    setSelectedId(n.id);
  }

  async function removeNote(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
    await deleteNoteAction(id);
  }

  return (
    <>
      <PageHeader
        title="Notes"
        description="Jot down anything on your mind. When you're ready, hand a note to the Executive — it'll turn it into a project or tasks your team can run."
        actions={
          <Button size="sm" onClick={newNote}>
            <Plus className="h-4 w-4" />
            New note
          </Button>
        }
      />
      <PageBody>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : notes.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <NotebookPen className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold">No notes yet</h3>
              <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
                Jot down a to-do, an idea, or a reminder — anything you don’t want to forget. When you’re ready,
                hand it to the Executive and it’ll turn it into a project or tasks your team can run.
              </p>
            </div>
            <Button size="sm" onClick={newNote}>
              <Plus className="h-4 w-4" />
              New note
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            {/* List */}
            <div className="space-y-1.5">
              {notes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setSelectedId(n.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                    n.id === selectedId ? "border-primary/40 bg-primary/5" : "border-border bg-card hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                      {n.title || firstLine(n.content) || "Untitled note"}
                    </p>
                    {n.status === "actioned" && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                    {n.content ? preview(n.content) : "Empty"}
                  </p>
                </button>
              ))}
            </div>

            {/* Editor */}
            {selected ? (
              <NoteEditor
                key={selected.id}
                note={selected}
                onPatch={patchNote}
                onDelete={() => removeNote(selected.id)}
                onActioned={() => reloadWorkspace()}
              />
            ) : (
              <Card className="flex items-center justify-center p-12 text-[13px] text-muted-foreground">
                Select a note, or create a new one.
              </Card>
            )}
          </div>
        )}
      </PageBody>
    </>
  );
}

function NoteEditor({
  note,
  onPatch,
  onDelete,
  onActioned,
}: {
  note: Note;
  onPatch: (id: string, patch: Partial<Note>) => void;
  onDelete: () => void;
  onActioned: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Analysis / proposal state.
  const [analyzing, setAnalyzing] = useState(false);
  const [proposal, setProposal] = useState<NoteProposal | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ kind: NoteProposal["kind"]; taskCount?: number } | null>(null);

  const persist = useCallback(
    (patch: { title?: string; content?: string }) => {
      setSaveState("saving");
      void updateNoteAction(note.id, patch).then((r) => setSaveState(r.ok ? "saved" : "idle"));
    },
    [note.id],
  );

  // Debounced autosave — updateNoteAction persists immediately (not via the
  // debounced bundle), so nothing is lost on refresh.
  function onEdit(next: { title?: string; content?: string }) {
    if (next.title !== undefined) {
      setTitle(next.title);
      onPatch(note.id, { title: next.title });
    }
    if (next.content !== undefined) {
      setContent(next.content);
      onPatch(note.id, { content: next.content });
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(next), 700);
  }

  function flush() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    persist({ title, content });
  }

  async function analyze() {
    if (analyzing) return;
    flush(); // make sure the Executive reads the latest text
    setAnalyzing(true);
    setError("");
    setProposal(null);
    try {
      const r = await analyzeNoteAction(note.id);
      if (r.ok && r.proposal) setProposal(r.proposal);
      else setError(r.error ?? "Couldn't analyze the note.");
    } catch {
      setError("Couldn't reach the Executive. Try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function approve(chosen?: NoteProposal) {
    const p = chosen ?? proposal;
    if (!p || creating) return;
    setCreating(true);
    setError("");
    try {
      const r = await actionNoteAction(note.id, p);
      if (r.ok) {
        onPatch(note.id, {
          status: "actioned",
          spawned_project_id: r.projectId ?? null,
          spawned_task_count: r.taskCount ?? 0,
        });
        setProposal(null);
        setDone({ kind: p.kind, taskCount: r.taskCount });
        onActioned(); // refresh the board so new tasks show up
      } else {
        setError(r.error ?? "Couldn't create the work.");
      }
    } finally {
      setCreating(false);
    }
  }

  const empty = !title.trim() && !content.trim();

  return (
    <Card className="flex flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <Input
          value={title}
          onChange={(e) => onEdit({ title: e.target.value })}
          onBlur={flush}
          placeholder="Note title (optional)"
          className="flex-1 border-0 px-0 text-[15px] font-semibold shadow-none focus-visible:ring-0"
        />
        <span className="text-[11px] text-muted-foreground">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
        </span>
        <button
          onClick={onDelete}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
          title="Delete note"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <Textarea
        value={content}
        onChange={(e) => onEdit({ content: e.target.value })}
        onBlur={flush}
        placeholder="Start typing… jot down to-dos, ideas, reminders. The Executive can turn this into real work."
        className="min-h-[280px] resize-y border-0 px-0 text-[13.5px] leading-relaxed shadow-none focus-visible:ring-0"
      />

      {/* Actioned badge */}
      {note.status === "actioned" && !done && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {note.spawned_project_id ? (
            <span>
              Actioned — created a project.{" "}
              <Link href="/projects" className="font-semibold underline">
                View in Projects
              </Link>
            </span>
          ) : (
            <span>
              Actioned — created {note.spawned_task_count} task{note.spawned_task_count === 1 ? "" : "s"}.{" "}
              <Link href="/approvals" className="font-semibold underline">
                Review on the board
              </Link>
            </span>
          )}
        </div>
      )}

      {/* Just-created confirmation */}
      {done && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {done.kind === "project" ? (
            <span>
              Project created and planning.{" "}
              <Link href="/projects" className="font-semibold underline">
                Open Projects
              </Link>
            </span>
          ) : (
            <span>
              Created {done.taskCount} task{done.taskCount === 1 ? "" : "s"} for your team.{" "}
              <Link href="/approvals" className="font-semibold underline">
                Review on the board
              </Link>
            </span>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}

      {/* Proposal */}
      {proposal ? (
        <ProposalPanel
          proposal={proposal}
          creating={creating}
          onApprove={approve}
          onCancel={() => setProposal(null)}
        />
      ) : (
        note.status !== "actioned" && (
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <p className="text-[11.5px] text-muted-foreground">
              The Executive reads your note + business context, then proposes a project or tasks.
            </p>
            <Button size="sm" disabled={empty || analyzing} onClick={analyze}>
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {analyzing ? "Thinking…" : "Send to Executive"}
            </Button>
          </div>
        )
      )}
    </Card>
  );
}

function ProposalPanel({
  proposal,
  creating,
  onApprove,
  onCancel,
}: {
  proposal: NoteProposal;
  creating: boolean;
  onApprove: (chosen: NoteProposal) => void;
  onCancel: () => void;
}) {
  const taskList = proposal.tasks ?? [];
  // Each task starts approved; the user can reject any before creating.
  const [included, setIncluded] = useState<boolean[]>(() => taskList.map(() => true));
  const chosenCount = included.filter(Boolean).length;

  function toggle(i: number) {
    setIncluded((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  function approve() {
    if (proposal.kind === "project") onApprove(proposal);
    else onApprove({ ...proposal, tasks: taskList.filter((_, i) => included[i]) });
  }

  const canApprove = proposal.kind === "project" || chosenCount > 0;

  return (
    <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-primary">
        <Sparkles className="h-3.5 w-3.5" />
        {proposal.kind === "project"
          ? "The Executive suggests a project"
          : "The Executive suggests these tasks — keep the ones you want, uncheck any to skip"}
      </div>
      {proposal.summary && <p className="mb-2.5 text-[12.5px] text-foreground/80">{proposal.summary}</p>}

      {proposal.kind === "project" && proposal.project ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[13px] font-semibold">{proposal.project.title}</p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{proposal.project.goal}</p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            → The Executive will plan this into phases and delegate the work.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {taskList.map((t, i) => {
            const meta = CATEGORY_META[t.category as Category];
            const on = included[i];
            return (
              <label
                key={i}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors",
                  on ? "border-border bg-card" : "border-dashed border-border bg-muted/40",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(i)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                />
                <div className={cn("min-w-0 flex-1", !on && "opacity-55")}>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                        meta?.tag ?? "bg-slate-100 text-slate-600",
                      )}
                    >
                      {meta?.label ?? t.category}
                    </span>
                    <p className={cn("min-w-0 flex-1 truncate text-[12.5px] font-medium", !on && "line-through")}>
                      {t.title}
                    </p>
                  </div>
                  {t.description && <p className="mt-1 text-[11.5px] text-muted-foreground">{t.description}</p>}
                </div>
              </label>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="success" disabled={creating || !canApprove} onClick={approve}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {proposal.kind === "project"
            ? "Approve & create project"
            : `Approve ${chosenCount} task${chosenCount === 1 ? "" : "s"}`}
        </Button>
        <Button size="sm" variant="outline" disabled={creating} onClick={onCancel}>
          Cancel
        </Button>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          Routes to your board <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}

function firstLine(s: string): string {
  return s.split("\n")[0]?.trim() ?? "";
}
function preview(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 80);
}
