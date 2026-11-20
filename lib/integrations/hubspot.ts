import "server-only";

import { getValidAccessToken } from "./tokens";

/**
 * HubSpot CRM calls with an OAuth access token — plus the SNAPSHOT: a compact,
 * agent-readable picture of the CRM (pipeline value, new contacts, stale deals)
 * that feeds Executive KPIs, the daily brief, and every agent's planning
 * context. The CRM is the richest context source the platform can read.
 */

const BASE = "https://api.hubapi.com";
const TIMEOUT_MS = 15_000;

export async function getHubSpotAccount(accessToken: string): Promise<string | null> {
  const res = await fetch(
    `https://api.hubapi.com/oauth/v1/access-tokens/${accessToken}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { hub_domain?: string; user?: string };
  return json.hub_domain ?? json.user ?? "HubSpot account";
}

/** Create or update a contact by email. Returns the contact id. */
export async function upsertContact(
  accessToken: string,
  contact: { email: string; firstname?: string; lastname?: string },
): Promise<{ id: string; created: boolean }> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  const properties = {
    email: contact.email,
    ...(contact.firstname ? { firstname: contact.firstname } : {}),
    ...(contact.lastname ? { lastname: contact.lastname } : {}),
  };

  // Try create; on 409 (already exists) fall back to update by email.
  const createRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers,
    body: JSON.stringify({ properties }),
  });
  if (createRes.ok) {
    const json = (await createRes.json()) as { id: string };
    return { id: json.id, created: true };
  }
  if (createRes.status === 409) {
    const updateRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contact.email)}?idProperty=email`,
      { method: "PATCH", headers, body: JSON.stringify({ properties }) },
    );
    if (updateRes.ok) {
      const json = (await updateRes.json()) as { id: string };
      return { id: json.id, created: false };
    }
    const err = (await updateRes.json()) as { message?: string };
    throw new Error(`HubSpot update failed: ${err.message ?? updateRes.status}`);
  }
  const err = (await createRes.json()) as { message?: string };
  throw new Error(`HubSpot create failed: ${err.message ?? createRes.status}`);
}

/**
 * Validate a HubSpot token (a private-app token, `pat-…`, or an OAuth access
 * token) by making a real CRM read, and return a friendly account label. Used
 * by the "connect with a private app token" path — the simplest way for a
 * single company to connect its own CRM (no developer app / OAuth dance).
 */
export async function hsValidateToken(
  token: string,
): Promise<{ ok: boolean; account: string | null; error?: string }> {
  try {
    const ping = await hsFetch(token, "/crm/v3/objects/contacts?limit=1");
    if (!ping.ok) {
      if (ping.status === 401)
        return {
          ok: false,
          account: null,
          error: "That token was rejected (401). Copy the access token again from the private app’s Auth tab.",
        };
      if (ping.status === 403)
        return {
          ok: false,
          account: null,
          error:
            "The token is valid but missing CRM scopes. In the private app, enable crm.objects.contacts.read/write and crm.objects.deals.read/write, then copy the token again.",
        };
      return { ok: false, account: null, error: `HubSpot rejected the token (${ping.status}).` };
    }
  } catch {
    return { ok: false, account: null, error: "Couldn’t reach HubSpot to validate the token." };
  }

  // Best-effort friendly label (account-info may 403 on a minimal private app).
  let account: string | null = "HubSpot account";
  try {
    const info = await hsFetch(token, "/account-info/v3/details");
    if (info.ok) {
      const j = (await info.json()) as { portalId?: number; uiDomain?: string };
      account = j.uiDomain ? `HubSpot · ${j.uiDomain}` : j.portalId ? `HubSpot · ${j.portalId}` : account;
    }
  } catch {
    /* keep the default label */
  }
  return { ok: true, account };
}

/* --------------------------------- types -------------------------------- */

export interface HsContact {
  id: string;
  email: string;
  name: string;
  company: string;
  createdAt: string;
  lastContactedAt: string | null;
  lifecycleStage: string;
}

export interface HsDeal {
  id: string;
  name: string;
  amount: number;
  stage: string;
  stageLabel: string;
  pipeline: string;
  closeDate: string | null;
  lastModifiedAt: string;
  createdAt: string;
}

