"use client";

import { useEffect, useState } from "react";
import {
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  Loader2,
  Plus,
  StickyNote,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Dialog } from "@/components/ui/dialog";
import {
  browseTeamDriveAction,
  clearTeamDriveFolderAction,
  createTeamDocumentAction,
  deleteTeamDocumentAction,
  listTeamDocumentsAction,
  setTeamDriveFolderAction,
} from "@/app/actions";
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

export function DocsView({ canManage, isOwner }: { canManage: boolean; isOwner: boolean }) {
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

      <div className="border-t border-border pt-3">
        <DriveSection isOwner={isOwner} />
      </div>

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

/** The connected team's shared Google Drive folder — browsable, files open in Drive. */
function DriveSection({ isOwner }: { isOwner: boolean }) {
  const [drive, setDrive] = useState<Awaited<ReturnType<typeof browseTeamDriveAction>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [folderInput, setFolderInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(folderId?: string) {
    setLoading(true);
    setDrive(await browseTeamDriveAction(folderId));
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function openFolder(entry: { id: string; name: string }) {
    setPath((p) => [...p, entry]);
    await load(entry.id);
  }
  async function goToCrumb(index: number) {
    if (index < 0) {
      setPath([]);
      await load();
    } else {
      const np = path.slice(0, index + 1);
      setPath(np);
      await load(np[np.length - 1].id);
    }
  }
  async function saveFolder() {
    setSaving(true);
    setErr(null);
    const r = await setTeamDriveFolderAction(folderInput);
    setSaving(false);
    if ("ok" in r && r.ok) {
      setFolderInput("");
      setPath([]);
      await load();
    } else {
      setErr("error" in r ? r.error : "Couldn't set the folder.");
    }
  }
  async function changeFolder() {
    if (!window.confirm("Change the team Drive folder?")) return;
    await clearTeamDriveFolderAction();
    setPath([]);
    await load();
  }

  const d = drive;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <FolderOpen className="h-4 w-4 text-muted-foreground" /> Google Drive
      </div>

      {loading && !d ? (
        <div className="flex justify-center py-4 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !d || !d.connected ? (
        <p className="text-xs text-muted-foreground">
          Connect Google in Integrations to show your team&apos;s shared Drive folder here.
        </p>
      ) : !d.teamFolder ? (
        isOwner ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">
              Pick one Drive folder to share with the team — only that folder is shown; the rest of your Drive stays
              private.
            </p>
            <div className="flex gap-2">
              <Input
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="Paste a Google Drive folder link"
                className="text-xs"
              />
              <Button size="sm" onClick={saveFolder} disabled={saving || !folderInput.trim()}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Set
              </Button>
            </div>
            {err && <p className="text-xs text-red-600">{err}</p>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">The owner hasn&apos;t set a shared Drive folder yet.</p>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <button onClick={() => goToCrumb(-1)} className="font-medium hover:text-foreground">
              {d.teamFolder.name}
            </button>
            {path.map((p, i) => (
              <span key={p.id} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3" />
                <button onClick={() => goToCrumb(i)} className="hover:text-foreground">
                  {p.name}
                </button>
              </span>
            ))}
            {isOwner && (
              <button onClick={changeFolder} className="ml-auto text-[11px] underline hover:text-foreground">
                change folder
              </button>
            )}
          </div>
          {d.error ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">{d.error}</p>
          ) : d.entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">This folder is empty.</p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {d.entries.map((e) =>
                e.isFolder ? (
                  <button
                    key={e.id}
                    onClick={() => openFolder({ id: e.id, name: e.name })}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-left text-sm transition hover:border-primary/40"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                    <span className="truncate">{e.name}</span>
                  </button>
                ) : (
                  <a
                    key={e.id}
                    href={e.webViewLink || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-sm transition hover:border-primary/40"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{e.name}</span>
                    <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
                  </a>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
