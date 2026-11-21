"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Star, Target, Trash2, TrendingUp } from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  frCreateInvestorAction,
  frCreateRoundAction,
  frDeleteInvestorAction,
  frDeleteRoundAction,
  frListInvestorsAction,
  frListRoundsAction,
  frUpdateInvestorAction,
  frUpdateRoundAction,
} from "@/app/actions";
import type { FundraiseInvestor, FundraiseRound, FundraiseStage } from "@/lib/types";

const STAGES: { key: FundraiseStage; label: string; tint: string }[] = [
  { key: "researching", label: "Researching", tint: "text-slate-500" },
  { key: "contacted", label: "Contacted", tint: "text-sky-600 dark:text-sky-400" },
  { key: "meeting", label: "Meeting", tint: "text-violet-600 dark:text-violet-400" },
  { key: "pitched", label: "Pitched", tint: "text-indigo-600 dark:text-indigo-400" },
  { key: "diligence", label: "Diligence", tint: "text-amber-600 dark:text-amber-400" },
  { key: "term_sheet", label: "Term sheet", tint: "text-teal-600 dark:text-teal-400" },
  { key: "committed", label: "Committed", tint: "text-emerald-600 dark:text-emerald-400" },
  { key: "closed", label: "Closed", tint: "text-emerald-700 dark:text-emerald-300" },
  { key: "passed", label: "Passed", tint: "text-muted-foreground" },
];

