"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send } from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { getTeamAssistantHistoryAction, sendTeamAssistantMessageAction } from "@/app/actions";
import type { TeamAssistantMessage } from "@/lib/types";

const SUGGESTIONS = [
  "What should I focus on first?",
  "Summarize my open tasks.",
  "Help me draft a progress update on my project.",
  "What are my goals this week?",
];

/**
 * The team member's Team Assistant — a chat AI grounded ONLY in team-plane data
 * (their projects, tasks, goals, team docs, roster). It has no access to company
 * financials, the CRM, the owner's inbox, or the Executive's memory, so it can't
 * leak the owner's plane. Runs on Haiku. The owner's equivalent is the Executive.
 */
export default function AssistantPage() {
  const [messages, setMessages] = useState<TeamAssistantMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getTeamAssistantHistoryAction()
      .then((h) => setMessages(h))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, thinking]);

  async function send(text: string) {
    const body = text.trim();
    if (!body || thinking) return;
    setDraft("");
    setMessages((prev) => [
      ...prev,
      { id: `tmp-${prev.length}`, role: "user", content: body, created_at: new Date().toISOString() },
    ]);
    setThinking(true);
    const r = await sendTeamAssistantMessageAction(body);
    setThinking(false);
    setMessages((prev) => [
      ...prev,
      "ok" in r && r.ok
        ? r.reply
        : {
            id: `err-${prev.length}`,
            role: "assistant" as const,
            content: "error" in r ? r.error : "Something went wrong.",
            created_at: new Date().toISOString(),
          },
    ]);
  }

  return (
    <>
      <PageHeader
        title="Assistant"
        description="Your AI assistant for your own work — projects, tasks, goals, and the team docs. It doesn’t see company financials, the CRM, or anyone else's inbox."
      />
      <PageBody className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {loading ? (
              <div className="flex justify-center py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <Bot className="h-5.5 w-5.5" />
                </div>
                <p className="max-w-md text-sm text-muted-foreground">
                  I can help with your projects, tasks, goals, and the team docs. I don&apos;t see company financials or
                  the CRM — just your work.
                </p>
                <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm",
                      m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {thinking && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-border p-3">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              placeholder="Ask your assistant…"
              disabled={thinking}
            />
            <Button size="icon" onClick={() => send(draft)} disabled={thinking || !draft.trim()} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </PageBody>
    </>
  );
}