export interface HsEmail {
  id: string;
  subject: string;
  /** Plain-text body, truncated — the "context" the agent drafts a reply from. */
  text: string;
  direction: string; // EMAIL (sent) | INCOMING_EMAIL | FORWARDED_EMAIL
  fromEmail: string;
  fromName: string;
  timestamp: string; // ISO
}

export interface HsCompany {
  id: string;
  name: string;
  domain: string;
  industry: string;
  employees: number;
  lifecycleStage: string;
}

export interface HsMeeting {
  id: string;
  title: string;
  startTime: string; // ISO
  endTime: string;
  location: string;
  createdAt: string;
}

export interface HubSpotSnapshot {
  connected: boolean;
  /** Per-object scope availability — a private app is often scoped to a subset,
   *  so each feature gates on its own flag rather than nuking the whole snapshot. */
  contactsAvailable: boolean;
  dealsAvailable: boolean;
  emailsAvailable: boolean;
  companiesAvailable: boolean;
  meetingsAvailable: boolean;
  contactsSampled: number;
  newContacts7d: number;
  uncontacted: HsContact[];
  openDeals: HsDeal[];
  pipelineValue: number;
  staleDeals: HsDeal[];
  /** Latest inbound email per sender (last 7d) — candidates for a reply. */
  awaitingReply: HsEmail[];
  /** Active accounts with firmographics (for account context + personalization). */
  companies: HsCompany[];
  /** Future meetings on the CRM (e.g. booked via a HubSpot scheduling page). */
  upcomingMeetings: HsMeeting[];
  fetchedAt: string;
}

/* -------------------------------- helpers ------------------------------- */

function hsHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function hsFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...hsHeaders(token), ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function str(x: unknown): string {
  return typeof x === "string" ? x : "";
}
function num(x: unknown): number {
  const n = typeof x === "number" ? x : parseFloat(str(x));
  return Number.isFinite(n) ? n : 0;
}

/** Labels for HubSpot's default sales-pipeline stage ids; raw id otherwise. */
const STAGE_LABELS: Record<string, string> = {
  appointmentscheduled: "Appointment scheduled",
  qualifiedtobuy: "Qualified to buy",
  presentationscheduled: "Presentation scheduled",
  decisionmakerboughtin: "Decision maker bought in",
  contractsent: "Contract sent",
  closedwon: "Closed won",
  closedlost: "Closed lost",
};
export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

interface SearchBody {
  filterGroups?: Array<{
    filters: Array<{ propertyName: string; operator: string; value?: string; values?: string[] }>;
  }>;
  sorts?: Array<{ propertyName: string; direction: "ASCENDING" | "DESCENDING" }>;
  properties?: string[];
  limit?: number;
}

interface SearchResult {
  total?: number;
  results?: Array<{ id: string; properties?: Record<string, string | null>; createdAt?: string; updatedAt?: string }>;
}