function money(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
const selectCls = "mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm";

/* ------------------------------ round dialog ----------------------------- */

function RoundDialog({
  round,
  open,
  onClose,
  onChanged,
}: {
  round: FundraiseRound | null;
  open: boolean;
  onClose: () => void;
  onChanged: (roundId?: string) => void;
}) {
  const editing = !!round;
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [valuation, setValuation] = useState("");
  const [close, setClose] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(round?.name ?? "");
    setTarget(round?.target_amount != null ? String(round.target_amount) : "");
    setValuation(round?.valuation != null ? String(round.valuation) : "");
    setClose(round?.close_date ? round.close_date.slice(0, 10) : "");
    setNote(round?.note ?? "");
    setError(null);
  }, [open, round]);

  async function save() {
    if (!name.trim()) {
      setError("Name the round (e.g. Seed).");
      return;
    }
    setBusy(true);
    setError(null);
    const patch = {
      name,
      target_amount: target.trim() ? Number(target) : null,
      valuation: valuation.trim() ? Number(valuation) : null,
      close_date: close ? new Date(close).toISOString() : null,
      note,
    };
    if (editing) {
      await frUpdateRoundAction(round!.id, patch);
      setBusy(false);
      onChanged(round!.id);
      onClose();
    } else {
      const r = await frCreateRoundAction(patch);
      setBusy(false);
      if (r.ok) {
        onChanged(r.roundId);
        onClose();
      } else setError(r.error ?? "Couldn't create the round.");
    }
  }
  async function remove() {
    if (!round) return;
    if (!window.confirm(`Delete the "${round.name}" round and its investor pipeline?`)) return;
    await frDeleteRoundAction(round.id);
    onChanged();
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={editing ? "Edit round" : "New round"} className="max-w-md">
      <div className="flex flex-col gap-3">
        <div>
          <Label>Round</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seed" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Target ($)</Label>
            <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="1500000" />
          </div>
          <div>
            <Label>Valuation ($)</Label>
            <Input type="number" value={valuation} onChange={(e) => setValuation(e.target.value)} placeholder="12000000" />
          </div>
        </div>
        <div>
          <Label>Target close</Label>
          <Input type="date" value={close} onChange={(e) => setClose(e.target.value)} />
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Thesis, terms, the story…" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          {editing ? (
            <button type="button" onClick={remove} className="text-muted-foreground transition hover:text-destructive" title="Delete round">
              <Trash2 className="h-4 w-4" />
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------------------- investor dialogs --------------------------- */

function InvestorDialog({
  investor,
  onClose,
  onChanged,
}: {
  investor: FundraiseInvestor | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [check, setCheck] = useState("");
  const [stage, setStage] = useState<FundraiseStage>("researching");
  const [isLead, setIsLead] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!investor) return;
    setName(investor.name);
    setCheck(investor.check_amount != null ? String(investor.check_amount) : "");
    setStage(investor.stage);
    setIsLead(investor.is_lead);
    setNote(investor.note);
  }, [investor]);

  if (!investor) return null;

  async function save() {
    setBusy(true);
    await frUpdateInvestorAction(investor!.id, {
      name,
      check_amount: check.trim() ? Number(check) : null,
      stage,
      is_lead: isLead,
      note,
    });
    setBusy(false);
    onChanged();
  }
  async function remove() {
    if (!window.confirm(`Remove ${investor!.name}?`)) return;
    await frDeleteInvestorAction(investor!.id);
    onChanged();
    onClose();
  }

  return (
    <Dialog open={!!investor} onClose={onClose} title={investor.name || "Investor"} className="max-w-md">
      <div className="flex flex-col gap-3">
        <div>
          <Label>Investor / firm</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
          {investor.company_name && investor.company_name !== investor.name && (
            <p className="mt-1 text-[11px] text-muted-foreground">In your CRM as {investor.company_name}</p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Check ($)</Label>
            <Input type="number" value={check} onChange={(e) => setCheck(e.target.value)} placeholder="250000" className="w-full" />
          </div>
          <div>
            <Label>Stage</Label>
            <select value={stage} onChange={(e) => setStage(e.target.value as FundraiseStage)} className={selectCls}>
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <input type="checkbox" checked={isLead} onChange={(e) => setIsLead(e.target.checked)} className="h-3.5 w-3.5 rounded border-border accent-primary" />
          <span>Potential lead investor</span>
        </label>
        <div>
          <Label>Notes</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Partner, thesis fit, next step…" />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <button type="button" onClick={remove} className="text-muted-foreground transition hover:text-destructive" title="Remove investor">
            <Trash2 className="h-4 w-4" />
          </button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AddInvestorDialog({
  open,
  roundId,
  onClose,
  onAdded,
}: {
  open: boolean;
  roundId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [check, setCheck] = useState("");
  const [stage, setStage] = useState<FundraiseStage>("researching");
  const [isLead, setIsLead] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setCheck("");
    setStage("researching");
    setIsLead(false);
    setError(null);
  }, [open]);

  async function add() {
    if (!name.trim()) {
      setError("Add the investor or firm name.");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await frCreateInvestorAction({
      round_id: roundId,
      name,
      check_amount: check.trim() ? Number(check) : null,
      stage,
      is_lead: isLead,
    });
    setSaving(false);
    if (r.ok) {
      onAdded();
      onClose();
    } else setError(r.error ?? "Couldn't add the investor.");
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add investor" className="max-w-md">
      <div className="flex flex-col gap-3">
        <div>
          <Label>Investor / firm</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Ventures" />
          <p className="mt-1 text-[11px] text-muted-foreground">Also added to your CRM as an investor relationship.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Check ($)</Label>
            <Input type="number" value={check} onChange={(e) => setCheck(e.target.value)} placeholder="250000" />
          </div>
          <div>
            <Label>Stage</Label>
            <select value={stage} onChange={(e) => setStage(e.target.value as FundraiseStage)} className={selectCls}>
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <input type="checkbox" checked={isLead} onChange={(e) => setIsLead(e.target.checked)} className="h-3.5 w-3.5 rounded border-border accent-primary" />
          <span>Potential lead investor</span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Add
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* --------------------------------- page ---------------------------------- */

export default function FundraisePage() {
  const [rounds, setRounds] = useState<FundraiseRound[] | null>(null);
  const [roundId, setRoundId] = useState<string>("");
  const [investors, setInvestors] = useState<FundraiseInvestor[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [roundDialog, setRoundDialog] = useState<{ open: boolean; round: FundraiseRound | null }>({ open: false, round: null });
  const [openInvestor, setOpenInvestor] = useState<FundraiseInvestor | null>(null);

  const loadRounds = useCallback(async () => {
    const rs = await frListRoundsAction();
    setRounds(rs);
    setRoundId((cur) => (cur && rs.some((r) => r.id === cur) ? cur : rs.find((r) => r.status === "open")?.id ?? rs[0]?.id ?? ""));
  }, []);
  const loadInvestors = useCallback(async () => {
    if (!roundId) {
      setInvestors([]);
      return;
    }
    setInvestors(await frListInvestorsAction(roundId));
  }, [roundId]);
  useEffect(() => {
    loadRounds();
  }, [loadRounds]);
  useEffect(() => {
    loadInvestors();
  }, [loadInvestors]);

  const round = rounds?.find((r) => r.id === roundId) ?? null;
  const byStage = useMemo(() => {
    const m = new Map<FundraiseStage, FundraiseInvestor[]>();
    for (const s of STAGES) m.set(s.key, []);
    for (const v of investors ?? []) m.get(v.stage)?.push(v);
    return m;
  }, [investors]);

  async function move(id: string, stage: FundraiseStage) {
    await frUpdateInvestorAction(id, { stage });
    await loadInvestors();
    await loadRounds();
  }

  const pct = round?.target_amount ? Math.min(100, Math.round(((round.committed ?? 0) / round.target_amount) * 100)) : null;

  return (
    <>
      <PageHeader
        title="Fundraise"
        description="Run your raise like a pipeline — track the round, the target, and every investor from first touch to wired."
        actions={
          <div className="flex items-center gap-2">
            {rounds && rounds.length > 0 && (
              <select value={roundId} onChange={(e) => setRoundId(e.target.value)} className="h-8 rounded-lg border border-border bg-card px-2 text-[12.5px] font-medium">
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.status === "closed" ? " (closed)" : ""}
                  </option>
                ))}
              </select>
            )}
            <Button size="sm" variant="outline" onClick={() => setRoundDialog({ open: true, round: null })}>
              <Plus className="h-4 w-4" /> New round
            </Button>
          </div>
        }
      />
      <PageBody className="space-y-5">
        {rounds === null ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !round ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Target className="h-9 w-9 opacity-40" />
            <p className="max-w-sm text-sm">Start your raise. Create a round — target, valuation, close date — then build the investor pipeline.</p>
            <Button size="sm" onClick={() => setRoundDialog({ open: true, round: null })}>
              <Plus className="h-4 w-4" /> New round
            </Button>
          </div>
        ) : (
          <>
            {/* Round tracker */}
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <button onClick={() => setRoundDialog({ open: true, round })} className="text-left">
                    <h2 className="text-base font-semibold hover:underline">
                      {round.name}
                      {round.valuation ? <span className="ml-2 text-[12px] font-normal text-muted-foreground">at {money(round.valuation)}</span> : null}
                    </h2>
                  </button>
                  <p className="text-[11px] text-muted-foreground">
                    {round.committed_count ?? 0} committed · {(round.investor_count ?? 0) - (round.committed_count ?? 0)} in pipeline
                    {round.close_date ? ` · target close ${new Date(round.close_date).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{money(round.committed ?? 0)}</div>
                  <div className="text-[11px] text-muted-foreground">committed{round.target_amount ? ` of ${money(round.target_amount)}` : ""}</div>
                </div>
              </div>
              {pct != null && (
                <div className="mt-3">
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                    <span>{pct}% to target</span>
                    <span className="inline-flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" /> {money(round.in_pipeline ?? 0)} in pipeline
                    </span>
                  </div>
                </div>
              )}
            </Card>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add investor
              </Button>
            </div>

            {investors === null ? (
              <div className="flex justify-center py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : investors.length === 0 ? (
              <Card className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <Star className="h-8 w-8 opacity-40" />
                <p className="text-sm">No investors yet.</p>
                <p className="text-xs">Add investors and move them from Researching to Closed.</p>
              </Card>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {STAGES.map((st) => {
                  const col = byStage.get(st.key) ?? [];
                  return (
                    <div key={st.key} className="flex w-64 shrink-0 flex-col gap-2">
                      <div className="flex items-center justify-between px-1">
                        <span className={cn("text-[12px] font-semibold", st.tint)}>{st.label}</span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">{col.length}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {col.map((v) => (
                          <Card key={v.id} className="p-2.5">
                            <button type="button" className="block w-full text-left" onClick={() => setOpenInvestor(v)}>
                              <div className="flex items-start justify-between gap-2">
                                <span className="truncate text-sm font-medium">{v.name}</span>
                                {v.is_lead && (
                                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                    <Star className="h-2.5 w-2.5" /> Lead
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-[12px] font-medium tabular-nums text-muted-foreground">{money(v.check_amount)}</div>
                            </button>
                            <div className="mt-2 flex justify-end">
                              <select
                                value={v.stage}
                                onChange={(e) => move(v.id, e.target.value as FundraiseStage)}
                                className="rounded-md border border-border bg-card px-1.5 py-1 text-[11px]"
                              >
                                {STAGES.map((s) => (
                                  <option key={s.key} value={s.key}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </PageBody>

      <RoundDialog
        round={roundDialog.round}
        open={roundDialog.open}
        onClose={() => setRoundDialog({ open: false, round: null })}
        onChanged={(id) => {
          loadRounds();
          if (id) setRoundId(id);
        }}
      />
      <AddInvestorDialog
        open={addOpen}
        roundId={roundId}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          loadInvestors();
          loadRounds();
        }}
      />
      <InvestorDialog
        investor={openInvestor}
        onClose={() => setOpenInvestor(null)}
        onChanged={() => {
          loadInvestors();
          loadRounds();
          setOpenInvestor(null);
        }}
      />
    </>
  );
}
