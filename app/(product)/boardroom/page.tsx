"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Gavel, Loader2, ScrollText, Send, Sparkles, Target } from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { markdownToHtml } from "@/lib/content/format";
import {
  advanceBoardAction,
  conveneBoardAction,
  getBoardroomAction,
  getBoardSessionAction,
} from "@/app/actions";
import type { BoardMember, BoardSession, BoardSessionStatus, BoardSessionSummary } from "@/lib/types";

const ROLE_LABEL: Record<string, string> = {
  finance: "Finance",
  marketing: "Marketing",
  product: "Product",
  strategy: "Strategy",
  technology: "Technology",
  chair: "Chair",
  custom: "Advisor",
};
const ACCENT: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  violet: "bg-violet-100 text-violet-700",
  sky: "bg-sky-100 text-sky-700",
  rose: "bg-rose-100 text-rose-700",
  slate: "bg-slate-100 text-slate-600",
};
const STAGE_LABEL: Record<BoardSessionStatus, string> = {
  opening_pending: "The board is forming opening positions…",
  rebuttal_pending: "The board is debating…",
  verdict_pending: "The Chair is weighing the verdict…",
  complete: "",
  failed: "",
};

const PROMPTS = [
  "Assess where we stand and what's holding us back.",
  "What are the 3 highest-leverage moves to reach $10B faster?",
  "Who are our real competitors, and how do we beat them?",
  "Where am I fooling myself about this business?",
];

/** Render the board's markdown (bold, lists, paragraphs) — HTML-escaped + safe. */
function Md({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn("prose-chat", className)}
      dangerouslySetInnerHTML={{ __html: markdownToHtml(children) }}
    />
  );
}

function blankSession(id: string, title: string): BoardSession {
  return {
    id,
    title,
    trigger: "user",
    status: "opening_pending",
    verdict: "",
    disagreements: [],
    recommendations: [],
    accountability: "",
    contributions: [],
    error: "",
    created_at: new Date().toISOString(),
    completed_at: null,
  };
}

export default function BoardroomPage() {
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [sessions, setSessions] = useState<BoardSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [convening, setConvening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<BoardSession | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const r = await getBoardroomAction();
    if ("error" in r) setError(r.error);
    else {
      setMembers(r.members);
      setSessions(r.sessions);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const drive = useCallback(async (id: string) => {
    setBusy(true);
    for (let i = 0; i < 5; i++) {
      const r = await advanceBoardAction(id);
      if (!r.ok) {
        setError(r.error);
        break;
      }
      setActive(r.session);
      if (r.session.status === "complete" || r.session.status === "failed") break;
    }
    setBusy(false);
    void load();
  }, [load]);

  async function convene(q?: string) {
    const text = (q ?? question).trim();
    if (!text || convening || busy) return;
    setConvening(true);
    setError("");
    const r = await conveneBoardAction(text);
    setConvening(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setQuestion("");
    setActive(blankSession(r.id, text));
    void drive(r.id);
  }

  async function openSession(id: string) {
    setError("");
    const r = await getBoardSessionAction(id);
    if ("session" in r) setActive(r.session);
    else setError(r.error);
  }

  return (
    <>
      <PageHeader
        title="The Boardroom"
        description="Your standing board of VC-caliber advisors — Finance, Marketing, Product, Strategy, Technology. They deliberate, debate, and hold you accountable to one mission: $10B, as fast as possible."
        actions={
          active ? (
            <Button size="sm" variant="outline" onClick={() => setActive(null)} disabled={busy}>
              <ArrowLeft className="h-4 w-4" />
              Back to the board
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : active ? (
          <Deliberation session={active} busy={busy} />
        ) : (
          <div className="space-y-6">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
            )}

            {/* Convene */}
            <Card className="p-4">
              <p className="flex items-center gap-1.5 text-[14px] font-semibold">
                <Gavel className="h-4 w-4 text-primary" /> Convene the board
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Put a matter before them, or ask for a hard assessment. They'll debate it and deliver a verdict — even
                if it's not what you want to hear.
              </p>
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={3}
                placeholder="e.g. Should we raise now, or push for another two quarters of growth first?"
                className="mt-3 text-[13px]"
              />
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" disabled={convening || busy || !question.trim()} onClick={() => convene()}>
                  {convening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Convene the board
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {PROMPTS.map((p) => (
                  <button
                    key={p}
                    disabled={convening || busy}
                    onClick={() => convene(p)}
                    className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </Card>

            {/* Roster */}
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                Your board
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {members.map((m) => (
                  <Card key={m.id} className="p-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg text-lg", ACCENT[m.accent] ?? ACCENT.slate)}>
                        {m.emoji}
                      </span>
                      <div>
                        <p className="text-[13.5px] font-semibold">{m.name}</p>
                        <p className="text-[11px] text-muted-foreground">{ROLE_LABEL[m.role] ?? m.role}</p>
                      </div>
                    </div>
                    <p className="mt-2.5 line-clamp-4 text-[12px] leading-relaxed text-foreground/80">{m.mandate}</p>
                  </Card>
                ))}
              </div>
            </div>

            {/* History */}
            {sessions.length > 0 && (
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Past deliberations
                </p>
                <Card className="divide-y divide-border p-0">
                  {sessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => openSession(s.id)}
                      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <ScrollText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{s.title}</span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                          s.status === "complete"
                            ? "bg-emerald-100 text-emerald-700"
                            : s.status === "failed"
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-700",
                        )}
                      >
                        {s.status === "complete" ? "Verdict" : s.status === "failed" ? "Failed" : "In progress"}
                      </span>
                    </button>
                  ))}
                </Card>
              </div>
            )}
          </div>
        )}
      </PageBody>
    </>
  );
}

