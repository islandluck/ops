"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  AtSign,
  Check,
  Clock,
  Download,
  Flag,
  Handshake,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Star,
  Target,
  Trash2,
  TrendingUp,
  Upload,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  frAddIntroPathAction,
  frCreateInvestorAction,
  frCreateRoundAction,
  frDeleteInvestorAction,
  frDeleteIntroPathAction,
  frDeleteRoundAction,
  frImportInvestorsAction,
  frListInvestorsAction,
  frListIntroPathsAction,
  frListRoundsAction,
  frRequestIntroAction,
  frResearchIntroPathsAction,
  frScoutFounderEmailAction,
  frUpdateIntroPathAction,
  frUpdateInvestorAction,
  frUpdateRoundAction,
} from "@/app/actions";
import type { FundraiseInvestor, FundraiseIntroPath, FundraiseIntroStatus, FundraiseRound, FundraiseStage } from "@/lib/types";

type ImportResult = Awaited<ReturnType<typeof frImportInvestorsAction>>;
type ImportRow = ImportResult["rows"][number];

/** The template columns users download — the engine matches these (and common aliases). */
const TEMPLATE_HEADERS = ["Firm", "Partner", "Email", "Stage", "Check Size", "Lead", "Last Contact", "Follow Up", "Notes"];

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

function dateShort(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

/* ------------------------------ sheet import ----------------------------- */

/** RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, and CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Parse a user-chosen CSV or XLSX file into rows of string cells (header row first). */
type XlsxCell = string | number | boolean | Date | null;

async function cellsFromFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const readXlsxFile = (await import("read-excel-file/browser")).default;
    const result = (await readXlsxFile(file)) as unknown;
    // The default export returns the row grid (Row[]); normalise the {data} shape too.
    const grid = (Array.isArray(result) && Array.isArray(result[0])
      ? result
      : (result as { data?: XlsxCell[][] })?.data ?? []) as XlsxCell[][];
    return grid.map((r) => r.map((c) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c))));
  }
  return parseCsv(await file.text());
}

