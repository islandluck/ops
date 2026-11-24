import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/ai/client";
import type {
  NetworkingChannel,
  NetworkingDraft,
  NetworkingEvent,
  NetworkingPerson,
  NetworkingPlan,
} from "@/lib/types";

/**
 * Networking AI — a seasoned connector / BD strategist. Given who the founder wants to
 * reach and why, it uses Claude's native web search + fetch to research the target, find
 * upcoming events, surface public contact channels (email / X / LinkedIn / org), reason
 * about WARM PATHS through the founder's own network, and draft friendly intro emails.
 * It never sends and never connects — it produces a plan the founder reviews. Server-only.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

// allowed_callers:["direct"] is REQUIRED — these server tools otherwise default to
// "programmatic tool calling", which models like Haiku 4.5 don't support (→ 400).
const WEB_SEARCH_TOOL = { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 8, allowed_callers: ["direct" as const] };
const WEB_FETCH_TOOL = { type: "web_fetch_20260209" as const, name: "web_fetch" as const, max_uses: 10, allowed_callers: ["direct" as const] };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const clip = (v: unknown, n: number): string => str(v).trim().slice(0, n);

function nurl(v: unknown): string | null {
  const s = str(v).trim();
  return /^https?:\/\//i.test(s) ? s.slice(0, 600) : null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const candidates = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const o = JSON.parse(c);
      if (o && typeof o === "object") return o as Record<string, unknown>;
    } catch {
      /* next */
    }
  }
  return null;
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : [];
}

function coercePerson(o: Record<string, unknown>, relation: NetworkingPerson["relation"]): NetworkingPerson | null {
  const name = clip(o.name, 120);
  if (!name) return null;
  return {
    name,
    role: clip(o.role, 120),
    company: clip(o.company, 120),
    relation,
    note: clip(o.note, 400),
    connection: clip(o.connection, 400),
  };
}

function coerceChannel(o: Record<string, unknown>): NetworkingChannel | null {
  const raw = str(o.kind).trim().toLowerCase();
  const kind: NetworkingChannel["kind"] = raw === "email" || raw === "x" || raw === "linkedin" ? raw : "web";
  const value = clip(o.value, 600);
  if (!value) return null;
  const label = clip(o.label, 40) || (kind === "x" ? "X / Twitter" : kind === "linkedin" ? "LinkedIn" : kind === "email" ? "Email" : "Web");
  return { kind, label, value, note: clip(o.note, 300) };
}

function coerceEvent(o: Record<string, unknown>): NetworkingEvent | null {
  const name = clip(o.name, 200);
  if (!name) return null;
  return { name, when: clip(o.when, 80), where: clip(o.where, 120), why: clip(o.why, 400), url: nurl(o.url) };
}

function coerceDraft(o: Record<string, unknown>): NetworkingDraft | null {
  const subject = clip(o.subject, 200);
  const body = clip(o.body, 4000);
  if (!subject && !body) return null;
  const rawCh = str(o.channel).trim().toLowerCase();
  const channel: NetworkingDraft["channel"] =
    rawCh === "x" || rawCh === "twitter" || rawCh === "tweet" ? "x" : rawCh === "linkedin" ? "linkedin" : "email";
  const email = clip(o.to_email, 200);
  return {
    channel,
    to_name: clip(o.to_name, 120),
    // An email address only makes sense for the email channel.
    to_email: channel === "email" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "",
    purpose: clip(o.purpose, 200),
    subject: channel === "email" ? subject : "",
    body,
    draft_id: null,
  };
}

function coercePlan(obj: Record<string, unknown> | null, fallbackText: string): NetworkingPlan {
  if (!obj) {
    return {
      summary: fallbackText.slice(0, 1500),
      target_research: "",
      events: [],
      warm_paths: [],
      channels: [],
      drafts: [],
      steps: [],
    };
  }
  return {
    summary: clip(obj.summary, 1500),
    target_research: clip(obj.target_research, 2000),
    events: arr(obj.events).map(coerceEvent).filter((e): e is NetworkingEvent => e !== null).slice(0, 8),
    warm_paths: arr(obj.warm_paths).map((o) => coercePerson(o, "warm_path")).filter((p): p is NetworkingPerson => p !== null).slice(0, 10),
    channels: arr(obj.channels).map(coerceChannel).filter((c): c is NetworkingChannel => c !== null).slice(0, 8),
    drafts: arr(obj.drafts).map(coerceDraft).filter((d): d is NetworkingDraft => d !== null).slice(0, 4),
    steps: Array.isArray(obj.steps) ? obj.steps.map((s) => clip(s, 300)).filter(Boolean).slice(0, 10) : [],
  };
}