async function hsSearch(
  token: string,
  object: "contacts" | "deals" | "companies" | "meetings",
  body: SearchBody,
): Promise<SearchResult> {
  const res = await hsFetch(token, `/crm/v3/objects/${object}/search`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot ${object} search failed (${res.status})`);
  return (await res.json()) as SearchResult;
}

/* --------------------------------- reads -------------------------------- */

function toContact(r: NonNullable<SearchResult["results"]>[number]): HsContact {
  const p = r.properties ?? {};
  const name = [str(p.firstname), str(p.lastname)].filter(Boolean).join(" ").trim();
  return {
    id: r.id,
    email: str(p.email),
    name: name || str(p.email) || "Unnamed contact",
    company: str(p.company),
    createdAt: str(p.createdate) || r.createdAt || "",
    lastContactedAt: p.notes_last_contacted ? str(p.notes_last_contacted) : null,
    lifecycleStage: str(p.lifecyclestage),
  };
}

function toDeal(r: NonNullable<SearchResult["results"]>[number]): HsDeal {
  const p = r.properties ?? {};
  const stage = str(p.dealstage);
  return {
    id: r.id,
    name: str(p.dealname) || "Unnamed deal",
    amount: num(p.amount),
    stage,
    stageLabel: stageLabel(stage),
    pipeline: str(p.pipeline),
    closeDate: p.closedate ? str(p.closedate) : null,
    lastModifiedAt: str(p.hs_lastmodifieddate) || r.updatedAt || "",
    createdAt: str(p.createdate) || r.createdAt || "",
  };
}

/** Contacts created in the last `sinceDays`, newest first. */
export async function hsRecentContacts(token: string, sinceDays: number, limit = 100): Promise<HsContact[]> {
  const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const json = await hsSearch(token, "contacts", {
    filterGroups: [{ filters: [{ propertyName: "createdate", operator: "GTE", value: String(since) }] }],
    sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    properties: ["email", "firstname", "lastname", "company", "createdate", "notes_last_contacted", "lifecyclestage"],
    limit: Math.min(limit, 100),
  });
  return (json.results ?? []).map(toContact);
}

/** Open (not closed won/lost) deals, most recently touched first. */
export async function hsOpenDeals(token: string, limit = 100): Promise<HsDeal[]> {
  const json = await hsSearch(token, "deals", {
    filterGroups: [
      { filters: [{ propertyName: "dealstage", operator: "NOT_IN", values: ["closedwon", "closedlost"] }] },
    ],
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
    properties: ["dealname", "amount", "dealstage", "pipeline", "closedate", "hs_lastmodifieddate", "createdate"],
    limit: Math.min(limit, 100),
  });
  return (json.results ?? []).map(toDeal);
}

interface ConvoMessage {
  type?: string;
  text?: string;
  richText?: string;
  subject?: string;
  direction?: string; // INCOMING | OUTGOING
  createdAt?: string;
  senders?: Array<{ name?: string; deliveryIdentifier?: { type?: string; value?: string } }>;
}

/**
 * Inbound messages awaiting a reply, from the Conversations inbox
 * (`conversations.read`). This is HubSpot's path to email/chat CONTENT — the
 * email-engagement object has no grantable read scope on this app type. Returns
 * the latest INCOMING message per open thread. Best-effort + defensive, since
 * it can't be exercised until the scope is granted.
 */
export async function hsAwaitingReply(token: string, threadLimit = 15): Promise<HsEmail[]> {
  const listRes = await hsFetch(token, `/conversations/v3/conversations/threads?limit=${threadLimit}`);
  if (!listRes.ok) throw new Error(`HubSpot conversations list failed (${listRes.status})`);
  const list = (await listRes.json()) as {
    results?: Array<{ id?: string; status?: string; latestMessageTimestamp?: string }>;
  };
  const threads = (list.results ?? [])
    .filter((t) => t.id && t.status !== "CLOSED")
    .sort(
      (a, b) => new Date(b.latestMessageTimestamp ?? 0).getTime() - new Date(a.latestMessageTimestamp ?? 0).getTime(),
    )
    .slice(0, 12);

  const out: HsEmail[] = [];
  for (const t of threads) {
    try {
      const mRes = await hsFetch(token, `/conversations/v3/conversations/threads/${t.id}/messages?limit=20`);
      if (!mRes.ok) continue;
      const mj = (await mRes.json()) as { results?: ConvoMessage[] };
      const msgs = (mj.results ?? []).filter((m) => m.type === "MESSAGE" && (m.text || m.richText));
      if (!msgs.length) continue;
      msgs.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
      const latest = msgs[0];
      if (latest.direction !== "INCOMING") continue; // latest is outbound → already handled
      const sender = latest.senders?.[0];
      const fromEmail =
        sender?.deliveryIdentifier?.type === "HS_EMAIL_ADDRESS" ? str(sender.deliveryIdentifier.value) : "";
      out.push({
        id: str(t.id),
        subject: str(latest.subject) || "your message",
        text: String(latest.text ?? latest.richText ?? "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 4000),
        direction: "INCOMING_EMAIL",
        fromEmail,
        fromName: str(sender?.name) || fromEmail || "Contact",
        timestamp: str(latest.createdAt) || str(t.latestMessageTimestamp),
      });
    } catch {
      /* skip this thread */
    }
  }
  return out;
}

function toCompany(r: NonNullable<SearchResult["results"]>[number]): HsCompany {
  const p = r.properties ?? {};
  return {
    id: r.id,
    name: str(p.name) || "Unnamed company",
    domain: str(p.domain),
    industry: str(p.industry),
    employees: num(p.numberofemployees),
    lifecycleStage: str(p.lifecyclestage),
  };
}

/** Active accounts, most recently touched first. */
export async function hsRecentCompanies(token: string, limit = 100): Promise<HsCompany[]> {
  const json = await hsSearch(token, "companies", {
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
    properties: ["name", "domain", "industry", "numberofemployees", "lifecyclestage", "hs_lastmodifieddate"],
    limit: Math.min(limit, 100),
  });
  return (json.results ?? []).map(toCompany);
}

function toMeeting(r: NonNullable<SearchResult["results"]>[number]): HsMeeting {
  const p = r.properties ?? {};
  return {
    id: r.id,
    title: str(p.hs_meeting_title) || "Meeting",
    startTime: str(p.hs_meeting_start_time),
    endTime: str(p.hs_meeting_end_time),
    location: str(p.hs_meeting_location),
    createdAt: str(p.hs_createdate) || r.createdAt || "",
  };
}

/** Future meetings (e.g. booked via a HubSpot scheduling page), soonest first. */
export async function hsUpcomingMeetings(token: string, limit = 25): Promise<HsMeeting[]> {
  const json = await hsSearch(token, "meetings", {
    filterGroups: [{ filters: [{ propertyName: "hs_meeting_start_time", operator: "GTE", value: String(Date.now()) }] }],
    sorts: [{ propertyName: "hs_meeting_start_time", direction: "ASCENDING" }],
    properties: [
      "hs_meeting_title",
      "hs_meeting_start_time",
      "hs_meeting_end_time",
      "hs_meeting_location",
      "hs_createdate",
    ],
    limit: Math.min(limit, 100),
  });
  return (json.results ?? []).map(toMeeting);
}

/** The primary contact associated with an engagement (meeting/email), or null.
 *  Best-effort — used to log to the right timeline + personalize the draft. */
export async function hsAssociatedContact(
  token: string,
  object: "meetings" | "emails",
  id: string,
): Promise<HsContact | null> {
  try {
    const assoc = await hsFetch(token, `/crm/v4/objects/${object}/${id}/associations/contacts?limit=1`);
    if (!assoc.ok) return null;
    const aj = (await assoc.json()) as { results?: Array<{ toObjectId?: string | number }> };
    const cid = aj.results?.[0]?.toObjectId;
    if (!cid) return null;
    const cres = await hsFetch(
      token,
      `/crm/v3/objects/contacts/${cid}?properties=email,firstname,lastname,company,lifecyclestage`,
    );
    if (!cres.ok) return null;
    const c = (await cres.json()) as { id: string; properties?: Record<string, string | null> };
    return toContact({ id: c.id, properties: c.properties });
  } catch {
    return null;
  }
}

/** The company associated with a deal (v4 associations) — for CRM import attribution. */
export async function hsDealCompany(token: string, dealId: string): Promise<HsCompany | null> {
  try {
    const assoc = await hsFetch(token, `/crm/v4/objects/deals/${dealId}/associations/companies?limit=1`);
    if (!assoc.ok) return null;
    const aj = (await assoc.json()) as { results?: Array<{ toObjectId?: string | number }> };
    const cid = aj.results?.[0]?.toObjectId;
    if (!cid) return null;
    const cres = await hsFetch(
      token,
      `/crm/v3/objects/companies/${cid}?properties=name,domain,industry,numberofemployees,lifecyclestage`,
    );
    if (!cres.ok) return null;
    const c = (await cres.json()) as { id: string; properties?: Record<string, string | null> };
    const p = c.properties ?? {};
    return {
      id: c.id,
      name: p.name ?? "",
      domain: p.domain ?? "",
      industry: p.industry ?? "",
      employees: Number(p.numberofemployees ?? 0) || 0,
      lifecycleStage: p.lifecyclestage ?? "",
    };
  } catch {
    return null;
  }
}

export async function hsSearchContactByEmail(token: string, email: string): Promise<HsContact | null> {
  const json = await hsSearch(token, "contacts", {
    filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
    properties: ["email", "firstname", "lastname", "company", "createdate", "notes_last_contacted", "lifecyclestage"],
    limit: 1,
  });
  const first = json.results?.[0];
  return first ? toContact(first) : null;
}

/**
 * Find contacts by (partial) name — the CRM address-book lookup for the Outbound
 * Composer. Two tokens ("Jane Doe") match firstname AND lastname; a single token
 * matches firstname OR lastname. Returns up to `limit` matches that have an email.
 */
export async function hsSearchContactsByName(token: string, name: string, limit = 5): Promise<HsContact[]> {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const props = ["email", "firstname", "lastname", "company", "createdate", "notes_last_contacted", "lifecyclestage"];
  const filterGroups =
    tokens.length >= 2
      ? [
          {
            filters: [
              { propertyName: "firstname", operator: "CONTAINS_TOKEN", value: tokens[0] },
              { propertyName: "lastname", operator: "CONTAINS_TOKEN", value: tokens[tokens.length - 1] },
            ],
          },
        ]
      : [
          { filters: [{ propertyName: "firstname", operator: "CONTAINS_TOKEN", value: tokens[0] }] },
          { filters: [{ propertyName: "lastname", operator: "CONTAINS_TOKEN", value: tokens[0] }] },
        ];
  try {
    const json = await hsSearch(token, "contacts", { filterGroups, properties: props, limit });
    return (json.results ?? []).map(toContact).filter((c) => c.email);
  } catch {
    return [];
  }
}

/** Convenience: the single best name match with an email, or null. */
export async function hsSearchContactByName(token: string, name: string): Promise<HsContact | null> {
  const [first] = await hsSearchContactsByName(token, name, 1);
  return first ?? null;
}

/* -------------------------------- writes -------------------------------- */

/** Log a note on the CRM timeline, associated to a contact and/or deal.
 *  (Default association type ids: note→contact 202, note→deal 214.) */
export async function hsCreateNote(
  token: string,
  input: { body: string; contactId?: string; dealId?: string },
): Promise<{ id: string }> {
  const associations: Array<{
    to: { id: string };
    types: Array<{ associationCategory: string; associationTypeId: number }>;
  }> = [];
  if (input.contactId)
    associations.push({
      to: { id: input.contactId },
      types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
    });
  if (input.dealId)
    associations.push({
      to: { id: input.dealId },
      types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }],
    });

  const res = await hsFetch(token, "/crm/v3/objects/notes", {
    method: "POST",
    body: JSON.stringify({
      properties: { hs_note_body: input.body.slice(0, 60_000), hs_timestamp: new Date().toISOString() },
      ...(associations.length ? { associations } : {}),
    }),
  });
  if (!res.ok) throw new Error(`HubSpot log note failed (${res.status})`);
  const json = (await res.json()) as { id: string };
  return { id: json.id };
}

export async function hsUpdateDealStage(token: string, dealId: string, stage: string): Promise<void> {
  const res = await hsFetch(token, `/crm/v3/objects/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { dealstage: stage } }),
  });
  if (!res.ok) throw new Error(`HubSpot update deal failed (${res.status})`);
}

