import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { GmailMessage } from "@/lib/integrations/google";
import type { PlanBrief } from "@/lib/ai/plan";
import type { Category } from "@/lib/types";

/**
 * Email triage classifier — for each incoming email, infers relationship,
 * intent, urgency, and the best next action, and writes a summary (+ a suggested
 * reply when the action is Reply). One batched Claude call, aligned by index.
 * Server-only; gated on ANTHROPIC_API_KEY. Purely advisory: it never sends,
 * deletes, or forwards — those stay human-approved downstream.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export type TriageCategory = "Investor" | "Customer" | "Internal" | "Admin" | "Noise";
export type TriageUrgency = "Critical" | "High" | "Normal" | "Low";
export type TriageAction = "Reply" | "Schedule" | "Read" | "Delegate" | "Archive";

export interface TriagedEmail {
  category: TriageCategory;
  urgency: TriageUrgency;
  intent: string;
  relationship: string;
  action_type: TriageAction;
  summary: string;
  suggested_reply: string;
  /** Work the email implies (beyond a reply). Empty title = no task. */
  task_title: string;
  task_detail: string;
  /** Which team handles the task (routes it to that agent). */
  task_department: Category;
}

const CATEGORIES: TriageCategory[] = ["Investor", "Customer", "Internal", "Admin", "Noise"];
const URGENCIES: TriageUrgency[] = ["Critical", "High", "Normal", "Low"];
const ACTIONS: TriageAction[] = ["Reply", "Schedule", "Read", "Delegate", "Archive"];
const DEPARTMENTS: Category[] = ["growth", "admin", "content", "research", "finance"];

function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export async function triageEmails(emails: GmailMessage[], brief: PlanBrief): Promise<TriagedEmail[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI triage is not configured (ANTHROPIC_API_KEY missing).");
  if (!emails.length) return [];

  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const system = [
    "You are an email triage assistant for a busy founder.",
    `They run ${brief.company_name || "a company"}. ${[brief.business_description, brief.core_offer].filter(Boolean).join(" ")}`.trim(),
    brief.ideal_customer_profile ? `Their customers: ${brief.ideal_customer_profile}` : "",
    brief.voice_rules.length ? `Their brand voice: ${brief.voice_rules.join("; ")}` : "",
    "",
    "For EACH email, infer the sender relationship, intent, urgency, and the single best next action, then write a 1–2 sentence summary. Write a suggested_reply ONLY when a reply from the founder is genuinely warranted (typically a Reply action, or a brief holding reply for an urgent Customer/Investor issue) — concise, on-brand, plain text; if it would need facts you don't have, keep it short and non-committal. Otherwise leave suggested_reply as an empty string.",
    "ALSO: if the email implies WORK the team should DO beyond just replying — schedule a meeting, prepare/send a document, investigate an issue, follow up, update the CRM, pay or file something — produce task_title (a short imperative action), task_detail (what needs to happen, with context and a suggested first step), and task_department (the team that handles it: growth, admin, content, research, finance). If there's no such work, leave task_title empty. An email can have BOTH a suggested_reply and a task.",
    "",
    "category: Investor, Customer, Internal, Admin, Noise.",
    "urgency: Critical, High, Normal, Low.",
    "action_type: Reply, Schedule, Read, Delegate, Archive.",
    "Guardrails: never suggest deleting, forwarding externally, or auto-sending. Anything involving money, legal terms, or commitments → summarize + flag, and keep any suggested reply cautious and non-committal.",
    "",
    "Respond with ONLY a JSON array — one object per email, in the SAME ORDER — no markdown or code fences:",
    '[{"category": string, "urgency": string, "intent": string, "relationship": string, "action_type": string, "summary": string, "suggested_reply": string, "task_title": string, "task_detail": string, "task_department": string}]',
  ]
    .filter(Boolean)
    .join("\n");

  const list = emails
    .map((e, i) =>
      [
        `--- Email [${i}] ---`,
        `From: ${e.from.name} <${e.from.email}>`,
        `Subject: ${e.subject}`,
        `Date: ${e.date}`,
        `Body: ${(e.body || e.snippet).slice(0, 1500)}`,
      ].join("\n"),
    )
    .join("\n\n");

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: `Triage these ${emails.length} emails:\n\n${list}` }],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();

  let arr: unknown;
  try {
    arr = JSON.parse(stripFences(text));
  } catch {
    throw new Error("Triage returned an unreadable response. Please try again.");
  }
  if (!Array.isArray(arr)) throw new Error("Triage returned an unexpected shape.");

  const pick = (v: unknown, allowed: readonly string[], fallback: string): string =>
    typeof v === "string" && (allowed as string[]).includes(v) ? v : fallback;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  return emails.map((_, i) => {
    const r = (arr[i] ?? {}) as Record<string, unknown>;
    return {
      category: pick(r.category, CATEGORIES, "Admin") as TriageCategory,
      urgency: pick(r.urgency, URGENCIES, "Normal") as TriageUrgency,
      intent: str(r.intent),
      relationship: str(r.relationship),
      action_type: pick(r.action_type, ACTIONS, "Read") as TriageAction,
      summary: str(r.summary),
      suggested_reply: str(r.suggested_reply),
      task_title: str(r.task_title),
      task_detail: str(r.task_detail),
      task_department: pick(r.task_department, DEPARTMENTS, "admin") as Category,
    };
  });
}
