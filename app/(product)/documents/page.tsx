"use client";

import { useMemo, useState } from "react";
import { Download, ExternalLink, FileText, Folder, Loader2, Search, Send, X } from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { useStore } from "@/lib/store";
import { hasSupabaseClientEnv } from "@/lib/config";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { AppState, Document } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  email: "Email",
  email_batch: "Emails",
  document: "Document",
  summary: "Summary",
  checklist: "Checklist",
  post: "Post",
};

/** Demo mode has no server documents — derive them from the seed task assets. */
function deriveDemoDocs(state: AppState): Document[] {
  const nameOf = (id: string) => state.agents.find((a) => a.id === id)?.name ?? "Operator";
  return state.tasks.flatMap((t) =>
    t.assets
      .filter((a) => a.content && a.content.trim().length > 60)
      .map((a) => ({
        id: a.id,
        workspace_id: state.workspace.id,
        agent_id: t.agent_id || null,
        author_name: t.agent_id ? nameOf(t.agent_id) : "Operator",
        task_id: t.id,
        task_title: t.title,
        name: a.title,
        content: a.content,
        folder: "",
        doc_type: a.asset_type,
        notion_url: null,
        created_at: t.created_at,
        updated_at: t.updated_at,
      })),
  );
}

function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "").trim() || "document";
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function metaLine(doc: Document): string {
  return `By ${doc.author_name}${doc.task_title ? ` · from ${doc.task_title}` : ""}`;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadMarkdown(doc: Document) {
  downloadBlob(new Blob([doc.content], { type: "text/markdown;charset=utf-8" }), `${safeName(doc.name)}.md`);
}

/** Word-openable .doc (HTML with a Word MIME type — opens in Word / Google Docs). */
function downloadWord(doc: Document) {
  const body = doc.content
    .split("\n")
    .map((l) => `<p style="margin:0 0 8pt;">${escapeHtml(l) || "&nbsp;"}</p>`)
    .join("");
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(doc.name)}</title></head>` +
    `<body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#111;">` +
    `<h1 style="font-size:16pt;margin:0 0 2pt;">${escapeHtml(doc.name)}</h1>` +
    `<p style="color:#666;font-size:9pt;margin:0 0 16pt;">${escapeHtml(metaLine(doc))}</p>${body}</body></html>`;
  downloadBlob(new Blob([html], { type: "application/msword" }), `${safeName(doc.name)}.doc`);
}

/** PDF via a hidden print iframe — the browser's "Save as PDF". Renders text + emoji cleanly. */
function printPdf(doc: Document) {
  const iframe = window.document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  window.document.body.appendChild(iframe);
  const idoc = iframe.contentWindow?.document;
  if (!idoc) {
    window.document.body.removeChild(iframe);
    return;
  }
  idoc.open();
  idoc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(doc.name)}</title>` +
      `<style>@page{margin:22mm;}body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.6;}` +
      `h1{font-size:18pt;margin:0 0 2pt;}.meta{color:#666;font-size:10pt;margin:0 0 18pt;}pre{white-space:pre-wrap;word-wrap:break-word;font-family:inherit;font-size:11pt;margin:0;}</style>` +
      `</head><body><h1>${escapeHtml(doc.name)}</h1><div class="meta">${escapeHtml(metaLine(doc))}</div><pre>${escapeHtml(doc.content)}</pre></body></html>`,
  );
  idoc.close();
  const win = iframe.contentWindow;
  if (win) {
    win.focus();
    win.print();
  }
  setTimeout(() => window.document.body.removeChild(iframe), 1500);
}