/* ------------------------------- snapshot -------------------------------- */

export const STALE_DEAL_DAYS = 14;

/** The agent-readable CRM picture. Null = HubSpot isn't connected. */
export async function getHubSpotSnapshot(workspaceId: string): Promise<HubSpotSnapshot | null> {
  const token = await getValidAccessToken(workspaceId, "HubSpot");
  if (!token) return null;

  // Fetch every object INDEPENDENTLY. A private app is often scoped to a subset
  // (e.g. contacts but not deals/emails) — a failed read on one must NOT nuke
  // the whole snapshot, or every CRM feature silently goes dark despite the
  // others working. Each capability gates on its own availability flag.
  const [recentR, dealsR, emailsR, companiesR, meetingsR] = await Promise.allSettled([
    hsRecentContacts(token, 30),
    hsOpenDeals(token),
    hsAwaitingReply(token),
    hsRecentCompanies(token),
    hsUpcomingMeetings(token),
  ]);
  const recent = recentR.status === "fulfilled" ? recentR.value : [];
  const deals = dealsR.status === "fulfilled" ? dealsR.value : [];
  const emails = emailsR.status === "fulfilled" ? emailsR.value : [];
  const companies = companiesR.status === "fulfilled" ? companiesR.value : [];
  const meetings = meetingsR.status === "fulfilled" ? meetingsR.value : [];

  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const staleCutoff = now - STALE_DEAL_DAYS * 24 * 60 * 60 * 1000;

  const newContacts7d = recent.filter((c) => new Date(c.createdAt).getTime() >= weekAgo).length;
  const uncontacted = recent.filter((c) => !c.lastContactedAt && c.email).slice(0, 20);
  const staleDeals = deals.filter(
    (d) => d.lastModifiedAt && new Date(d.lastModifiedAt).getTime() < staleCutoff,
  );

  // Awaiting reply = the latest inbound email per sender (dedup; each email is
  // only ever drafted once anyway, via the Radar's triaged_crm claim).
  const latestBySender = new Map<string, HsEmail>();
  for (const e of emails) {
    if (!e.fromEmail) continue;
    const key = e.fromEmail.toLowerCase();
    const prev = latestBySender.get(key);
    if (!prev || new Date(e.timestamp).getTime() > new Date(prev.timestamp).getTime()) latestBySender.set(key, e);
  }
  const awaitingReply = [...latestBySender.values()]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);

  return {
    connected: true,
    contactsAvailable: recentR.status === "fulfilled",
    dealsAvailable: dealsR.status === "fulfilled",
    emailsAvailable: emailsR.status === "fulfilled",
    companiesAvailable: companiesR.status === "fulfilled",
    meetingsAvailable: meetingsR.status === "fulfilled",
    contactsSampled: recent.length,
    newContacts7d,
    uncontacted,
    openDeals: deals,
    pipelineValue: deals.reduce((sum, d) => sum + d.amount, 0),
    staleDeals,
    awaitingReply,
    companies: companies.slice(0, 50),
    upcomingMeetings: meetings.slice(0, 10),
    fetchedAt: new Date(now).toISOString(),
  };
}

