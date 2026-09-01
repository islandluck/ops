"use client";

import { useEffect, useRef, useState } from "react";
import { Check, IndentIncrease, Loader2, Plus, Send, Sparkles, Telescope, Trash2, X } from "lucide-react";
import Link from "next/link";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  getCommandCenterAction,
  routeDailyGoalAction,
  saveCommandCenterAction,
  sendGoalsToDeepDiveAction,
  sendGoalsToExecutiveAction,
  suggestGoalsAction,
} from "@/app/actions";
import type {
  CommandCenterDoc,
  CommandCenterHorizons,
  GoalItem,
  GoalPeriod,
  GoalSuggestion,
  GoalTarget,
} from "@/lib/types";

type ColKey = "monthly" | "weekly" | "daily" | "parking";
// Parking Lot removed from the grid to give the timeline columns more room; the
// underlying `parking` field is retained on the data model so nothing is lost.
const COLUMNS: { key: ColKey; label: string }[] = [
  { key: "monthly", label: "Monthly Goals" },
  { key: "weekly", label: "Weekly Goals" },
  { key: "daily", label: "Daily Goals" },
];

const HORIZONS: { key: keyof CommandCenterHorizons; label: string; hint: string; border: string; text: string }[] = [
  { key: "year", label: "Year Goals", hint: "next 12 months", border: "border-sky-200", text: "text-sky-700" },
  { key: "future", label: "Future Goals", hint: "2–3 years out", border: "border-indigo-200", text: "text-indigo-700" },
  { key: "moonshot", label: "Moonshot Goals", hint: "the dream", border: "border-violet-200", text: "text-violet-700" },
];