export default function DocumentsPage() {
  const { state, sendToNotion } = useStore();
  const serverMode = hasSupabaseClientEnv;
  const [author, setAuthor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const docs = useMemo(
    () => (!state ? [] : serverMode ? state.documents : deriveDemoDocs(state)),
    [state, serverMode],
  );

  const authors = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of docs) m.set(d.author_name, (m.get(d.author_name) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [docs]);

  if (!state) return null;

  const q = query.trim().toLowerCase();
  const filtered = docs
    .filter((d) => (author ? d.author_name === author : true))
    .filter((d) =>
      q
        ? d.name.toLowerCase().includes(q) ||
          d.author_name.toLowerCase().includes(q) ||
          d.task_title.toLowerCase().includes(q) ||
          d.content.toLowerCase().includes(q)
        : true,
    )
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  const open = openId ? docs.find((d) => d.id === openId) ?? null : null;

  async function onSendNotion(id: string) {
    setSending(true);
    try {
      await sendToNotion(id);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Documents"
        description="Every document your agents have produced, organized by author. View and download them in one place."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <FileText className="h-3.5 w-3.5" />
            {docs.length} document{docs.length === 1 ? "" : "s"}
          </span>
        }
      />
      <PageBody>
        <div className="relative mb-4 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents…"
            className="pl-9"
          />
        </div>

        {docs.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
            <div className="space-y-0.5">
              <FolderRow label="All documents" count={docs.length} active={author === null} onClick={() => setAuthor(null)} />
              {authors.map(([name, count]) => (
                <FolderRow key={name} label={name} count={count} active={author === name} onClick={() => setAuthor(name)} />
              ))}
            </div>

            <div className="space-y-2">
              {filtered.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted-foreground">No documents match.</p>
              ) : (
                filtered.map((d) => (
                  <Card key={d.id} className="card-interactive flex items-center gap-3 p-3">
                    <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpenId(d.id)}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{d.name}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">
                          {d.author_name}
                          {d.task_title ? ` · ${d.task_title}` : ""} · {relativeTime(d.created_at)}
                        </span>
                      </span>
                    </button>
                    <Badge className="hidden border-transparent bg-muted text-muted-foreground sm:inline-flex">
                      {TYPE_LABEL[d.doc_type] ?? d.doc_type}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => downloadMarkdown(d)} title="Download Markdown">
                      <Download className="h-4 w-4" />
                    </Button>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}
      </PageBody>

      {open && (
        <Drawer open onClose={() => setOpenId(null)}>
          <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold leading-tight">{open.name}</h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                By {open.author_name} · {relativeTime(open.created_at)}
                {open.task_title ? ` · from “${open.task_title}”` : ""}
              </p>
            </div>
            <button
              onClick={() => setOpenId(null)}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed text-foreground">
              {open.content}
            </pre>
          </div>
          <div className="flex shrink-0 flex-col gap-2.5 border-t border-border px-5 py-3.5">
            <div className="flex items-center gap-1.5">
              <span className="mr-1 text-[12px] font-medium text-muted-foreground">Download</span>
              <Button size="sm" variant="outline" onClick={() => printPdf(open)}>
                <Download className="h-3.5 w-3.5" /> PDF
              </Button>
              <Button size="sm" variant="outline" onClick={() => downloadWord(open)}>
                <Download className="h-3.5 w-3.5" /> Word
              </Button>
              <Button size="sm" variant="outline" onClick={() => downloadMarkdown(open)}>
                <Download className="h-3.5 w-3.5" /> .md
              </Button>
            </div>
            {open.notion_url ? (
              <Button variant="outline" onClick={() => window.open(open.notion_url ?? "", "_blank", "noopener")}>
                <ExternalLink className="h-4 w-4" /> View in Notion
              </Button>
            ) : (
              <Button variant="outline" disabled={sending} onClick={() => onSendNotion(open.id)}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send to Notion
              </Button>
            )}
          </div>
        </Drawer>
      )}
    </>
  );
}

function FolderRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
        active ? "bg-primary/10 font-medium text-primary" : "text-foreground/75 hover:bg-accent",
      )}
    >
      <Folder className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <FileText className="h-6 w-6" />
      </div>
      <h3 className="mt-3 text-[15px] font-semibold">No documents yet</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
        When an agent drafts a deliverable — a plan, an email, a summary, a triage report — it lands
        here, tagged with the agent that made it and the task it came from.
      </p>
    </div>
  );
}
