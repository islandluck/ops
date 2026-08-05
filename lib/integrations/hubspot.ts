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

export interface HubSpotSnapshot {
  connected: boolean;
  contactsSampled: number;
  newContacts7d: number;
  uncontacted: HsContact[];
  openDeals: HsDeal[];
  pipelineValue: number;
  staleDeals: HsDeal[];
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

async function hsSearch(token: string, object: "contacts" | "deals", body: SearchBody): Promise<SearchResult> {
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

export async function hsSearchContactByEmail(token: string, email: string): Promise<HsContact | null> {
  const json = await hsSearch(token, "contacts", {
    filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
    properties: ["email", "firstname", "lastname", "company", "createdate", "notes_last_contacted", "lifecyclestage"],
    limit: 1,
  });
  const first = json.results?.[0];
  return first ? toContact(first) : null;
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

  const [recent, deals] = await Promise.all([hsRecentContacts(token, 30), hsOpenDeals(token)]);
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const staleCutoff = now - STALE_DEAL_DAYS * 24 * 60 * 60 * 1000;

  const newContacts7d = recent.filter((c) => new Date(c.createdAt).getTime() >= weekAgo).length;
  const uncontacted = recent.filter((c) => !c.lastContactedAt && c.email).slice(0, 20);
  const staleDeals = deals.filter(
    (d) => d.lastModifiedAt && new Date(d.lastModifiedAt).getTime() < staleCutoff,
  );

  return {
    connected: true,
    contactsSampled: recent.length,
    newContacts7d,
    uncontacted,
    openDeals: deals,
    pipelineValue: deals.reduce((sum, d) => sum + d.amount, 0),
    staleDeals,
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
  const parts = [
    `CRM (HubSpot): ${snap.openDeals.length} open deal${snap.openDeals.length === 1 ? "" : "s"} worth ${money(snap.pipelineValue)}`,
    `${snap.newContacts7d} new contact${snap.newContacts7d === 1 ? "" : "s"} this week`,
  ];
  if (snap.staleDeals.length) {
    const top = snap.staleDeals
      .slice(0, 3)
      .map((d) => `${d.name}${d.amount ? ` (${money(d.amount)})` : ""} — ${d.stageLabel}`)
      .join("; ");
    parts.push(
      `${snap.staleDeals.length} deal${snap.staleDeals.length === 1 ? "" : "s"} idle >${STALE_DEAL_DAYS}d: ${top}`,
    );
  }
  if (snap.uncontacted.length)
    parts.push(`${snap.uncontacted.length} recent contact${snap.uncontacted.length === 1 ? "" : "s"} never contacted`);
  return parts.join(". ") + ".";
}