const TARGET_LABEL: Record<GoalTarget, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  daily: "Daily",
  parking: "Parking",
  year: "Year",
  future: "Future",
  moonshot: "Moonshot",
};
const TARGET_BADGE: Record<GoalTarget, string> = {
  monthly: "bg-sky-100 text-sky-700",
  weekly: "bg-emerald-100 text-emerald-700",
  daily: "bg-amber-100 text-amber-700",
  parking: "bg-slate-100 text-slate-600",
  year: "bg-sky-100 text-sky-700",
  future: "bg-indigo-100 text-indigo-700",
  moonshot: "bg-violet-100 text-violet-700",
};

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random()}`);
const newPeriod = (): GoalPeriod => ({ id: uid(), label: "New period", monthly: [], weekly: [], daily: [], parking: [] });

function grow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export default function CommandCenterPage() {
  const { state } = useStore();
  // Operator Lite: members keep their own goals doc, but the Executive / Deep Dive
  // hand-offs are owner-only surfaces — hide those controls for members.
  const isMember = !!state?.viewer?.isMember;
  const [doc, setDoc] = useState<CommandCenterDoc | null>(null);
  const docRef = useRef<CommandCenterDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [sendState, setSendState] = useState<"idle" | "busy" | "done">("idle");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<GoalSuggestion[] | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [deepDiveState, setDeepDiveState] = useState<"idle" | "busy" | "done">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void getCommandCenterAction().then((res) => {
      if ("error" in res) setError(res.error);
      else {
        setDoc(res);
        docRef.current = res;
      }
      setLoading(false);
    });
  }, []);

  // Client-authoritative debounced autosave (persists the whole doc, like Notes).
  function commit(next: CommandCenterDoc) {
    docRef.current = next;
    setDoc(next);
    setSaveState("saving");
    setSendState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveCommandCenterAction(next).then((r) => setSaveState(r.ok ? "saved" : "idle"));
    }, 700);
  }
  function mutate(fn: (d: CommandCenterDoc) => CommandCenterDoc) {
    const cur = docRef.current;
    if (cur) commit(fn(cur));
  }

  const setItems = (periodId: string, col: ColKey, items: GoalItem[]) =>
    mutate((d) => ({ ...d, periods: d.periods.map((p) => (p.id === periodId ? { ...p, [col]: items } : p)) }));
  const setLabel = (periodId: string, label: string) =>
    mutate((d) => ({ ...d, periods: d.periods.map((p) => (p.id === periodId ? { ...p, label } : p)) }));
  const addPeriod = () => mutate((d) => ({ ...d, periods: [...d.periods, newPeriod()] }));
  const removePeriod = (periodId: string) =>
    mutate((d) => ({ ...d, periods: d.periods.filter((p) => p.id !== periodId) }));
  const setHorizon = (key: keyof CommandCenterHorizons, items: GoalItem[]) =>
    mutate((d) => ({ ...d, horizons: { ...d.horizons, [key]: items } }));

  // Route a daily goal: email tasks → Email Manager draft, else → Executive.
  async function handlePush(text: string): Promise<{ ok: boolean; label?: string }> {
    const r = await routeDailyGoalAction(text);
    return "ok" in r && r.ok ? { ok: true, label: r.label } : { ok: false };
  }

  // Flush the debounced save so on-command actions read the latest goals.
  async function flushSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (docRef.current) {
      await saveCommandCenterAction(docRef.current);
      setSaveState("saved");
    }
  }

  async function sendToExec() {
    if (sendState === "busy") return;
    setSendState("busy");
    setError("");
    await flushSave();
    const r = await sendGoalsToExecutiveAction();
    setSendState(r.ok ? "done" : "idle");
    if (!r.ok) setError(r.error ?? "Couldn't send to the Executive.");
  }

  async function suggest() {
    if (suggesting) return;
    setSuggesting(true);
    setError("");
    setSuggestions(null);
    await flushSave(); // so suggestions consider the latest goals + avoid duplicates
    const r = await suggestGoalsAction();
    setSuggesting(false);
    if (!r.ok) {
      setError(r.error ?? "Couldn't get suggestions.");
      return;
    }
    if (!r.suggestions.length) {
      setError("No new goals to suggest right now — you're well set.");
      return;
    }
    setSuggestions(r.suggestions);
    setAccepted(new Set(r.suggestions.map((_, i) => i)));
  }

  function toggleAccept(i: number) {
    setAccepted((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  }

  function addSuggestions() {
    if (!suggestions) return;
    const chosen = suggestions.filter((_, i) => accepted.has(i));
    if (!chosen.length) {
      setSuggestions(null);
      return;
    }
    mutate((d) => {
      const periods = d.periods.length ? d.periods : [newPeriod()];
      const first: GoalPeriod = {
        ...periods[0],
        monthly: [...periods[0].monthly],
        weekly: [...periods[0].weekly],
        daily: [...periods[0].daily],
        parking: [...periods[0].parking],
      };
      const horizons: CommandCenterHorizons = {
        year: [...d.horizons.year],
        future: [...d.horizons.future],
        moonshot: [...d.horizons.moonshot],
      };
      for (const s of chosen) {
        const item: GoalItem = { id: uid(), text: s.text, done: false, indent: 0 };
        if (s.target === "monthly" || s.target === "weekly" || s.target === "daily" || s.target === "parking") {
          first[s.target].push(item);
        } else {
          horizons[s.target].push(item);
        }
      }
      return { ...d, periods: [first, ...periods.slice(1)], horizons };
    });
    setSuggestions(null);
  }

  async function sendToDeepDive() {
    if (deepDiveState === "busy") return;
    setDeepDiveState("busy");
    setError("");
    await flushSave();
    const r = await sendGoalsToDeepDiveAction();
    setDeepDiveState(r.ok ? "done" : "idle");
    if (!r.ok) setError(r.error ?? "Couldn't send to Deep Dive.");
  }

  return (
    <>
      <PageHeader
        title="Command Center"
        description="Your goals across every timeline — monthly, weekly, daily, and the big horizons. This space is yours to write; the Executive reads it on command."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <span className="text-[11px] text-muted-foreground">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
            </span>
            {!isMember && (
              <>
                <Button size="sm" variant="outline" disabled={suggesting || !doc} onClick={suggest}>
                  {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {suggesting ? "Thinking…" : "Suggest goals"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deepDiveState === "busy" || !doc}
                  onClick={sendToDeepDive}
                >
                  {deepDiveState === "busy" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : deepDiveState === "done" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Telescope className="h-4 w-4" />
                  )}
                  {deepDiveState === "done" ? "Sent to Deep Dive" : "Send to Deep Dive"}
                </Button>
                <Button
                  size="sm"
                  variant={sendState === "done" ? "outline" : undefined}
                  disabled={sendState === "busy" || !doc}
                  onClick={sendToExec}
                >
                  {sendState === "busy" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : sendState === "done" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {sendState === "done" ? "Sent to Executive" : "Update Executive"}
                </Button>
              </>
            )}
          </div>
        }
      />
      <PageBody>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error && !doc ? (
          <Card className="p-8 text-center text-[13px] text-red-700">{error}</Card>
        ) : doc ? (
          <div className="space-y-6">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                {error}
              </div>
            )}

            {deepDiveState === "done" && (
              <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-violet-800">
                <Telescope className="h-4 w-4 shrink-0" />
                <span>
                  Your goals are being absorbed into company knowledge.{" "}
                  <Link href="/deep-dive" className="font-semibold underline underline-offset-2">
                    Open Deep Dive
                  </Link>{" "}
                  to watch it process.
                </span>
              </div>
            )}

            {suggestions && (
              <Card className="border-primary/30 bg-primary/[0.03] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <p className="text-[13px] font-semibold">
                    The Executive suggests {suggestions.length} goal{suggestions.length === 1 ? "" : "s"}
                  </p>
                  <span className="text-[11.5px] text-muted-foreground">— uncheck any you don't want</span>
                </div>
                <div className="space-y-1">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => toggleAccept(i)}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted/50"
                    >
                      <span
                        className={cn(
                          "mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded border transition",
                          accepted.has(i) ? "border-primary bg-primary text-white" : "border-border",
                        )}
                      >
                        {accepted.has(i) ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide",
                          TARGET_BADGE[s.target],
                        )}
                      >
                        {TARGET_LABEL[s.target]}
                      </span>
                      <span
                        className={cn(
                          "flex-1 text-[13px] leading-snug",
                          !accepted.has(i) && "text-muted-foreground line-through",
                        )}
                      >
                        {s.text}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button size="sm" disabled={accepted.size === 0} onClick={addSuggestions}>
                    <Plus className="h-4 w-4" />
                    Add {accepted.size} to my goals
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSuggestions(null)}>
                    Dismiss
                  </Button>
                </div>
              </Card>
            )}

            {/* Period grid */}
            <div className="space-y-3">
              {doc.periods.map((p) => (
                <PeriodRow
                  key={p.id}
                  period={p}
                  onLabel={(l) => setLabel(p.id, l)}
                  onItems={(col, items) => setItems(p.id, col, items)}
                  onRemove={() => removePeriod(p.id)}
                  onPush={isMember ? undefined : handlePush}
                />
              ))}
              <Button size="sm" variant="outline" onClick={addPeriod}>
                <Plus className="h-4 w-4" />
                Add period
              </Button>
            </div>

            {/* Horizons */}
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                Horizons
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {HORIZONS.map((h) => (
                  <div key={h.key} className={cn("rounded-xl border bg-card p-3", h.border)}>
                    <div className="mb-1.5 flex items-baseline gap-2">
                      <p className={cn("text-[13px] font-semibold", h.text)}>{h.label}</p>
                      <span className="text-[11px] text-muted-foreground">{h.hint}</span>
                    </div>
                    <BulletList items={doc.horizons[h.key]} onChange={(items) => setHorizon(h.key, items)} />
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[11.5px] text-muted-foreground">
              Tip: press <kbd className="rounded border border-border px-1">Enter</kbd> for a new goal,{" "}
              <kbd className="rounded border border-border px-1">Tab</kbd> to indent, and the checkbox to mark one
              done (strikethrough). Nothing here is edited by the agents — it's your space.
            </p>
          </div>
        ) : null}
      </PageBody>
    </>
  );
}

function PeriodRow({
  period,
  onLabel,
  onItems,
  onRemove,
  onPush,
}: {
  period: GoalPeriod;
  onLabel: (label: string) => void;
  onItems: (col: ColKey, items: GoalItem[]) => void;
  onRemove: () => void;
  onPush?: (text: string) => Promise<{ ok: boolean; label?: string }>;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="group/period mb-2.5 flex items-center gap-2">
        <input
          value={period.label}
          onChange={(e) => onLabel(e.target.value)}
          placeholder="Period (e.g., August 2026)"
          className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/60"
        />
        <button
          onClick={onRemove}
          title="Remove period"
          className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover/period:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {COLUMNS.map((c) => (
          <div key={c.key} className="rounded-lg border border-border bg-card p-2.5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              {c.label}
            </p>
            <BulletList
              items={period[c.key]}
              onChange={(items) => onItems(c.key, items)}
              onPush={c.key === "daily" ? onPush : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The reusable bullet editor: checkbox → strikethrough, inline auto-grow text, add/delete, one indent level. */
function BulletList({
  items,
  onChange,
  onPush,
}: {
  items: GoalItem[];
  onChange: (items: GoalItem[]) => void;
  onPush?: (text: string) => Promise<{ ok: boolean; label?: string }>;
}) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [pushedId, setPushedId] = useState<string | null>(null);
  const [pushedLabel, setPushedLabel] = useState<string>("");
  const refs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  async function push(id: string, text: string) {
    if (!onPush || !text.trim() || pushingId) return;
    setPushingId(id);
    const r = await onPush(text);
    setPushingId(null);
    if (r.ok) {
      setPushedId(id);
      setPushedLabel(r.label ?? "Sent");
      setTimeout(() => setPushedId((cur) => (cur === id ? null : cur)), 2400);
    }
  }

  useEffect(() => {
    if (!focusId) return;
    const el = refs.current.get(focusId);
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
    setFocusId(null);
  }, [focusId]);

  const update = (id: string, patch: Partial<GoalItem>) =>
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  function addAfter(id: string | null, indent: 0 | 1 = 0) {
    const item: GoalItem = { id: uid(), text: "", done: false, indent };
    if (id === null) {
      onChange([...items, item]);
    } else {
      const idx = items.findIndex((i) => i.id === id);
      onChange([...items.slice(0, idx + 1), item, ...items.slice(idx + 1)]);
    }
    setFocusId(item.id);
  }

  function remove(id: string) {
    const idx = items.findIndex((i) => i.id === id);
    const prev = items[idx - 1];
    onChange(items.filter((i) => i.id !== id));
    if (prev) setFocusId(prev.id);
  }

  return (
    <div className="space-y-0.5">
      {items.map((it) => (
        <div key={it.id} className={cn("group/item flex items-start gap-1.5", it.indent === 1 && "pl-5")}>
          <button
            onClick={() => update(it.id, { done: !it.done })}
            title={it.done ? "Mark not done" : "Mark done"}
            className={cn(
              "mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded border transition",
              it.done ? "border-primary bg-primary text-white" : "border-border hover:border-primary/50",
            )}
          >
            {it.done ? <Check className="h-3 w-3" /> : null}
          </button>
          <textarea
            ref={(el) => {
              if (el) {
                refs.current.set(it.id, el);
                grow(el);
              } else {
                refs.current.delete(it.id);
              }
            }}
            value={it.text}
            rows={1}
            placeholder="Goal…"
            onChange={(e) => {
              update(it.id, { text: e.target.value });
              grow(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                addAfter(it.id, it.indent);
              } else if (e.key === "Backspace" && it.text === "") {
                e.preventDefault();
                remove(it.id);
              } else if (e.key === "Tab") {
                e.preventDefault();
                update(it.id, { indent: e.shiftKey ? 0 : 1 });
              }
            }}
            className={cn(
              "min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-[13px] leading-snug outline-none placeholder:text-muted-foreground/50",
              it.done && "text-muted-foreground line-through",
            )}
          />
          <div
            className={cn(
              "flex shrink-0 items-center gap-0.5 pt-0.5 transition group-hover/item:opacity-100",
              pushedId === it.id ? "opacity-100" : "opacity-0",
            )}
          >
            {pushedId === it.id && pushedLabel && (
              <span className="mr-1 whitespace-nowrap text-[10px] font-medium text-success">{pushedLabel}</span>
            )}
            {onPush && it.text.trim() && (
              <button
                onClick={() => push(it.id, it.text)}
                title="Send to Executive"
                className="rounded p-0.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
              >
                {pushingId === it.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : pushedId === it.id ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            <button
              onClick={() => update(it.id, { indent: it.indent === 1 ? 0 : 1 })}
              title={it.indent === 1 ? "Outdent" : "Indent"}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <IndentIncrease className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => remove(it.id)}
              title="Delete"
              className="rounded p-0.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={() => addAfter(items[items.length - 1]?.id ?? null)}
        className="mt-1 inline-flex items-center gap-1 text-[12px] text-muted-foreground transition hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        {items.length === 0 ? "Add a goal" : "Add"}
      </button>
    </div>
  );
}
