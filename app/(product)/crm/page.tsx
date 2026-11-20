"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Clock,
  ExternalLink,
  Flame,
  Loader2,
  Mail,
  Plus,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  Users,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  crmCreateCompanyAction,
  crmCreateContactAction,
  crmCreateDealAction,
  crmDeleteCompanyAction,
  crmDeleteContactAction,
  crmDeleteDealAction,
  crmDraftFollowupAction,
  crmEnrichCompanyAction,
  crmFindContactEmailAction,
  crmForecastAction,
  crmImportHubSpotAction,
  crmListActivitiesAction,
  crmListCompaniesAction,
  crmListContactsAction,
  crmListDealsAction,
  crmLogNoteAction,
  crmStaleDealsAction,
  crmUpdateCompanyAction,
  crmUpdateContactAction,
  crmUpdateDealAction,
} from "@/app/actions";
import type { CrmActivity, CrmCompany, CrmContact, CrmDeal, CrmDealStage, CrmForecast, CrmRelationshipType } from "@/lib/types";

/* --------------------------------- meta ---------------------------------- */

const STAGES: { key: CrmDealStage; label: string; tint: string }[] = [
  { key: "new", label: "New", tint: "text-slate-500" },
  { key: "qualified", label: "Qualified", tint: "text-sky-600 dark:text-sky-400" },
  { key: "proposal", label: "Proposal", tint: "text-violet-600 dark:text-violet-400" },
  { key: "negotiation", label: "Negotiation", tint: "text-amber-600 dark:text-amber-400" },
  { key: "won", label: "Won", tint: "text-emerald-600 dark:text-emerald-400" },
  { key: "lost", label: "Lost", tint: "text-muted-foreground" },
];
const REL_TYPES: { key: CrmRelationshipType; label: string; cls: string }[] = [
  { key: "customer", label: "Customer", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  { key: "prospect", label: "Prospect", cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  { key: "partner", label: "Partner", cls: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400" },
  { key: "investor", label: "Investor", cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  { key: "vendor", label: "Vendor", cls: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  { key: "other", label: "Other", cls: "border-border bg-muted/50 text-muted-foreground" },
];
const REL_META = Object.fromEntries(REL_TYPES.map((r) => [r.key, r])) as Record<CrmRelationshipType, (typeof REL_TYPES)[number]>;

function money(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Heuristic priority for a cold deal — blends value with how long it's been quiet. */
function dealPriority(d: CrmDeal): number {
  const v = Math.min(1, (d.amount ?? 0) / 50000);
  const days = Math.floor((Date.now() - new Date(d.last_activity_at ?? d.created_at).getTime()) / 86400000);
  const s = Math.min(1, days / 30);
  return v * 0.6 + s * 0.4;
}
function priorityTag(d: CrmDeal): { label: string; cls: string } {
  const p = dealPriority(d);
  if (p >= 0.55) return { label: "High", cls: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400" };
  if (p >= 0.3) return { label: "Med", cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" };
  return { label: "Low", cls: "border-border bg-muted/50 text-muted-foreground" };
}

function RelBadge({ type }: { type: CrmRelationshipType }) {
  const m = REL_META[type];
  return <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", m.cls)}>{m.label}</span>;
}

/* ------------------------------- timeline -------------------------------- */

function Timeline({ scope }: { scope: { contact_id?: string; deal_id?: string; company_id?: string } }) {
  const [items, setItems] = useState<CrmActivity[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(scope);
  const load = useCallback(async () => setItems(await crmListActivitiesAction(scope)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!note.trim()) return;
    setBusy(true);
    await crmLogNoteAction(scope, note);
    setNote("");
    setBusy(false);
    load();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <Textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Log a note — a call, a reply, context to remember…"
          className="flex-1"
        />
        <Button size="sm" onClick={add} disabled={busy || !note.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <StickyNote className="h-4 w-4" />}
          Log
        </Button>
      </div>
      {items === null ? (
        <div className="flex justify-center py-6 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-muted-foreground">No activity yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((a) => (
            <div key={a.id} className="flex items-start gap-2 border-b border-border/50 pb-2 last:border-0">
              <span className="mt-0.5 shrink-0 text-muted-foreground">
                {a.type === "email" ? (
                  <Mail className="h-3.5 w-3.5" />
                ) : a.type === "stage_change" ? (
                  <Clock className="h-3.5 w-3.5" />
                ) : (
                  <StickyNote className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium">{a.summary}</div>
                {a.body && a.body !== a.summary && (
                  <p className="whitespace-pre-wrap break-words text-[12px] text-muted-foreground">{a.body}</p>
                )}
                <div className="text-[11px] text-muted-foreground">
                  {ago(a.occurred_at)}
                  {a.source !== "manual" && <span className="ml-1 opacity-70">· {a.source.replace("_", " ")}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- pickers / fields -------------------------- */

const selectCls = "mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm";

function CompanySelect({
  companies,
  value,
  onChange,
  allowEmpty,
}: {
  companies: CrmCompany[];
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
      {allowEmpty && <option value="">No company</option>}
      {!allowEmpty && value === "" && <option value="">Select a company…</option>}
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------ deal dialog ------------------------------ */

function DealDialog({
  deal,
  companies,
  contacts,
  onClose,
  onChanged,
}: {
  deal: CrmDeal | null;
  companies: CrmCompany[];
  contacts: CrmContact[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [contactId, setContactId] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<CrmDealStage>("new");
  const [closeDate, setCloseDate] = useState("");
  const [probability, setProbability] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!deal) return;
    setTitle(deal.title);
    setCompanyId(deal.company_id);
    setContactId(deal.primary_contact_id ?? "");
    setAmount(deal.amount != null ? String(deal.amount) : "");
    setStage(deal.stage);
    setCloseDate(deal.close_date ? deal.close_date.slice(0, 10) : "");
    setProbability(deal.probability != null ? String(deal.probability) : "");
    setNote(deal.note);
    setMsg(null);
  }, [deal]);

  const companyContacts = useMemo(() => contacts.filter((c) => c.company_id === companyId), [contacts, companyId]);
  if (!deal) return null;

  async function save() {
    setBusy("save");
    await crmUpdateDealAction(deal!.id, {
      title,
      company_id: companyId || undefined,
      primary_contact_id: contactId || null,
      amount: amount.trim() ? Number(amount) : null,
      stage,
      close_date: closeDate ? new Date(closeDate).toISOString() : null,
      probability: probability.trim() ? Number(probability) : null,
      note,
    });
    setBusy(null);
    onChanged();
  }
  async function followUp() {
    setBusy("followup");
    setMsg(null);
    const r = await crmDraftFollowupAction(deal!.id);
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: "Follow-up drafted in the Email Manager." } : { ok: false, text: r.error ?? "Couldn't draft the follow-up." });
  }
  async function remove() {
    if (!window.confirm(`Delete deal "${deal!.title}"?`)) return;
    await crmDeleteDealAction(deal!.id);
    onChanged();
    onClose();
  }

  return (
    <Dialog open={!!deal} onClose={onClose} title={deal.title || "Deal"} className="max-w-xl">
      <div className="flex max-h-[80vh] flex-col gap-3 overflow-y-auto pr-1">
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Company</Label>
            <CompanySelect companies={companies} value={companyId} onChange={setCompanyId} />
          </div>
          <div>
            <Label>Primary contact</Label>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={selectCls}>
              <option value="">None</option>
              {companyContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Value ($)</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="42000" className="w-full" />
          </div>
          <div>
            <Label>Stage</Label>
            <select value={stage} onChange={(e) => setStage(e.target.value as CrmDealStage)} className={selectCls}>
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Probability (%)</Label>
            <Input type="number" value={probability} onChange={(e) => setProbability(e.target.value)} placeholder="60" className="w-full" />
          </div>
        </div>
        <div>
          <Label>Expected close</Label>
          <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} className="w-full" />
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Timeline</span>
          <div className="mt-2">
            <Timeline scope={{ deal_id: deal.id }} />
          </div>
        </div>

        {msg && (
          <p className={cn("text-[12.5px]", msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600")}>
            {msg.text}
            {msg.ok && (
              <a href="/email" className="ml-1 font-medium underline">
                Open Email Manager
              </a>
            )}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <button type="button" onClick={remove} className="text-muted-foreground transition hover:text-destructive" title="Delete deal">
            <Trash2 className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={followUp} disabled={busy !== null} title="Draft a follow-up email into the Email Manager">
              {busy === "followup" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Draft follow-up
            </Button>
            <Button size="sm" onClick={save} disabled={busy !== null}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------------------- contact dialog ----------------------------- */

function CrmContactDialog({
  contact,
  companies,
  onClose,
  onChanged,
}: {
  contact: CrmContact | null;
  companies: CrmCompany[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!contact) return;
    setName(contact.name);
    setTitle(contact.title);
    setCompanyId(contact.company_id ?? "");
    setEmail(contact.email ?? "");
    setPhone(contact.phone);
    setLinkedin(contact.linkedin_url ?? "");
    setNote(contact.note);
    setMsg(null);
  }, [contact]);

  if (!contact) return null;

  async function save() {
    setBusy("save");
    await crmUpdateContactAction(contact!.id, {
      name,
      title,
      company_id: companyId || null,
      email,
      phone,
      linkedin_url: linkedin,
      note,
    });
    setBusy(null);
    onChanged();
  }
  async function findEmail() {
    setBusy("find");
    setMsg(null);
    await crmUpdateContactAction(contact!.id, { name, company_id: companyId || null });
    const r = await crmFindContactEmailAction(contact!.id);
    setBusy(null);
    if (!r.ok) {
      setMsg({ ok: false, text: r.error ?? "Couldn't search for an email." });
      return;
    }
    if (r.email) {
      setEmail(r.email);
      setMsg({ ok: true, text: `Found ${r.email}${r.score != null ? ` (${r.score}% confidence)` : ""}.` });
      onChanged();
    } else {
      setMsg({ ok: false, text: `No confident email found${r.score != null ? ` (best ${r.score}%)` : ""}.` });
    }
  }
  async function remove() {
    if (!window.confirm(`Remove ${contact!.name}?`)) return;
    await crmDeleteContactAction(contact!.id);
    onChanged();
    onClose();
  }

  return (
    <Dialog open={!!contact} onClose={onClose} title={contact.name || "Contact"} className="max-w-xl">
      <div className="flex max-h-[80vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
          </div>
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full" />
          </div>
        </div>
        <div>
          <Label>Company</Label>
          <CompanySelect companies={companies} value={companyId} onChange={setCompanyId} allowEmpty />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="w-full" />
            {!email.trim() && name.trim() && companyId && (
              <button
                type="button"
                onClick={findEmail}
                disabled={busy !== null}
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary transition hover:underline disabled:opacity-50"
              >
                {busy === "find" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                Find email
              </button>
            )}
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full" />
          </div>
        </div>
        <div>
          <Label>LinkedIn / URL</Label>
          <Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…" className="w-full" />
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {contact.email_meta && (
          <p className="text-[11.5px] text-muted-foreground">
            Email found via {contact.email_meta.found_via === "domain-search" ? "company search" : "Hunter"}
            {contact.email_meta.score != null ? ` · ${contact.email_meta.score}% confidence` : ""}
          </p>
        )}

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Timeline</span>
          <div className="mt-2">
            <Timeline scope={{ contact_id: contact.id }} />
          </div>
        </div>

        {msg && (
          <p className={cn("text-[12.5px]", msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600")}>{msg.text}</p>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <button type="button" onClick={remove} className="text-muted-foreground transition hover:text-destructive" title="Remove contact">
            <Trash2 className="h-4 w-4" />
          </button>
          <Button size="sm" onClick={save} disabled={busy !== null}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------------------- company dialog ----------------------------- */

function CompanyDialog({
  company,
  contacts,
  deals,
  onClose,
  onChanged,
  onOpenContact,
  onOpenDeal,
}: {
  company: CrmCompany | null;
  contacts: CrmContact[];
  deals: CrmDeal[];
  onClose: () => void;
  onChanged: () => void;
  onOpenContact: (c: CrmContact) => void;
  onOpenDeal: (d: CrmDeal) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CrmRelationshipType>("prospect");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!company) return;
    setName(company.name);
    setType(company.relationship_type);
    setWebsite(company.website ?? "");
    setIndustry(company.industry);
    setNote(company.note);
    setMsg(null);
  }, [company]);

  const companyContacts = useMemo(() => contacts.filter((c) => c.company_id === company?.id), [contacts, company]);
  const companyDeals = useMemo(() => deals.filter((d) => d.company_id === company?.id), [deals, company]);
  if (!company) return null;

  async function save() {
    setBusy("save");
    await crmUpdateCompanyAction(company!.id, { name, relationship_type: type, website, industry, note });
    setBusy(null);
    onChanged();
  }
  async function enrich() {
    setBusy("enrich");
    setMsg(null);
    const r = await crmEnrichCompanyAction(company!.id);
    setBusy(null);
    if (r.ok) {
      setMsg({ ok: true, text: "Enriched from the web — refreshed the empty fields." });
      onChanged();
    } else setMsg({ ok: false, text: ("error" in r && r.error) || "Couldn't enrich." });
  }
  async function remove() {
    if (!window.confirm(`Delete ${company!.name} and its contacts + deals?`)) return;
    await crmDeleteCompanyAction(company!.id);
    onChanged();
    onClose();
  }

  return (
    <Dialog open={!!company} onClose={onClose} title={company.name || "Company"} className="max-w-xl">
      <div className="flex max-h-[80vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
          </div>
          <div>
            <Label>Relationship</Label>
            <select value={type} onChange={(e) => setType(e.target.value as CrmRelationshipType)} className={selectCls}>
              {REL_TYPES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Website</Label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="company.com" className="w-full" />
          </div>
          <div>
            <Label>Industry</Label>
            <Input value={industry} onChange={(e) => setIndustry(e.target.value)} className="w-full" />
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Contacts ({companyContacts.length})
            </span>
            <div className="mt-2 flex flex-col gap-1">
              {companyContacts.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">None yet.</p>
              ) : (
                companyContacts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onOpenContact(c)}
                    className="truncate text-left text-[12.5px] hover:underline"
                  >
                    {c.name}
                    {c.title ? <span className="text-muted-foreground"> · {c.title}</span> : null}
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Deals ({companyDeals.length})
            </span>
            <div className="mt-2 flex flex-col gap-1">
              {companyDeals.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">None yet.</p>
              ) : (
                companyDeals.map((d) => (
                  <button key={d.id} onClick={() => onOpenDeal(d)} className="flex justify-between gap-2 text-left text-[12.5px] hover:underline">
                    <span className="truncate">{d.title}</span>
                    <span className="shrink-0 text-muted-foreground">{money(d.amount)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Timeline</span>
          <div className="mt-2">
            <Timeline scope={{ company_id: company.id }} />
          </div>
        </div>

        {msg && (
          <p className={cn("text-[12.5px]", msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600")}>{msg.text}</p>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <button type="button" onClick={remove} className="text-muted-foreground transition hover:text-destructive" title="Delete company">
            <Trash2 className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={enrich} disabled={busy !== null} title="Fill empty fields from the web">
              {busy === "enrich" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Enrich
            </Button>
            <Button size="sm" onClick={save} disabled={busy !== null}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------ add dialogs ------------------------------ */

function AddDialog({
  open,
  kind,
  companies,
  onClose,
  onDone,
}: {
  open: boolean;
  kind: "company" | "contact" | "deal";
  companies: CrmCompany[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [type, setType] = useState<CrmRelationshipType>("prospect");
  const [companyId, setCompanyId] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setA("");
    setB("");
    setType("prospect");
    setCompanyId(companies[0]?.id ?? "");
    setAmount("");
    setError(null);
  }, [open, kind, companies]);

  async function submit() {
    setSaving(true);
    setError(null);
    let r: { ok: boolean; error?: string };
    if (kind === "company") r = await crmCreateCompanyAction({ name: a, relationship_type: type, website: b });
    else if (kind === "contact") r = await crmCreateContactAction({ name: a, email: b, company_id: companyId || null });
    else r = await crmCreateDealAction({ company_id: companyId, title: a, amount: amount.trim() ? Number(amount) : null });
    setSaving(false);
    if (r.ok) {
      onDone();
      onClose();
    } else setError(r.error ?? "Couldn't save.");
  }

  const titles = { company: "New company", contact: "New contact", deal: "New deal" };
  const canSave = kind === "deal" ? Boolean(a.trim() && companyId) : Boolean(a.trim());

  return (
    <Dialog open={open} onClose={onClose} title={titles[kind]} className="max-w-md">
      <div className="flex flex-col gap-3">
        <div>
          <Label>{kind === "deal" ? "Deal title" : "Name"}</Label>
          <Input value={a} onChange={(e) => setA(e.target.value)} placeholder={kind === "deal" ? "Pilot agreement" : "Acme Corp"} />
        </div>
        {kind === "company" && (
          <>
            <div>
              <Label>Relationship</Label>
              <select value={type} onChange={(e) => setType(e.target.value as CrmRelationshipType)} className={selectCls}>
                {REL_TYPES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Website</Label>
              <Input value={b} onChange={(e) => setB(e.target.value)} placeholder="company.com" />
            </div>
          </>
        )}
        {kind === "contact" && (
          <>
            <div>
              <Label>Email</Label>
              <Input value={b} onChange={(e) => setB(e.target.value)} placeholder="name@company.com" />
            </div>
            <div>
              <Label>Company</Label>
              <CompanySelect companies={companies} value={companyId} onChange={setCompanyId} allowEmpty />
            </div>
          </>
        )}
        {kind === "deal" && (
          <>
            <div>
              <Label>Company</Label>
              {companies.length ? (
                <CompanySelect companies={companies} value={companyId} onChange={setCompanyId} />
              ) : (
                <p className="mt-1 text-[12px] text-muted-foreground">Add a company first.</p>
              )}
            </div>
            <div>
              <Label>Value ($)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="42000" className="w-40" />
            </div>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !canSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Add
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------ pipeline tab ----------------------------- */

function PipelineTab({
  deals,
  companies,
  contacts,
  refresh,
}: {
  deals: CrmDeal[];
  companies: CrmCompany[];
  contacts: CrmContact[];
  refresh: () => void;
}) {
  const [filter, setFilter] = useState<CrmRelationshipType | "all">("all");
  const [openDeal, setOpenDeal] = useState<CrmDeal | null>(null);
  const [adding, setAdding] = useState(false);
  const [stale, setStale] = useState<CrmDeal[]>([]);

  useEffect(() => {
    crmStaleDealsAction().then(setStale);
  }, [deals]);

  const filtered = useMemo(
    () => (filter === "all" ? deals : deals.filter((d) => d.company_type === filter)),
    [deals, filter],
  );
  const byStage = useMemo(() => {
    const m: Record<CrmDealStage, CrmDeal[]> = { new: [], qualified: [], proposal: [], negotiation: [], won: [], lost: [] };
    for (const d of filtered) m[d.stage].push(d);
    return m;
  }, [filtered]);
  const openValue = filtered
    .filter((d) => d.stage !== "won" && d.stage !== "lost")
    .reduce((n, d) => n + (d.amount ?? 0), 0);

  async function move(id: string, stage: CrmDealStage) {
    await crmUpdateDealAction(id, { stage });
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[12px] font-medium transition",
            filter === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          All
        </button>
        {REL_TYPES.map((r) => (
          <button
            key={r.key}
            onClick={() => setFilter(r.key)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px] font-medium transition",
              filter === r.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-auto text-[12px] font-medium text-muted-foreground">Open pipeline: {money(openValue)}</span>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> New deal
        </Button>
      </div>

      {stale.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-amber-700 dark:text-amber-400">
            <Flame className="h-4 w-4" /> Going cold — {stale.length} deal{stale.length === 1 ? "" : "s"} untouched 14d+
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {[...stale]
              .sort((a, b) => dealPriority(b) - dealPriority(a))
              .slice(0, 6)
              .map((d) => {
                const pt = priorityTag(d);
                return (
                  <button
                    key={d.id}
                    onClick={() => setOpenDeal(d)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[12px] hover:bg-accent/50"
                  >
                    <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-semibold", pt.cls)}>{pt.label}</span>
                    {d.title} <span className="text-muted-foreground">· {d.company_name} · {money(d.amount)}</span>
                  </button>
                );
              })}
          </div>
        </Card>
      )}

      {deals.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <Building2 className="h-8 w-8 opacity-40" />
          <p className="text-sm">No deals yet.</p>
          <p className="text-xs">Add a company, then a deal — or promote a contact from Outreach.</p>
        </Card>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGES.map((st) => (
            <div key={st.key} className="flex w-64 shrink-0 flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className={cn("text-[12px] font-semibold", st.tint)}>{st.label}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{byStage[st.key].length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {byStage[st.key].map((d) => (
                  <Card key={d.id} className="p-2.5">
                    <button type="button" className="block w-full text-left" onClick={() => setOpenDeal(d)}>
                      <div className="truncate text-sm font-medium">{d.title}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{d.company_name || "—"}</div>
                      <div className="mt-1 flex items-center gap-2 text-[11px]">
                        <span className="font-medium tabular-nums">{money(d.amount)}</span>
                        <span className="text-muted-foreground">· {ago(d.last_activity_at)}</span>
                      </div>
                    </button>
                    <div className="mt-2 flex justify-end">
                      <select
                        value={d.stage}
                        onChange={(e) => move(d.id, e.target.value as CrmDealStage)}
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
          ))}
        </div>
      )}

      <DealDialog deal={openDeal} companies={companies} contacts={contacts} onClose={() => setOpenDeal(null)} onChanged={refresh} />
      <AddDialog open={adding} kind="deal" companies={companies} onClose={() => setAdding(false)} onDone={refresh} />
    </div>
  );
}

/* ------------------------------ companies tab ---------------------------- */

function CompaniesTab({
  companies,
  contacts,
  deals,
  refresh,
}: {
  companies: CrmCompany[];
  contacts: CrmContact[];
  deals: CrmDeal[];
  refresh: () => void;
}) {
  const [filter, setFilter] = useState<CrmRelationshipType | "all">("all");
  const [open, setOpen] = useState<CrmCompany | null>(null);
  const [openContact, setOpenContact] = useState<CrmContact | null>(null);
  const [openDeal, setOpenDeal] = useState<CrmDeal | null>(null);
  const [adding, setAdding] = useState(false);

  const filtered = filter === "all" ? companies : companies.filter((c) => c.relationship_type === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[12px] font-medium transition",
            filter === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          All
        </button>
        {REL_TYPES.map((r) => (
          <button
            key={r.key}
            onClick={() => setFilter(r.key)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px] font-medium transition",
              filter === r.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
        <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> New company
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <Building2 className="h-8 w-8 opacity-40" />
          <p className="text-sm">No companies yet.</p>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((c) => (
            <Card key={c.id} className="p-3">
              <button onClick={() => setOpen(c)} className="block w-full text-left">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium hover:underline">{c.name}</span>
                  <RelBadge type={c.relationship_type} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{c.contact_count ?? 0} contacts</span>
                  <span>· {c.open_deal_count ?? 0} open deals</span>
                  {(c.open_value ?? 0) > 0 && <span className="text-emerald-600 dark:text-emerald-400">· {money(c.open_value)}</span>}
                </div>
              </button>
            </Card>
          ))}
        </div>
      )}

      <CompanyDialog
        company={open}
        contacts={contacts}
        deals={deals}
        onClose={() => setOpen(null)}
        onChanged={refresh}
        onOpenContact={(c) => setOpenContact(c)}
        onOpenDeal={(d) => setOpenDeal(d)}
      />
      <CrmContactDialog contact={openContact} companies={companies} onClose={() => setOpenContact(null)} onChanged={refresh} />
      <DealDialog deal={openDeal} companies={companies} contacts={contacts} onClose={() => setOpenDeal(null)} onChanged={refresh} />
      <AddDialog open={adding} kind="company" companies={companies} onClose={() => setAdding(false)} onDone={refresh} />
    </div>
  );
}

/* ------------------------------ contacts tab ----------------------------- */

function ContactsTab({ contacts, companies, refresh }: { contacts: CrmContact[]; companies: CrmCompany[]; refresh: () => void }) {
  const [open, setOpen] = useState<CrmContact | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground">{contacts.length} contacts</span>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> New contact
        </Button>
      </div>

      {contacts.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <Users className="h-8 w-8 opacity-40" />
          <p className="text-sm">No contacts yet.</p>
          <p className="text-xs">Add one, promote from Outreach, or send an email — contacts auto-create from your sends.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">Company</th>
                <th className="w-28 px-3 py-2">Last touch</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-accent/50">
                  <td className="px-3 py-2.5">
                    <button onClick={() => setOpen(c)} className="block w-full text-left">
                      <div className="truncate font-medium hover:underline">{c.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {c.title ? `${c.title} · ` : ""}
                        {c.email ?? "no email"}
                      </div>
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-[12.5px] text-muted-foreground">{c.company_name || "—"}</td>
                  <td className="px-3 py-2.5 text-[12px] text-muted-foreground">{ago(c.last_touch_at)}</td>
                  <td className="px-2 py-2.5 text-right">
                    {c.linkedin_url && (
                      <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Profile">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <CrmContactDialog contact={open} companies={companies} onClose={() => setOpen(null)} onChanged={refresh} />
      <AddDialog open={adding} kind="contact" companies={companies} onClose={() => setAdding(false)} onDone={refresh} />
    </div>
  );
}

/* ------------------------------ forecast tab ----------------------------- */

function ForecastTile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "emerald" }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "emerald" && "text-emerald-600 dark:text-emerald-400")}>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </Card>
  );
}

function ForecastBar({ label, count, value, weighted, pct }: { label: string; count: number; value: number; weighted: number; pct: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="font-medium">
          {label} <span className="text-muted-foreground">· {count}</span>
        </span>
        <span className="tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{money(weighted)}</span> of {money(value)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, Math.round(pct * 100))}%` }} />
      </div>
    </div>
  );
}

function ForecastTab() {
  const [f, setF] = useState<CrmForecast | null | undefined>(undefined);
  useEffect(() => {
    crmForecastAction().then((d) => setF(d));
  }, []);

  if (f === undefined) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!f) return <Card className="py-12 text-center text-sm text-muted-foreground">Couldn&apos;t load the forecast.</Card>;

  const maxStage = Math.max(1, ...f.byStage.map((s) => s.weighted));
  const maxMonth = Math.max(1, ...f.byMonth.map((m) => m.weighted));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ForecastTile label="Open pipeline" value={money(f.openValue)} sub={`${f.openCount} open deal${f.openCount === 1 ? "" : "s"}`} />
        <ForecastTile label="Weighted forecast" value={money(f.weighted)} sub="probability-adjusted" tone="emerald" />
        <ForecastTile label="Win rate" value={f.winRate != null ? `${f.winRate}%` : "—"} sub="of closed deals" />
        <ForecastTile label="Won · last 90d" value={money(f.wonValue90d)} sub="recently closed" tone="emerald" />
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold">Pipeline by stage</h3>
        <p className="-mt-2 text-[11px] text-muted-foreground">Bold = probability-weighted; faint = full value.</p>
        {f.byStage.every((s) => s.count === 0) ? (
          <p className="py-4 text-center text-[12.5px] text-muted-foreground">No open deals yet.</p>
        ) : (
          f.byStage.map((s) => <ForecastBar key={s.key} label={s.label} count={s.count} value={s.value} weighted={s.weighted} pct={s.weighted / maxStage} />)
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold">Forecast by close month</h3>
        {f.byMonth.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-muted-foreground">No open deals with a close date — set expected close dates to forecast by month.</p>
        ) : (
          f.byMonth.map((m) => <ForecastBar key={m.month} label={m.label} count={m.count} value={m.value} weighted={m.weighted} pct={m.weighted / maxMonth} />)
        )}
      </Card>
    </div>
  );
}

/* --------------------------------- page ---------------------------------- */

type Tab = "pipeline" | "companies" | "contacts" | "forecast";

export default function CrmPage() {
  const [tab, setTab] = useState<Tab>("pipeline");
  const [companies, setCompanies] = useState<CrmCompany[] | null>(null);
  const [contacts, setContacts] = useState<CrmContact[] | null>(null);
  const [deals, setDeals] = useState<CrmDeal[] | null>(null);

  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [co, ct, dl] = await Promise.all([crmListCompaniesAction(), crmListContactsAction(), crmListDealsAction()]);
    setCompanies(co);
    setContacts(ct);
    setDeals(dl);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function importHubSpot() {
    if (!window.confirm("Import your HubSpot companies, contacts, and open deals into the CRM? Re-running is safe — it skips anything already here.")) return;
    setImporting(true);
    setImportMsg(null);
    const r = await crmImportHubSpotAction();
    setImporting(false);
    if (r.ok) {
      setImportMsg(
        `Imported ${r.companies ?? 0} compan${r.companies === 1 ? "y" : "ies"}, ${r.contacts ?? 0} contact${r.contacts === 1 ? "" : "s"}, and ${r.deals ?? 0} deal${r.deals === 1 ? "" : "s"} from HubSpot.`,
      );
      refresh();
    } else setImportMsg(r.error ?? "Import failed.");
  }

  const loading = companies === null || contacts === null || deals === null;
  const TABS: { key: Tab; label: string }[] = [
    { key: "pipeline", label: "Pipeline" },
    { key: "companies", label: "Companies" },
    { key: "contacts", label: "Contacts" },
    { key: "forecast", label: "Forecast" },
  ];

  return (
    <>
      <PageHeader
        title="CRM"
        description="Your relationships, owned here. Deals, companies, and people — the agent logs your emails and tells you who's going cold."
        actions={
          <Button size="sm" variant="outline" onClick={importHubSpot} disabled={importing}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
            Import from HubSpot
          </Button>
        }
      />
      <PageBody className="space-y-4">
        {importMsg && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12.5px] text-muted-foreground">{importMsg}</div>
        )}
        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition",
                tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : tab === "pipeline" ? (
          <PipelineTab deals={deals!} companies={companies!} contacts={contacts!} refresh={refresh} />
        ) : tab === "companies" ? (
          <CompaniesTab companies={companies!} contacts={contacts!} deals={deals!} refresh={refresh} />
        ) : tab === "contacts" ? (
          <ContactsTab contacts={contacts!} companies={companies!} refresh={refresh} />
        ) : (
          <ForecastTab />
        )}
      </PageBody>
    </>
  );
}
