"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, Link2, Loader2, Plus, StickyNote, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Dialog } from "@/components/ui/dialog";
import { createTeamDocumentAction, deleteTeamDocumentAction, listTeamDocumentsAction } from "@/app/actions";
import type { TeamDocument, TeamDocumentKind } from "@/lib/types";

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function DocDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<TeamDocumentKind>("link");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind("link");
    setTitle("");
    setUrl("");
    setContent("");
    setError(null);
  }, [open]);

  async function save() {
    if (!title.trim()) {
      setError("Give it a title.");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await createTeamDocumentAction({
      title,
      kind,
      url: kind === "link" ? url : undefined,
      content: kind === "note" ? content : undefined,
    });
    setSaving(false);
    if ("ok" in r && r.ok) {
      onSaved();
      onClose();
    } else {
      setError("error" in r ? r.error : "Couldn't add the document.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add a document">
      <div className="flex flex-col gap-3">
        <div>
          <Label>Type</Label>
          <Segmented
            options={[
              { value: "link", label: "Link" },
              { value: "note", label: "Note" },
            ]}
            value={kind}
            onChange={(v) => setKind(v as TeamDocumentKind)}
          />
        </div>
        <div>
          <Label>Title *</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Brand guidelines" />
        </div>
        {kind === "link" ? (
          <div>
            <Label>URL *</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/…" />
          </div>
        ) : (
          <div>
            <Label>Content *</Label>
            <Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Type the note…" />
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Add
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function normalizeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function DocsView({ canManage }: { canManage: boolean }) {
  const [docs, setDocs] = useState<TeamDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openNote, setOpenNote] = useState<TeamDocument | null>(null);

  async function refresh() {
    setDocs(await listTeamDocumentsAction());
    setLoading(false);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function remove(d: TeamDocument) {
    if (!confirm(`Remove "${d.title}" from the shared library?`)) return;
    setDocs((prev) => prev.filter((x) => x.id !== d.id));
    await deleteTeamDocumentAction(d.id);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Links and notes the whole team can see — the docs you all reference.
        </p>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : docs.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
          <FileText className="h-9 w-9 opacity-40" />
          <p className="max-w-sm text-sm">Nothing here yet. Add a link or a note your team can reference.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {docs.map((d) => {
            const inner = (
              <>
                <div
                  className={cnKind(d.kind)}
                >
                  {d.kind === "link" ? <Link2 className="h-4 w-4" /> : <StickyNote className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 truncate text-sm font-medium">
                    {d.title}
                    {d.kind === "link" && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {d.created_by_name || "Someone"} · {fmt(d.created_at)}
                  </div>
                </div>
              </>
            );
            return (
              <Card key={d.id} className="group flex items-start gap-2 p-2.5">
                {d.kind === "link" ? (
                  <a
                    href={normalizeHref(d.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 flex-1 items-start gap-2.5"
                  >
                    {inner}
                  </a>
                ) : (
                  <button onClick={() => setOpenNote(d)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                    {inner}
                  </button>
                )}
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 opacity-0 transition group-hover:opacity-100"
                    onClick={() => remove(d)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <DocDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={refresh} />

      <Dialog open={!!openNote} onClose={() => setOpenNote(null)} title={openNote?.title ?? "Note"}>
        <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm text-foreground/90">
          {openNote?.content}
        </div>
      </Dialog>
    </div>
  );
}

function cnKind(kind: TeamDocumentKind): string {
  return kind === "link"
    ? "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/12 text-sky-600 dark:text-sky-400"
    : "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/12 text-amber-600 dark:text-amber-400";
}
