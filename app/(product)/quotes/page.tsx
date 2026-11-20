"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ExternalLink,
  FileSearch,
  Globe,
  Loader2,
  Mail,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  addSupplierAction,
  createQuoteRequestAction,
  deleteQuoteRequestAction,
  deleteSupplierAction,
  draftAllRfqsAction,
  draftRfqAction,
  listQuoteRequestsAction,
  listSuppliersAction,
  sourceSuppliersAction,
  updateQuoteRequestAction,
  updateSupplierAction,
} from "@/app/actions";
import type { QuoteRequest, QuoteSupplier, SupplierStatus } from "@/lib/types";

const SUPPLIER_STATUS: { key: SupplierStatus; label: string; cls: string }[] = [
  { key: "found", label: "Found", cls: "border-border bg-muted/50 text-muted-foreground" },
  { key: "drafted", label: "RFQ drafted", cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  { key: "sent", label: "Sent", cls: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400" },
  { key: "replied", label: "Replied", cls: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400" },
  { key: "quoted", label: "Quoted", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  { key: "declined", label: "Declined", cls: "border-border bg-muted/50 text-muted-foreground" },
  { key: "no_response", label: "No response", cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
];
const STATUS_META = Object.fromEntries(SUPPLIER_STATUS.map((s) => [s.key, s])) as Record<
  SupplierStatus,
  { key: SupplierStatus; label: string; cls: string }
>;

/* ------------------------------ new request ------------------------------ */

function RequestDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState("");
  const [count, setCount] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setSpec("");
    setCount(3);
    setError(null);
  }, [open]);

  async function create() {
    if (!title.trim()) {
      setError("Describe what you need a quote for.");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await createQuoteRequestAction({ title, spec, target_count: count });
    setSaving(false);
    if (r.ok) onCreated(r.requestId);
    else setError(r.error ?? "Couldn't create the request.");
  }

  return (
    <Dialog open={open} onClose={onClose} title="New quote request" className="max-w-xl">
      <div className="flex flex-col gap-3">
        <div>
          <Label>What do you need a quote for?</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="100 kW electrolyzer for hydrogen production" />
        </div>
        <div>
          <Label>Specs / requirements</Label>
          <Textarea
            rows={4}
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            placeholder="Capacity, pressure, delivery location, quantity, timeline, certifications… — anything the supplier needs to quote."
          />
        </div>
        <div>
          <Label>Quotes wanted</Label>
          <Input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-24" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ----------------------------- supplier dialog --------------------------- */

function SupplierDialog({
  supplier,
  onClose,
  onChanged,
}: {
  supplier: QuoteSupplier | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SupplierStatus>("found");
  const [price, setPrice] = useState("");
  const [lead, setLead] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!supplier) return;
    setCompany(supplier.company);
    setWebsite(supplier.website ?? "");
    setEmail(supplier.contact_email ?? "");
    setStatus(supplier.status);
    setPrice(supplier.quote_price);
    setLead(supplier.quote_lead_time);
    setNotes(supplier.quote_notes);
    setMsg(null);
  }, [supplier]);

  if (!supplier) return null;

  async function save() {
    setBusy("save");
    await updateSupplierAction(supplier!.id, {
      company,
      website,
      contact_email: email,
      status,
      quote_price: price,
      quote_lead_time: lead,
      quote_notes: notes,
    });
    setBusy(null);
    onChanged();
  }
  async function draftRfq() {
    setBusy("rfq");
    setMsg(null);
    await updateSupplierAction(supplier!.id, { contact_email: email });
    const r = await draftRfqAction(supplier!.id);
    setBusy(null);
    if ("ok" in r && r.ok) {
      setMsg({ ok: true, text: "RFQ drafted in the Email Manager — review and send it there." });
      onChanged();
    } else setMsg({ ok: false, text: ("error" in r && r.error) || "Couldn't draft the RFQ." });
  }
  async function remove() {
    if (!window.confirm(`Remove ${supplier!.company}?`)) return;
    await deleteSupplierAction(supplier!.id);
    onChanged();
    onClose();
  }

  const inputCls = "w-full";
  return (
    <Dialog open={!!supplier} onClose={onClose} title={supplier.company || "Supplier"} className="max-w-xl">
      <div className="flex max-h-[76vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Company</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} className={inputCls} />
          </div>
          <div>
            <Label>Status</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SupplierStatus)}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
            >
              {SUPPLIER_STATUS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Contact email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sales@supplier.com" className={inputCls} />
          </div>
          <div>
            <Label>Website</Label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">The quote</span>
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Price</Label>
              <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="$42,000" className={inputCls} />
            </div>
            <div>
              <Label>Lead time</Label>
              <Input value={lead} onChange={(e) => setLead(e.target.value)} placeholder="12-16 weeks" className={inputCls} />
            </div>
          </div>
          <div className="mt-2">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Terms, MOQ, inclusions, caveats…" />
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
          <button type="button" onClick={remove} className="text-muted-foreground transition hover:text-destructive" title="Remove supplier">
            <Trash2 className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={save} disabled={busy !== null}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
            {supplier.outbound_draft_id ? (
              <a href="/email" className="inline-flex">
                <Button size="sm" variant="secondary">
                  <ExternalLink className="h-4 w-4" /> View RFQ draft
                </Button>
              </a>
            ) : (
              <Button size="sm" onClick={draftRfq} disabled={busy !== null || !email.trim()}>
                {busy === "rfq" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Draft RFQ
              </Button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------ add supplier ----------------------------- */

function AddSupplierDialog({
  open,
  requestId,
  onClose,
  onAdded,
}: {
  open: boolean;
  requestId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCompany("");
    setWebsite("");
    setEmail("");
  }, [open]);

  async function add() {
    if (!company.trim()) return;
    setSaving(true);
    await addSupplierAction(requestId, { company, website, contact_email: email });
    setSaving(false);
    onAdded();
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add supplier" className="max-w-md">
      <div className="flex flex-col gap-3">
        <div>
          <Label>Company</Label>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
        <div>
          <Label>Website</Label>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="supplier.com" />
        </div>
        <div>
          <Label>Contact email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sales@supplier.com (or leave blank to guess)" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add} disabled={saving || !company.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Add
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------ request detail --------------------------- */

function RequestDetail({ request, onBack, onChanged }: { request: QuoteRequest; onBack: () => void; onChanged: () => void }) {
  const [suppliers, setSuppliers] = useState<QuoteSupplier[] | null>(null);
  const [open, setOpen] = useState<QuoteSupplier | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [spec, setSpec] = useState(request.spec);

  const refresh = useCallback(async () => {
    const s = await listSuppliersAction(request.id);
    setSuppliers(s);
    setOpen((cur) => (cur ? s.find((x) => x.id === cur.id) ?? null : null));
  }, [request.id]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    setSpec(request.spec);
  }, [request]);

  async function source() {
    setBusy("source");
    setNote(null);
    const r = await sourceSuppliersAction(request.id);
    setBusy(null);
    await refresh();
    onChanged();
    if (!r.ok) setNote(r.error ?? "Couldn't source suppliers.");
    else if (!r.configured) setNote("Web research isn't set up — add a TAVILY_API_KEY, or add suppliers manually.");
    else setNote(r.added ? `Found ${r.added} new supplier${r.added === 1 ? "" : "s"}.` : "No new suppliers found — try adding some manually.");
  }
  async function draftAll() {
    setBusy("draftall");
    setNote(null);
    const r = await draftAllRfqsAction(request.id);
    setBusy(null);
    await refresh();
    setNote(r.drafted ? `Drafted ${r.drafted} RFQ${r.drafted === 1 ? "" : "s"} in the Email Manager.` : "Nothing to draft — suppliers need an email and no existing draft.");
  }

  const quoted = suppliers?.filter((s) => s.status === "quoted").length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> All requests
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{request.title}</h2>
          <p className="text-[11px] text-muted-foreground">
            {quoted}/{request.target_count} quotes collected
            {note && <span className="ml-1 text-emerald-600 dark:text-emerald-400">· {note}</span>}
          </p>
        </div>
      </div>

      <Card className="p-4">
        <Label>Specs / requirements (included in each RFQ)</Label>
        <Textarea
          rows={3}
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          onBlur={() => updateQuoteRequestAction(request.id, { spec })}
        />
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={source} disabled={busy !== null}>
          {busy === "source" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Source suppliers
        </Button>
        <Button size="sm" variant="secondary" onClick={draftAll} disabled={busy !== null}>
          {busy === "draftall" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Draft all RFQs
        </Button>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add supplier
        </Button>
      </div>

      {suppliers === null ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : suppliers.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <Sparkles className="h-8 w-8 opacity-40" />
          <p className="text-sm">No suppliers yet.</p>
          <p className="text-xs">Source suppliers from the web, or add one manually.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Supplier</th>
                <th className="w-28 px-3 py-2">Status</th>
                <th className="w-32 px-3 py-2">Price</th>
                <th className="w-32 px-3 py-2">Lead time</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => {
                const st = STATUS_META[s.status];
                return (
                  <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-accent/50">
                    <td className="px-3 py-2.5">
                      <button onClick={() => setOpen(s)} className="block w-full min-w-0 text-left">
                        <div className="truncate font-medium hover:underline">{s.company}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{s.contact_email || "no email yet"}</div>
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", st.cls)}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px] text-muted-foreground">{s.quote_price || "—"}</td>
                    <td className="px-3 py-2.5 text-[12.5px] text-muted-foreground">{s.quote_lead_time || "—"}</td>
                    <td className="px-2 py-2.5 text-right">
                      {s.website && (
                        <a href={s.website.startsWith("http") ? s.website : `https://${s.website}`} target="_blank" rel="noreferrer" title="Website" className="text-muted-foreground hover:text-foreground">
                          <Globe className="h-4 w-4" />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <SupplierDialog supplier={open} onClose={() => setOpen(null)} onChanged={refresh} />
      <AddSupplierDialog open={adding} requestId={request.id} onClose={() => setAdding(false)} onAdded={refresh} />
    </div>
  );
}

/* --------------------------------- page ---------------------------------- */

export default function QuotesPage() {
  const [requests, setRequests] = useState<QuoteRequest[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setRequests(await listQuoteRequestsAction());
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Deep-link from the Executive's source_quotes tool: /quotes?open=<id>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setOpenId(id);
  }, []);

  const openReq = requests?.find((r) => r.id === openId) ?? null;

  return (
    <>
      <PageHeader
        title="Quotes"
        description="Source suppliers and collect quotes. Ask the Executive to 'find me quotes for…', or start a request here."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New request
          </Button>
        }
      />
      <PageBody className="space-y-5">
        {openReq ? (
          <RequestDetail request={openReq} onBack={() => setOpenId(null)} onChanged={refresh} />
        ) : requests === null ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <FileSearch className="h-9 w-9 opacity-40" />
            <p className="max-w-sm text-sm">
              No quote requests yet. Start one — the agent researches suppliers and drafts a request-for-quote email to each
              in your Email Manager to review and send.
            </p>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New request
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {requests.map((r) => (
              <Card key={r.id} className="group flex items-center gap-3 p-3">
                <button onClick={() => setOpenId(r.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium hover:underline">{r.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{r.supplier_count ?? 0} suppliers</span>
                    {(r.sent_count ?? 0) > 0 && <span>· {r.sent_count} sent</span>}
                    <span className="text-emerald-600 dark:text-emerald-400">
                      · {r.quoted_count ?? 0}/{r.target_count} quotes
                    </span>
                  </div>
                </button>
                <button
                  onClick={async () => {
                    if (!window.confirm(`Delete "${r.title}" and its suppliers?`)) return;
                    await deleteQuoteRequestAction(r.id);
                    refresh();
                  }}
                  className="shrink-0 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                  title="Delete request"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Card>
            ))}
          </div>
        )}
      </PageBody>

      <RequestDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          setOpenId(id);
          refresh();
        }}
      />
    </>
  );
}