function Deliberation({ session, busy }: { session: BoardSession; busy: boolean }) {
  const openings = session.contributions.filter((c) => c.round === "opening");
  const rebuttals = session.contributions.filter((c) => c.round === "rebuttal");
  const stageNote = busy ? STAGE_LABEL[session.status] : "";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Matter before the board</p>
        <p className="mt-0.5 text-[16px] font-semibold">{session.title}</p>
      </div>

      {session.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
          {session.error}
        </div>
      )}

      {/* Openings */}
      {(openings.length > 0 || (busy && session.status === "opening_pending")) && (
        <Section title="Opening positions">
          {openings.map((c) => (
            <Contribution key={c.id} c={c} />
          ))}
          {busy && session.status === "opening_pending" && <StageSpinner label={STAGE_LABEL.opening_pending} />}
        </Section>
      )}

      {/* Debate */}
      {(rebuttals.length > 0 || (busy && session.status === "rebuttal_pending")) && (
        <Section title="The debate">
          {rebuttals.map((c) => (
            <Contribution key={c.id} c={c} rebuttal />
          ))}
          {busy && session.status === "rebuttal_pending" && <StageSpinner label={STAGE_LABEL.rebuttal_pending} />}
        </Section>
      )}

      {/* Verdict */}
      {busy && session.status === "verdict_pending" && (
        <Card className="border-primary/30 bg-primary/[0.03] p-4">
          <StageSpinner label={STAGE_LABEL.verdict_pending} />
        </Card>
      )}
      {session.status === "complete" && <Verdict session={session} />}

      {stageNote && session.status !== "verdict_pending" && (
        <p className="text-[11.5px] text-muted-foreground">{stageNote}</p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground/70">{title}</p>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Contribution({ c, rebuttal }: { c: BoardSession["contributions"][number]; rebuttal?: boolean }) {
  return (
    <Card className={cn("p-3.5", rebuttal && "border-dashed")}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-[15px]">{c.member_emoji}</span>
        <div className="flex items-baseline gap-1.5">
          <p className="text-[13px] font-semibold">{c.member_name}</p>
          <p className="text-[11px] text-muted-foreground">{ROLE_LABEL[c.member_role] ?? c.member_role}</p>
        </div>
      </div>
      <Md className="text-[12.5px] leading-relaxed text-foreground/90">{c.content}</Md>
    </Card>
  );
}

function StageSpinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-2 text-[12.5px] text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function Verdict({ session }: { session: BoardSession }) {
  return (
    <Card className="border-primary/30 bg-primary/[0.04] p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-primary">
        <Gavel className="h-4 w-4" /> The board's verdict
      </p>
      <Md className="mt-2 text-[13.5px] leading-relaxed text-foreground">{session.verdict}</Md>

      {session.disagreements.length > 0 && (
        <div className="mt-3.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Where the board split
          </p>
          <ul className="space-y-1.5">
            {session.disagreements.map((d, i) => (
              <li key={i} className="border-l-2 border-border pl-2.5">
                <Md className="text-[12.5px] leading-relaxed text-foreground/80">{d}</Md>
              </li>
            ))}
          </ul>
        </div>
      )}

      {session.recommendations.length > 0 && (
        <div className="mt-3.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Do this next
          </p>
          <ol className="space-y-2">
            {session.recommendations.map((r, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{r.title}</p>
                  {r.detail && <Md className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{r.detail}</Md>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {session.accountability && (
        <div className="mt-3.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            <Target className="h-3.5 w-3.5" /> What you must own
          </p>
          <Md className="mt-1 text-[12.5px] leading-relaxed text-amber-900">{session.accountability}</Md>
        </div>
      )}
    </Card>
  );
}
