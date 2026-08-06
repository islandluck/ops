/**
 * Infer which integrations a task should ACT on from its text, intersected with
 * what's actually connected. This is what makes a "schedule the standup" task
 * carry "Google Calendar" so it executes for real — instead of an empty
 * affected_systems list that falls through to a no-op. Deterministic + cheap
 * (no AI call); pure function, safe to import anywhere.
 */

interface Rule {
  system: string;
  re: RegExp;
}

// Order matters only for readability; all matching systems are returned.
const RULES: Rule[] = [
  {
    system: "Google Calendar",
    re: /\b(schedul\w*|meeting|stand[- ]?up|calendar|invite|appointment|book(?:ing|ed)?|call with|\bsync\b|1:1|one[- ]on[- ]one|put .* on (?:the |my )?calendar|add .* to (?:the |my )?calendar)\b/i,
  },
  {
    system: "Gmail",
    re: /\b(e-?mail|reach out|outreach|follow[- ]?up|send (?:a |an |the )?(?:note|message|email|reminder|intro)|introduce|intro to|reply to|respond to)\b/i,
  },
  {
    system: "HubSpot",
    re: /\b(crm|hubspot|\bcontact\b|\bdeal\b|pipeline|\blead\b|log (?:a |the )?(?:call|note|activity)|update (?:the )?record)\b/i,
  },
  { system: "Google Sheets", re: /\b(spreadsheet|google sheet|tracker|tabulate|export to sheets|log to (?:a )?sheet)\b/i },
  { system: "Notion", re: /\b(notion|knowledge base)\b/i },
  { system: "Stripe", re: /\b(invoice|payment|billing|stripe|subscription|\bcharge\b)\b/i },
  { system: "X (Twitter)", re: /\b(tweet|x post|post to x|twitter|thread)\b/i },
];

/**
 * @param text     Task title + description (what the task is about).
 * @param connected Integration display names currently connected in the workspace.
 * @returns The connected systems the task's intent implies. Empty = no external
 *          action (an internal/drafting task) — the caller should NOT invent one.
 */
export function inferAffectedSystems(text: string, connected: string[]): string[] {
  const t = text || "";
  const has = new Set(connected);
  const out: string[] = [];
  for (const { system, re } of RULES) {
    if (has.has(system) && re.test(t) && !out.includes(system)) out.push(system);
  }
  return out;
}
