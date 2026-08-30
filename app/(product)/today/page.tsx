"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlarmClock,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Gavel,
  Loader2,
  Mail,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { getTodayDataAction } from "@/app/actions";
import type { TodayData, TodayItem } from "@/lib/types";

const TONE: Record<TodayItem["tone"], { bar: string; chip: string }> = {
  urgent: { bar: "bg-red-500", chip: "bg-red-500/12 text-red-600 dark:text-red-400" },
  attention: { bar: "bg-amber-500", chip: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  normal: { bar: "bg-sky-500", chip: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
  positive: { bar: "bg-emerald-500", chip: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
};

function KindIcon({ kind }: { kind: TodayItem["kind"] }) {
  const cls = "h-4 w-4";
  if (kind === "approval") return <ClipboardCheck className={cls} />;
  if (kind === "board") return <Gavel className={cls} />;
  if (kind === "email") return <Mail className={cls} />;
  if (kind === "deadline") return <AlarmClock className={cls} />;
  if (kind === "opportunity") return <Sparkles className={cls} />;
  return <Zap className={cls} />;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tom = new Date(today.getTime() + 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tom.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function timeStr(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function TodayPage() {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTodayDataAction()
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const firstName = (data?.name ?? "").split(" ")[0] || "there";
  const dateLine = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <>
      <header className="shrink-0 border-b border-border bg-card px-5 py-5 sm:px-7">
        <h1 className="text-xl font-semibold tracking-tight">
          {greeting()}, {firstName}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{dateLine} · here&apos;s what needs you today.</p>
      </header>
      <PageBody>
        {loading ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !data ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Couldn&apos;t load your day. Try refreshing.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {data.kpis.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {data.kpis.slice(0, 5).map((k) => (
                  <Card key={k.key} className="p-3.5">
                    <p className="truncate text-[12px] text-muted-foreground">{k.label}</p>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <p className="text-xl font-semibold tabular-nums">{k.value}</p>
                      {k.delta && (
                        <span
                          className={cn(
                            "text-[11px] font-medium",
                            k.tone === "up" ? "text-emerald-600" : k.tone === "down" ? "text-red-600" : "text-muted-foreground",
                          )}
                        >
                          {k.delta}
                        </span>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
              {/* Needs you */}
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                  <h2 className="text-[15px] font-semibold">Needs you</h2>
                  <span className="text-[12px] text-muted-foreground">
                    {data.needsYou.length} item{data.needsYou.length === 1 ? "" : "s"}
                  </span>
                </div>
                {data.needsYou.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-5 py-12 text-center text-muted-foreground">
                    <CheckCircle2 className="h-9 w-9 opacity-40" />
                    <p className="text-sm">You&apos;re all caught up. Nothing needs you right now.</p>
                  </div>
                ) : (
                  <ul>
                    {data.needsYou.map((it, i) => (
                      <li key={it.id}>
                        <Link
                          href={it.href}
                          className={cn(
                            "flex items-start gap-3 px-5 py-3 transition hover:bg-accent/50",
                            i > 0 && "border-t border-border",
                          )}
                        >
                          <span className={cn("mt-0.5 h-8 w-1 shrink-0 rounded-full", TONE[it.tone].bar)} />
                          <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", TONE[it.tone].chip)}>
                            <KindIcon kind={it.kind} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] font-medium">{it.title}</span>
                            {it.detail && <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{it.detail}</span>}
                          </span>
                          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* Right column */}
              <div className="flex flex-col gap-5">
                <Card className="overflow-hidden">
                  <div className="border-b border-border px-5 py-3.5">
                    <h2 className="text-[15px] font-semibold">Coming up</h2>
                  </div>
                  {data.schedule.length === 0 ? (
                    <p className="px-5 py-6 text-[13px] text-muted-foreground">Nothing on the calendar in the next few days.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {data.schedule.map((s) => (
                        <li key={s.id} className="flex items-center gap-3 px-5 py-2.5">
                          <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium">{s.title}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {dayLabel(s.when)}
                              {s.kind !== "deadline" ? ` · ${timeStr(s.when)}` : ""}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                {data.opportunities.length > 0 && (
                  <Card className="overflow-hidden">
                    <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                      <h2 className="text-[15px] font-semibold">Fresh opportunities</h2>
                      <Link href="/opportunities" className="text-[12px] font-medium text-primary hover:underline">
                        View all
                      </Link>
                    </div>
                    <ul className="divide-y divide-border">
                      {data.opportunities.map((o) => (
                        <li key={o.id} className="px-5 py-2.5">
                          <a href={o.url || "#"} target="_blank" rel="noopener noreferrer" className="block">
                            <p className="truncate text-[13px] font-medium hover:underline">{o.title}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {[o.org, o.type, `fit ${o.fit_score}`].filter(Boolean).join(" · ")}
                            </p>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {data.brief && (
                  <Card className="p-5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-600">
                      <TrendingUp className="h-3.5 w-3.5" /> Daily brief
                    </div>
                    <p className="mt-1.5 text-[14px] font-medium leading-snug">{data.brief.headline}</p>
                    <Link
                      href="/executive"
                      className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
                    >
                      Open the full brief <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Card>
                )}
              </div>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}