export interface PlanNetworkingInput {
  who: string;
  context: string;
  company: string;
  companyDescription: string;
  /** Compact "your existing network" dossier (CRM people + companies) for warm paths. */
  network: string;
  /** Compact list of the workspace's current opportunities/events, if any. */
  opportunities: string;
  /** Optional founder steer for a REGENERATE — "focus on the warm path via X", etc. */
  direction?: string;
}

/**
 * Research a target and draft a networking plan (approach, events, warm paths, direct
 * channels, friendly intro drafts, steps). Throws only if the AI key is missing.
 */
export async function planNetworking(input: PlanNetworkingInput): Promise<NetworkingPlan> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();

  const system = [
    "You are a seasoned connector and business-development strategist helping a founder network their way to a specific person or outcome. You are warm, genuine, and resourceful — you find real, respectful ways in, never spam.",
    input.companyDescription ? `The founder's company: ${input.company} — ${input.companyDescription}.` : input.company ? `The founder's company: ${input.company}.` : "",
    "Use web_search + web_fetch to RESEARCH the target: who they are, their current roles/affiliations/companies, what they care about, and where they show up (events, talks, boards, podcasts). Open pages to confirm facts — never invent.",
    "Find UPCOMING events, conferences, or gatherings where the target (or people close to them) is likely to be — a real, warm place to connect in person.",
    "Find DIRECT channels to reach the target or their org: a public or role-based email, their X/Twitter profile, their LinkedIn, or an org contact page. Note how reliable each is and whether it realistically accepts a cold, friendly note. Surface profiles for the founder to connect to MANUALLY — never claim you connected.",
    "WARM PATHS: you are given the founder's existing network (CRM people + companies they deal with). Identify who in THAT network plausibly has a tie to the target (same company, shared board, same field, mutual event) and would make a natural intro. Prefer a warm intro over a cold one. Research a contact's tie when it's worth confirming.",
    input.network ? `The founder's existing network:\n${input.network}` : "The founder has no CRM network loaded yet — focus on direct channels and events; note that warm paths are limited.",
    input.opportunities ? `Opportunities/events already on the founder's radar (reuse any that fit):\n${input.opportunities}` : "",
    "Draft 1–4 FRIENDLY intros to set up (e.g. one to the target directly if a reachable email exists, and/or one asking a warm-path contact for an intro). Voice: brief, human, no hard pitch — introduce who we are, the genuine reason for reaching out (use the founder's stated angle), and suggest a coffee if they're ever in town or a short call if they're open to it. The goal is to expand the relationship, not to sell.",
    "EACH draft MUST be tagged with the right `channel`: `email` for an email (give a subject + body); `x` for a tweet or X DM (a short, warm message ≤280 chars, no subject); `linkedin` for a LinkedIn connection note (a short message, no subject). Match the channel to how that person is actually reachable — do NOT write a tweet as an email or vice-versa.",
    `The founder's angle / why they're reaching out: ${input.context || "(not specified — infer a genuine, specific reason from the research and the company)"}.`,
    input.direction?.trim() ? `REVISION — the founder wants you to adjust this plan: ${input.direction.trim()}. Honor it and re-plan around it.` : "",
    "",
    'When done, respond with ONLY this JSON (no prose, no fences): {"summary": string (2-3 sentences: the approach), "target_research": string (who they are + where they show up), "events": [{"name","when","where","why","url"}], "warm_paths": [{"name","role","company","note" (how the founder knows them),"connection" (their tie to the target)}], "channels": [{"kind":"email"|"x"|"linkedin"|"web","label","value" (the email or profile URL),"note"}], "drafts": [{"channel":"email"|"x"|"linkedin","to_name","to_email" (a real reachable email for email channel, else ""),"purpose","subject" (email only, else ""),"body"}], "steps": string[] (the ordered action plan)}',
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = `Help me network my way to: ${input.who}\n\nResearch them now (search, then open the best pages), map warm paths through my network, find events + direct channels, draft the friendly intros, then return the JSON.`;

  // Server tools run inline; a long turn may return stop_reason "pause_turn" — feed the
  // partial turn back to continue. Returns the final assistant text.
  const runWithTools = async (tools: Anthropic.Messages.ToolUnion[]): Promise<string> => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];
    let text = "";
    for (let i = 0; i < 7; i++) {
      const msg = await client.messages.create({ model: MODEL, max_tokens: 5000, system, tools, messages });
      text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      if (msg.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      break;
    }
    return text;
  };

  let text: string;
  try {
    text = await runWithTools([WEB_SEARCH_TOOL, WEB_FETCH_TOOL]);
  } catch {
    text = await runWithTools([WEB_SEARCH_TOOL]);
  }
  return coercePlan(parseJsonObject(text), text);
}