function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadTemplate(): void {
  const examples = [
    ["Acme Ventures", "Jane Partner", "jane@acme.vc", "Contacted", "500000", "yes", "2026-11-01", "yes", "Warm intro via a portfolio founder; climate thesis fit"],
    ["Blue Harbor Capital", "Sam Lead", "sam@blueharbor.com", "Meeting", "1000000", "no", "2026-10-20", "no", "Met at the summit — wants to see traction"],
  ];
  const csv = [TEMPLATE_HEADERS, ...examples].map((r) => r.map(csvCell).join(",")).join("\r\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "vc-import-template.csv");
}

const dispTint: Record<ImportRow["disposition"], string> = {
  new: "text-emerald-600 dark:text-emerald-400",
  update: "text-sky-600 dark:text-sky-400",
  skip: "text-muted-foreground",
};

function ImportDialog({
  open,
  rounds,
  currentRoundId,
  onClose,
  onImported,
}: {
  open: boolean;
  rounds: FundraiseRound[];
  currentRoundId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [targetRound, setTargetRound] = useState(currentRoundId);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Keep the raw parsed cells so commit can re-send them (the file itself isn't persisted).
  const previewCells = useRef<string[][]>([]);

  useEffect(() => {
    if (!open) return;
    setTargetRound(currentRoundId);
    setFileName(null);
    setPreview(null);
    setDone(null);
    setError(null);
    setParsing(false);
    setCommitting(false);
  }, [open, currentRoundId]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setError(null);
    setDone(null);
    setFileName(file.name);
    setParsing(true);
    try {
      const cells = await cellsFromFile(file);
      previewCells.current = cells;
      const result = await frImportInvestorsAction(targetRound, cells, { dryRun: true });
      if (!result.ok) setError(result.error ?? "Couldn't read that file.");
      else setPreview(result);
    } catch {
      setError("Couldn't read that file. Make sure it's a .csv or .xlsx with a header row.");
    } finally {
      setParsing(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setCommitting(true);
    setError(null);
    try {
      const result = await frImportInvestorsAction(targetRound, previewCells.current, { dryRun: false });
      if (!result.ok) setError(result.error ?? "Import failed.");
      else {
        setDone(result);
        onImported();
      }
    } finally {
      setCommitting(false);
    }
  }

  const roundName = rounds.find((r) => r.id === targetRound)?.name ?? "this round";

  return (
    <Dialog open={open} onClose={onClose} title="Import VC list" className="max-w-2xl">
      {done ? (
        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <Check className="h-5 w-5" />
            <span className="text-sm font-semibold">Imported into {roundName}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Added" value={done.created} tint="text-emerald-600 dark:text-emerald-400" />
            <Stat label="Updated" value={done.updated} tint="text-sky-600 dark:text-sky-400" />
            <Stat label="Skipped" value={done.skipped} tint="text-muted-foreground" />
          </div>
          <p className="text-[12px] text-muted-foreground">
            Each firm is now in your pipeline and mirrored into your CRM as an investor relationship. Partners with an email became CRM contacts.
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : preview ? (
        <div className="flex flex-col gap-3 py-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
            <span className="font-medium">
              {preview.total} row{preview.total === 1 ? "" : "s"} · into {roundName}
            </span>
            <span className="text-emerald-600 dark:text-emerald-400">{preview.created} new</span>
            <span className="text-sky-600 dark:text-sky-400">{preview.updated} update{preview.updated === 1 ? "" : "s"}</span>
            {preview.skipped > 0 && <span className="text-muted-foreground">{preview.skipped} skipped</span>}
          </div>
          {preview.unmapped.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Columns ignored (no match): {preview.unmapped.join(", ")}. Rename them to match the template if you need them.</span>
            </p>
          )}
          <div className="max-h-72 overflow-auto rounded-lg border border-border">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Firm</th>
                  <th className="px-2 py-1.5 font-medium">Partner</th>
                  <th className="px-2 py-1.5 font-medium">Stage</th>
                  <th className="px-2 py-1.5 text-right font-medium">Check</th>
                  <th className="px-2 py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="max-w-[12rem] truncate px-2 py-1.5 font-medium">{r.firm || <span className="text-muted-foreground">—</span>}</td>
                    <td className="max-w-[10rem] truncate px-2 py-1.5 text-muted-foreground">{r.partner ?? "—"}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{STAGES.find((s) => s.key === r.stage)?.label ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{r.check_amount != null ? money(r.check_amount) : "—"}</td>
                    <td className={cn("px-2 py-1.5 text-right text-[11px] font-medium capitalize", dispTint[r.disposition])}>
                      {r.disposition === "skip" ? r.reason ?? "skip" : r.disposition}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length > 100 && <p className="px-2 py-1.5 text-[11px] text-muted-foreground">+{preview.rows.length - 100} more…</p>}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button size="sm" onClick={commit} disabled={committing || preview.created + preview.updated === 0}>
              {committing && <Loader2 className="h-4 w-4 animate-spin" />}
              Import {preview.created + preview.updated} investor{preview.created + preview.updated === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 py-1">
          {rounds.length > 1 && (
            <div>
              <Label>Import into round</Label>
              <select value={targetRound} onChange={(e) => setTargetRound(e.target.value)} className={selectCls}>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.status === "closed" ? " (closed)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-8 text-center transition hover:border-primary/50 hover:bg-muted/40",
              parsing && "pointer-events-none opacity-60",
            )}
          >
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={onFile} className="hidden" />
            {parsing ? <Loader2 className="h-7 w-7 animate-spin text-primary" /> : <Upload className="h-7 w-7 text-muted-foreground" />}
            <span className="text-sm font-medium">{parsing ? "Reading…" : fileName ?? "Choose a .csv or .xlsx file"}</span>
            <span className="text-[11.5px] text-muted-foreground">Drag in your VC list, or click to browse</span>
          </label>
          <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
            <div className="text-[11.5px] text-muted-foreground">
              <span className="font-medium text-foreground">Columns:</span> {TEMPLATE_HEADERS.join(" · ")}
            </div>
            <button type="button" onClick={downloadTemplate} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-primary hover:underline">
              <Download className="h-3.5 w-3.5" /> Template
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Headers are matched loosely (case-insensitive, common aliases). Re-importing an updated sheet updates existing investors instead of duplicating them.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

function Stat({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div className="rounded-lg border border-border bg-card py-2">
      <div className={cn("text-lg font-semibold tabular-nums", tint)}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

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
  onWarmIntros,
}: {
  investor: FundraiseInvestor | null;
  onClose: () => void;
  onChanged: () => void;
  onWarmIntros: () => void;
}) {
  const [name, setName] = useState("");
  const [check, setCheck] = useState("");
  const [stage, setStage] = useState<FundraiseStage>("researching");
  const [isLead, setIsLead] = useState(false);
  const [lastContact, setLastContact] = useState("");
  const [followup, setFollowup] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!investor) return;
    setName(investor.name);
    setCheck(investor.check_amount != null ? String(investor.check_amount) : "");
    setStage(investor.stage);
    setIsLead(investor.is_lead);
    setLastContact(investor.last_contact_date ? investor.last_contact_date.slice(0, 10) : "");
    setFollowup(investor.needs_followup);
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
      last_contact_date: lastContact ? new Date(lastContact).toISOString() : null,
      needs_followup: followup,
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
        <div>
          <Label>Last contact</Label>
          <Input type="date" value={lastContact} onChange={(e) => setLastContact(e.target.value)} className="w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <input type="checkbox" checked={isLead} onChange={(e) => setIsLead(e.target.checked)} className="h-3.5 w-3.5 rounded border-border accent-primary" />
            <span>Potential lead</span>
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <input type="checkbox" checked={followup} onChange={(e) => setFollowup(e.target.checked)} className="h-3.5 w-3.5 rounded border-border accent-primary" />
            <span>Needs follow-up</span>
          </label>
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Partner, thesis fit, next step…" />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <button type="button" onClick={remove} className="text-muted-foreground transition hover:text-destructive" title="Remove investor">
            <Trash2 className="h-4 w-4" />
          </button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onWarmIntros}>
              <Handshake className="h-4 w-4" /> Warm intros
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
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

/* ------------------------------ warm intros ------------------------------ */

const INTRO_STATUS: Record<FundraiseIntroStatus, { label: string; tint: string }> = {
  suggested: { label: "Suggested", tint: "text-slate-500" },
  approved: { label: "Approved", tint: "text-sky-600 dark:text-sky-400" },
  email_found: { label: "Email found", tint: "text-violet-600 dark:text-violet-400" },
  requested: { label: "Intro requested", tint: "text-amber-600 dark:text-amber-400" },
  intro_made: { label: "Intro made", tint: "text-emerald-600 dark:text-emerald-400" },
  declined: { label: "Declined", tint: "text-muted-foreground" },
};

function AddPathForm({ investorId, onAdded }: { investorId: string; onAdded: () => void }) {
  const [company, setCompany] = useState("");
  const [domain, setDomain] = useState("");
  const [founder, setFounder] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!company.trim()) {
      setError("Add the portfolio company name.");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await frAddIntroPathAction(investorId, {
      portfolio_company: company,
      portfolio_domain: domain || null,
      founder_name: founder,
      founder_title: title,
      founder_email: email || null,
    });
    setSaving(false);
    if (r.ok) onAdded();
    else setError(r.error ?? "Couldn't add.");
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Portfolio company *" />
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Website (for email lookup)" />
        <Input value={founder} onChange={(e) => setFounder(e.target.value)} placeholder="Founder name" />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Founder title" />
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Founder email (optional)" className="sm:col-span-2" />
      </div>
      {error && <p className="text-[12px] text-red-600">{error}</p>}
      <div className="flex justify-end">
        <Button size="sm" onClick={add} disabled={saving || !company.trim()}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Add path
        </Button>
      </div>
    </div>
  );
}

function WarmIntrosDialog({ investor, onClose }: { investor: FundraiseInvestor | null; onClose: () => void }) {
  const [paths, setPaths] = useState<FundraiseIntroPath[] | null>(null);
  const [researching, setResearching] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const investorId = investor?.id ?? null;
  const load = useCallback(async () => {
    if (!investorId) return;
    setPaths(await frListIntroPathsAction(investorId));
  }, [investorId]);

  useEffect(() => {
    if (!investorId) return;
    setPaths(null);
    setMsg(null);
    setAddOpen(false);
    load();
  }, [investorId, load]);

  if (!investor) return null;

  async function research() {
    setResearching(true);
    setMsg(null);
    const r = await frResearchIntroPathsAction(investor!.id);
    setResearching(false);
    if (!r.ok) setMsg(r.error ?? "Research failed.");
    else if (!r.configured) setMsg("AI isn't configured (ANTHROPIC_API_KEY missing).");
    else {
      setMsg(r.added ? `Found ${r.added} intro path${r.added === 1 ? "" : "s"}.` : "No new portfolio matches found — try adding one manually.");
      await load();
    }
  }
  async function findEmail(id: string, hasName: boolean) {
    if (!hasName) {
      setMsg("Add the founder's name first.");
      return;
    }
    setBusyId(id);
    setMsg(null);
    const r = await frScoutFounderEmailAction(id);
    setBusyId(null);
    if (!r.ok) setMsg(r.error);
    else if (!r.email) setMsg("No confident email found — add it manually, or check the company website.");
    else {
      setMsg(`Found an email (confidence ${r.score ?? "—"}).`);
      await load();
    }
  }
  async function requestIntro(id: string) {
    setBusyId(id);
    setMsg(null);
    const r = await frRequestIntroAction(id);
    setBusyId(null);
    if (!r.ok) setMsg(r.error);
    else {
      setMsg("Intro request drafted → review & send it in the Email Manager.");
      await load();
    }
  }
  async function setStatus(id: string, status: FundraiseIntroStatus) {
    await frUpdateIntroPathAction(id, { status });
    await load();
  }
  async function remove(id: string) {
    await frDeleteIntroPathAction(id);
    await load();
  }

  return (
    <Dialog open={!!investor} onClose={onClose} title={`Warm intros → ${investor.name}`} className="max-w-2xl">
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-muted-foreground">
          Find the founders in {investor.name}&rsquo;s portfolio closest to you, scout their email, and draft a warm founder-to-founder note asking for a quick call — a portfolio
          intro beats a cold pitch. Nothing sends; drafts land in your Email Manager.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={research} disabled={researching}>
            {researching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Find intro paths
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAddOpen((v) => !v)}>
            <Plus className="h-4 w-4" /> Add manually
          </Button>
        </div>
        {addOpen && (
          <AddPathForm
            investorId={investor.id}
            onAdded={() => {
              setAddOpen(false);
              load();
            }}
          />
        )}
        {msg && <p className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-[12px] text-muted-foreground">{msg}</p>}
        {paths === null ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : paths.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center text-[12.5px] text-muted-foreground">
            No intro paths yet. Click <span className="font-medium text-foreground">Find intro paths</span> to research {investor.name}&rsquo;s portfolio.
          </div>
        ) : (
          <div className="flex max-h-[26rem] flex-col gap-2 overflow-auto">
            {paths.map((p) => {
              const requested = p.status === "requested" || p.status === "intro_made";
              return (
                <div key={p.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{p.portfolio_company}</span>
                        {p.relevance_score != null && (
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{p.relevance_score}% match</span>
                        )}
                      </div>
                      {(p.founder_name || p.founder_title) && (
                        <div className="text-[12px] text-muted-foreground">
                          {p.founder_name}
                          {p.founder_title ? ` · ${p.founder_title}` : ""}
                        </div>
                      )}
                      {p.relevance && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{p.relevance}</p>}
                      {p.founder_email && <div className="mt-0.5 truncate text-[11.5px] text-foreground/80">{p.founder_email}</div>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={cn("text-[11px] font-medium", INTRO_STATUS[p.status].tint)}>{INTRO_STATUS[p.status].label}</span>
                      <button type="button" onClick={() => remove(p.id)} className="text-muted-foreground transition hover:text-destructive" title="Remove">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!p.founder_email ? (
                      <Button size="sm" variant="outline" onClick={() => findEmail(p.id, Boolean(p.founder_name))} disabled={busyId === p.id}>
                        {busyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AtSign className="h-3.5 w-3.5" />} Find email
                      </Button>
                    ) : !requested ? (
                      <Button size="sm" onClick={() => requestIntro(p.id)} disabled={busyId === p.id}>
                        {busyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Request intro
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5" /> Drafted → Email Manager
                      </span>
                    )}
                    <select
                      value={p.status}
                      onChange={(e) => setStatus(p.id, e.target.value as FundraiseIntroStatus)}
                      className="ml-auto rounded-md border border-border bg-card px-1.5 py-1 text-[11px]"
                    >
                      {(Object.keys(INTRO_STATUS) as FundraiseIntroStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {INTRO_STATUS[s].label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
  const [importOpen, setImportOpen] = useState(false);
  const [roundDialog, setRoundDialog] = useState<{ open: boolean; round: FundraiseRound | null }>({ open: false, round: null });
  const [openInvestor, setOpenInvestor] = useState<FundraiseInvestor | null>(null);
  const [warmIntrosFor, setWarmIntrosFor] = useState<FundraiseInvestor | null>(null);

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
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import VC list
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
                              {(v.contact_name || v.last_contact_date || v.needs_followup) && (
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground">
                                  {v.contact_name && <span className="truncate">{v.contact_name}</span>}
                                  {dateShort(v.last_contact_date) && (
                                    <span className="inline-flex items-center gap-0.5">
                                      <Clock className="h-2.5 w-2.5" />
                                      {dateShort(v.last_contact_date)}
                                    </span>
                                  )}
                                  {v.needs_followup && (
                                    <span className="inline-flex items-center gap-0.5 font-medium text-amber-600 dark:text-amber-400">
                                      <Flag className="h-2.5 w-2.5" /> Follow up
                                    </span>
                                  )}
                                </div>
                              )}
                            </button>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setWarmIntrosFor(v)}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-1 text-[10.5px] text-muted-foreground transition hover:text-foreground"
                                title="Warm intros via portfolio founders"
                              >
                                <Handshake className="h-3 w-3" /> Intros
                              </button>
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
      <ImportDialog
        open={importOpen}
        rounds={rounds ?? []}
        currentRoundId={roundId}
        onClose={() => setImportOpen(false)}
        onImported={() => {
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
        onWarmIntros={() => {
          const inv = openInvestor;
          setOpenInvestor(null);
          setWarmIntrosFor(inv);
        }}
      />
      <WarmIntrosDialog investor={warmIntrosFor} onClose={() => setWarmIntrosFor(null)} />
    </>
  );
}
