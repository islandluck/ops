"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronLeft,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Mail,
  Plus,
  Search,
  Send,
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
  addContactAction,
  composeOutreachTextAction,
  createOutreachCampaignAction,
  deleteContactAction,
  deleteOutreachCampaignAction,
  draftAllOutreachAction,
  draftOutreachAction,
  listContactsAction,
  listOutreachCampaignsAction,
  sourceContactsAction,
  updateContactAction,
  updateOutreachCampaignAction,
} from "@/app/actions";
import type { OutreachCampaign, OutreachContact, OutreachStatus } from "@/lib/types";

const CONTACT_STATUS: { key: OutreachStatus; label: string; cls: string }[] = [
  { key: "found", label: "Found", cls: "border-border bg-muted/50 text-muted-foreground" },
  { key: "drafted", label: "Drafted", cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  { key: "sent", label: "Sent", cls: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400" },
  { key: "replied", label: "Replied", cls: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400" },
  { key: "meeting", label: "Meeting", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  { key: "declined", label: "Declined", cls: "border-border bg-muted/50 text-muted-foreground" },
  { key: "no_response", label: "No response", cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
];
const STATUS_META = Object.fromEntries(CONTACT_STATUS.map((s) => [s.key, s])) as Record<
  OutreachStatus,
  { key: OutreachStatus; label: string; cls: string }
>;

/* ------------------------------ new campaign ----------------------------- */

function CampaignDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [roles, setRoles] = useState("");
  const [count, setCount] = useState(5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setRoles("");
    setCount(5);
    setError(null);
  }, [open]);

  async function create() {
    if (!title.trim()) {
      setError("Describe who you want to reach and why.");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await createOutreachCampaignAction({ title, description, target_roles: roles, target_count: count });
    setSaving(false);
    if (r.ok) onCreated(r.campaignId);
    else setError(r.error ?? "Couldn't create the campaign.");
  }

  return (
    <Dialog open={open} onClose={onClose} title="New outreach campaign" className="max-w-xl">
      <div className="flex flex-col gap-3">
        <div>
          <Label>Who do you want to reach, and why?</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Fertilizer companies — pilot a CLAS reactor / scale production"
          />
        </div>
        <div>
          <Label>Context / pitch</Label>
          <Textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What you're offering, why it's relevant to them, and the ask (e.g. a 20-min intro call). The agent uses this to personalize each email."
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Target roles</Label>
            <Input
              value={roles}
              onChange={(e) => setRoles(e.target.value)}
              placeholder="VP Business Development, Head of Procurement"
            />
          </div>
          <div>
            <Label>Companies to find</Label>
            <Input type="number" min={1} max={15} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-24" />
          </div>
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

/* ------------------------------ contact dialog --------------------------- */

function ContactDialog({
  contact,
  onClose,
  onChanged,
}: {
  contact: OutreachContact | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState("");
  const [personName, setPersonName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [contactUrl, setContactUrl] = useState("");
  const [status, setStatus] = useState<OutreachStatus>("found");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [composed, setComposed] = useState<{ subject: string; body: string; url: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!contact) return;
    setCompany(contact.company);
    setWebsite(contact.website ?? "");
    setPersonName(contact.person_name);
    setTitle(contact.title);
    setEmail(contact.contact_email ?? "");
    setContactUrl(contact.contact_url ?? "");
    setStatus(contact.status);
    setNote(contact.note);
    setMsg(null);
    setComposed(null);
    setCopied(false);
  }, [contact]);

  if (!contact) return null;

  async function save() {
    setBusy("save");
    await updateContactAction(contact!.id, {
      company,
      website,
      person_name: personName,
      title,
      contact_email: email,
      contact_url: contactUrl,
      status,
      note,
    });
    setBusy(null);
    onChanged();
  }
  async function draftEmail() {
    setBusy("draft");
    setMsg(null);
    await updateContactAction(contact!.id, { contact_email: email });
    const r = await draftOutreachAction(contact!.id);
    setBusy(null);
    if ("ok" in r && r.ok) {
      setMsg({ ok: true, text: "Outreach email drafted in the Email Manager — review and send it there." });
      onChanged();
    } else setMsg({ ok: false, text: ("error" in r && r.error) || "Couldn't draft the email." });
  }
  async function composeForProfile() {
    setBusy("compose");
    setMsg(null);
    if (contactUrl.trim() !== (contact!.contact_url ?? "")) await updateContactAction(contact!.id, { contact_url: contactUrl });
    const r = await composeOutreachTextAction(contact!.id);
    setBusy(null);
    if (r.ok) {
      setComposed({ subject: r.subject ?? "", body: r.body ?? "", url: r.contact_url ?? (contactUrl.trim() || null) });
      setCopied(false);
    } else setMsg({ ok: false, text: r.error ?? "Couldn't compose the message." });
  }
  async function copyComposed() {
    if (!composed) return;
    const text = `Subject: ${composed.subject}\n\n${composed.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg({ ok: false, text: "Couldn't copy — select the text and copy manually." });
    }
  }
  async function remove() {
    if (!window.confirm(`Remove ${contact!.person_name || contact!.company}?`)) return;
    await deleteContactAction(contact!.id);
    onChanged();
    onClose();
  }

  const inputCls = "w-full";
  return (
    <Dialog open={!!contact} onClose={onClose} title={contact.person_name || contact.company || "Contact"} className="max-w-xl">
      <div className="flex max-h-[76vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Full name" className={inputCls} />
          </div>
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VP Business Development" className={inputCls} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Company</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} className={inputCls} />
          </div>
          <div>
            <Label>Status</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as OutreachStatus)}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
            >
              {CONTACT_STATUS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={inputCls} />
          </div>
          <div>
            <Label>Website</Label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="company.com" className={inputCls} />
          </div>
        </div>
        <div>
          <Label>LinkedIn / contact URL</Label>
          <Input
            value={contactUrl}
            onChange={(e) => setContactUrl(e.target.value)}
            placeholder="https://linkedin.com/in/…"
            className={inputCls}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            For contacts with no email. Generate a message below, then open the profile and send it yourself.
          </p>
        </div>

        <div>
          <Label>Notes</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why they fit, what to mention, follow-ups…" />
        </div>

        {composed && (
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Message to send</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={copyComposed}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground/80 transition hover:text-foreground"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                {composed.url && (
                  <a
                    href={composed.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-primary underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open profile
                  </a>
                )}
              </div>
            </div>
            <div className="mt-2 text-[12.5px] font-medium">{composed.subject}</div>
            <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[12.5px] text-muted-foreground">
              {composed.body}
            </pre>
          </div>
        )}

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
          <button type="button" onClick={remove} className="text-muted-foreground transition hover:text-destructive" title="Remove contact">
            <Trash2 className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={save} disabled={busy !== null}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
            {contact.outbound_draft_id ? (
              <a href="/email" className="inline-flex">
                <Button size="sm" variant="secondary">
                  <ExternalLink className="h-4 w-4" /> View draft
                </Button>
              </a>
            ) : email.trim() ? (
              <Button size="sm" onClick={draftEmail} disabled={busy !== null}>
                {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Draft email
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={composeForProfile}
                disabled={busy !== null || !contactUrl.trim()}
                title={!contactUrl.trim() ? "Add an email or a LinkedIn/contact URL first" : undefined}
              >
                {busy === "compose" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Compose message
              </Button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------ add contact ------------------------------ */

function AddContactDialog({
  open,
  campaignId,
  onClose,
  onAdded,
}: {
  open: boolean;
  campaignId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [company, setCompany] = useState("");
  const [personName, setPersonName] = useState("");
  const [title, setTitle] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [contactUrl, setContactUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCompany("");
    setPersonName("");
    setTitle("");
    setWebsite("");
    setEmail("");
    setContactUrl("");
  }, [open]);

  async function add() {
    if (!company.trim()) return;
    setSaving(true);
    await addContactAction(campaignId, {
      company,
      person_name: personName,
      title,
      website,
      contact_email: email,
      contact_url: contactUrl,
    });
    setSaving(false);
    onAdded();
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add contact" className="max-w-md">
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Head of Partnerships" />
          </div>
        </div>
        <div>
          <Label>Company</Label>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
        <div>
          <Label>Website</Label>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="company.com" />
        </div>
        <div>
          <Label>Email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
        </div>
        <div>
          <Label>LinkedIn / contact URL</Label>
          <Input value={contactUrl} onChange={(e) => setContactUrl(e.target.value)} placeholder="https://linkedin.com/in/…" />
          <p className="mt-1 text-[11px] text-muted-foreground">Optional — if you'll reach them via profile instead of email.</p>
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

/* ----------------------------- campaign detail --------------------------- */

function CampaignDetail({ campaign, onBack, onChanged }: { campaign: OutreachCampaign; onBack: () => void; onChanged: () => void }) {
  const [contacts, setContacts] = useState<OutreachContact[] | null>(null);
  const [open, setOpen] = useState<OutreachContact | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [description, setDescription] = useState(campaign.description);
  const [roles, setRoles] = useState(campaign.target_roles);

  const refresh = useCallback(async () => {
    const c = await listContactsAction(campaign.id);
    setContacts(c);
    setOpen((cur) => (cur ? c.find((x) => x.id === cur.id) ?? null : null));
  }, [campaign.id]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    setDescription(campaign.description);
    setRoles(campaign.target_roles);
  }, [campaign]);

  async function source() {
    setBusy("source");
    setNote(null);
    const r = await sourceContactsAction(campaign.id);
    setBusy(null);
    await refresh();
    onChanged();
    if (!r.ok) setNote(r.error ?? "Couldn't source contacts.");
    else if (!r.configured) setNote("AI web research isn't available right now — add contacts manually.");
    else setNote(r.added ? `Found ${r.added} new contact${r.added === 1 ? "" : "s"}.` : "No new contacts found — try adding some manually.");
  }
  async function draftAll() {
    setBusy("draftall");
    setNote(null);
    const r = await draftAllOutreachAction(campaign.id);
    setBusy(null);
    await refresh();
    const profileOnly = (contacts ?? []).filter((c) => !c.contact_email && c.contact_url && c.status === "found").length;
    const tail = profileOnly ? ` ${profileOnly} contact${profileOnly === 1 ? "" : "s"} have no email — open each to compose a message.` : "";
    setNote((r.drafted ? `Drafted ${r.drafted} email${r.drafted === 1 ? "" : "s"} in the Email Manager.` : "No email drafts to create.") + tail);
  }

  const sent = contacts?.filter((c) => c.status === "sent" || c.status === "replied" || c.status === "meeting").length ?? 0;
  const replied = contacts?.filter((c) => c.status === "replied" || c.status === "meeting").length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> All campaigns
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{campaign.title}</h2>
          <p className="text-[11px] text-muted-foreground">
            {contacts?.length ?? 0} contacts · {sent} sent · {replied} replied
            {note && <span className="ml-1 text-emerald-600 dark:text-emerald-400">· {note}</span>}
          </p>
        </div>
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <div>
          <Label>Context / pitch (used to personalize each email)</Label>
          <Textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => updateOutreachCampaignAction(campaign.id, { description })}
          />
        </div>
        <div>
          <Label>Target roles</Label>
          <Input
            value={roles}
            onChange={(e) => setRoles(e.target.value)}
            onBlur={() => updateOutreachCampaignAction(campaign.id, { target_roles: roles })}
            placeholder="VP Business Development, Head of Procurement"
          />
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={source} disabled={busy !== null}>
          {busy === "source" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Find contacts
        </Button>
        <Button size="sm" variant="secondary" onClick={draftAll} disabled={busy !== null}>
          {busy === "draftall" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Draft all emails
        </Button>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add contact
        </Button>
      </div>

      {contacts === null ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : contacts.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <Sparkles className="h-8 w-8 opacity-40" />
          <p className="text-sm">No contacts yet.</p>
          <p className="text-xs">Find contacts from the web, or add one manually.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Contact</th>
                <th className="w-48 px-3 py-2">Title</th>
                <th className="w-28 px-3 py-2">Status</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const st = STATUS_META[c.status];
                return (
                  <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-accent/50">
                    <td className="px-3 py-2.5">
                      <button onClick={() => setOpen(c)} className="block w-full min-w-0 text-left">
                        <div className="truncate font-medium hover:underline">{c.person_name || c.company}</div>
                        <div className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                          {c.person_name && <span className="truncate">{c.company} · </span>}
                          {c.contact_email ? (
                            <span className="truncate">{c.contact_email}</span>
                          ) : c.contact_url ? (
                            <>
                              <FileText className="h-3 w-3 shrink-0" /> Profile
                            </>
                          ) : (
                            "no contact yet"
                          )}
                        </div>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px] text-muted-foreground">
                      <span className="line-clamp-2">{c.title || "—"}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", st.cls)}>{st.label}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {c.website && (
                        <a
                          href={c.website.startsWith("http") ? c.website : `https://${c.website}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Website"
                          className="text-muted-foreground hover:text-foreground"
                        >
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

      <ContactDialog contact={open} onClose={() => setOpen(null)} onChanged={refresh} />
      <AddContactDialog open={adding} campaignId={campaign.id} onClose={() => setAdding(false)} onAdded={refresh} />
    </div>
  );
}

/* --------------------------------- page ---------------------------------- */

export default function OutreachPage() {
  const [campaigns, setCampaigns] = useState<OutreachCampaign[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setCampaigns(await listOutreachCampaignsAction());
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Deep-link from the Executive's run_outreach tool: /outreach?open=<id>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setOpenId(id);
  }, []);

  const openCampaign = campaigns?.find((c) => c.id === openId) ?? null;

  return (
    <>
      <PageHeader
        title="Outreach"
        description="Reach the right people at the right companies. Describe who and why — the agent finds contacts and drafts a personalized email to each in your Email Manager to review and send."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New campaign
          </Button>
        }
      />
      <PageBody className="space-y-5">
        {openCampaign ? (
          <CampaignDetail campaign={openCampaign} onBack={() => setOpenId(null)} onChanged={refresh} />
        ) : campaigns === null ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Send className="h-9 w-9 opacity-40" />
            <p className="max-w-sm text-sm">
              No outreach campaigns yet. Start one — the agent finds the right companies and people, then drafts a personalized
              email to each in your Email Manager to review and send.
            </p>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New campaign
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {campaigns.map((c) => (
              <Card key={c.id} className="group flex items-center gap-3 p-3">
                <button onClick={() => setOpenId(c.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium hover:underline">{c.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{c.contact_count ?? 0} contacts</span>
                    {(c.sent_count ?? 0) > 0 && <span>· {c.sent_count} sent</span>}
                    {(c.replied_count ?? 0) > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">· {c.replied_count} replied</span>
                    )}
                  </div>
                </button>
                <button
                  onClick={async () => {
                    if (!window.confirm(`Delete "${c.title}" and its contacts?`)) return;
                    await deleteOutreachCampaignAction(c.id);
                    refresh();
                  }}
                  className="shrink-0 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                  title="Delete campaign"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Card>
            ))}
          </div>
        )}
      </PageBody>

      <CampaignDialog
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