/** Cached CRM context line for agent prompts. The snapshot hits HubSpot's API,
 *  and planning context is read on every draft/plan — cache per workspace for
 *  10 min so agents stay CRM-aware without hammering the API. Never throws. */
const crmContextCache = new Map<string, { at: number; text: string }>();
export async function getCrmContext(workspaceId: string): Promise<string> {
  const hit = crmContextCache.get(workspaceId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.text;
  try {
    const text = snapshotToContext(await getHubSpotSnapshot(workspaceId));
    crmContextCache.set(workspaceId, { at: Date.now(), text });
    return text;
  } catch {
    return hit?.text ?? "";
  }
}

/** One-paragraph CRM summary for agent prompts ("" when not connected). */
export function snapshotToContext(snap: HubSpotSnapshot | null): string {
  if (!snap || !snap.connected) return "";
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const parts: string[] = [];
  if (snap.dealsAvailable) {
    parts.push(
      `${snap.openDeals.length} open deal${snap.openDeals.length === 1 ? "" : "s"} worth ${money(snap.pipelineValue)}`,
    );
    if (snap.staleDeals.length) {
      const top = snap.staleDeals
        .slice(0, 3)
        .map((d) => `${d.name}${d.amount ? ` (${money(d.amount)})` : ""} — ${d.stageLabel}`)
        .join("; ");
      parts.push(
        `${snap.staleDeals.length} deal${snap.staleDeals.length === 1 ? "" : "s"} idle >${STALE_DEAL_DAYS}d: ${top}`,
      );
    }
  }
  if (snap.contactsAvailable) {
    parts.push(`${snap.newContacts7d} new contact${snap.newContacts7d === 1 ? "" : "s"} this week`);
    if (snap.uncontacted.length)
      parts.push(
        `${snap.uncontacted.length} recent contact${snap.uncontacted.length === 1 ? "" : "s"} never contacted`,
      );
  }
  if (snap.emailsAvailable && snap.awaitingReply.length) {
    parts.push(
      `${snap.awaitingReply.length} conversation${snap.awaitingReply.length === 1 ? "" : "s"} awaiting a reply` +
        (snap.awaitingReply[0] ? ` (latest from ${snap.awaitingReply[0].fromName})` : ""),
    );
  }
  if (snap.meetingsAvailable && snap.upcomingMeetings.length) {
    const next = snap.upcomingMeetings[0];
    parts.push(
      `${snap.upcomingMeetings.length} upcoming meeting${snap.upcomingMeetings.length === 1 ? "" : "s"} booked` +
        (next ? ` (next: ${next.title})` : ""),
    );
  }
  if (snap.companiesAvailable && snap.companies.length) {
    parts.push(`${snap.companies.length} active account${snap.companies.length === 1 ? "" : "s"}`);
  }
  return parts.length ? `CRM (HubSpot): ${parts.join(". ")}.` : "";
}
