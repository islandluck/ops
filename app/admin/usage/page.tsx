"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { getAiUsageReportAction } from "@/app/actions";
import type { AiUsageReport } from "@/lib/ai/report";

const WINDOWS: { label: string; days?: number }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "All time" },
];

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
const usd = (n: number) => `$${n.toFixed(2)}`;

export default function AiUsagePage() {
  const [win, setWin] = useState(1); // default 30 days
  const [report, setReport] = useState<AiUsageReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void getAiUsageReportAction(WINDOWS[win].days).then((res) => {
      if (cancelled) return;
      if ("error" in res) {
        setError(res.error);
        setReport(null);
      } else {
        setReport(res);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [win]);

  return (
    <div className="mx-auto min-h-[100dvh] max-w-5xl px-5 py-8">
      <Link
        href="/approvals"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to app
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">AI usage</h1>
        <p className="text-[13.5px] text-muted-foreground">
          Claude token usage per workspace — who costs the most in AI. Cost is estimated from Anthropic list
          prices per model.
        </p>
      </div>

      <div className="mt-5 inline-flex rounded-lg border border-border p-0.5">
        {WINDOWS.map((w, i) => (
          <button
            key={w.label}
            onClick={() => setWin(i)}
            className={cn(
              "rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors",
              i === win ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {w.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <Card className="mt-6 p-8 text-center">
          <p className="text-[14px] font-semibold text-red-700">{error}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            This report is limited to operator accounts (set <code className="font-mono">ADMIN_EMAILS</code>).
          </p>
          <Link href="/login" className="mt-3 inline-block">
            <Button size="sm" variant="outline">
              Sign in
            </Button>
          </Link>
        </Card>
      ) : report ? (
        <>
          {/* Totals */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Est. cost", value: usd(report.totals.costUsd) },
              { label: "Calls", value: report.totals.calls.toLocaleString() },
              { label: "Input tokens", value: fmtTokens(report.totals.inputTokens) },
              { label: "Output tokens", value: fmtTokens(report.totals.outputTokens) },
            ].map((s) => (
              <Card key={s.label} className="p-3.5">
                <p className="text-[20px] font-semibold tabular-nums leading-none">{s.value}</p>
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">{s.label}</p>
              </Card>
            ))}
          </div>

          {/* Ranked table */}
          <Card className="mt-4 overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11.5px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">#</th>
                    <th className="px-4 py-2.5 font-semibold">Workspace</th>
                    <th className="px-4 py-2.5 font-semibold">Owner</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Calls</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Input</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Output</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                        No AI usage recorded in this window yet.
                      </td>
                    </tr>
                  ) : (
                    report.rows.map((r, i) => (
                      <tr key={r.workspaceId ?? "unattributed"} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-2.5 font-medium">{r.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.email || "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.calls.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {fmtTokens(r.inputTokens)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {fmtTokens(r.outputTokens)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{usd(r.costUsd)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            Metering covers agent runs, triage, social, and the Executive. Studio one-offs and a few long-tail
            operations record tokens but may show under “Unattributed” until their attribution is wired in.
          </p>
        </>
      ) : null}
    </div>
  );
}
