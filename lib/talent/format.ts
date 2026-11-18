// Client-safe talent helpers (no server imports) — shared by the public job
// pages and the internal /talent UI.

import type { JobPost, PayType } from "@/lib/types";

const CURRENCY_SYMBOL: Record<string, string> = { usd: "$", cad: "$", gbp: "£", eur: "€", aud: "$" };

/** Format a pay amount (integer cents) for display. Salary = whole units; hourly = 2dp. */
function fmtAmount(cents: number, payType: PayType, currency: string): string {
  const sym = CURRENCY_SYMBOL[currency?.toLowerCase()] ?? "$";
  const value = cents / 100;
  if (payType === "hourly") return `${sym}${value.toFixed(2)}`;
  return `${sym}${Math.round(value).toLocaleString("en-US")}`;
}

/**
 * Human label for a job's compensation (e.g. "$90,000–$120,000 / yr" or
 * "$45.00 / hr"), or null when pay isn't shown.
 */
export function formatPay(job: Pick<JobPost, "pay_type" | "pay_min" | "pay_max" | "pay_currency">): string | null {
  if (job.pay_type === "unspecified" || job.pay_min == null) return null;
  const cur = job.pay_currency || "usd";
  const min = fmtAmount(job.pay_min, job.pay_type, cur);
  const range =
    job.pay_max != null && job.pay_max > job.pay_min ? `${min}–${fmtAmount(job.pay_max, job.pay_type, cur)}` : min;
  return `${range} / ${job.pay_type === "hourly" ? "hr" : "yr"}`;
}

/** A sensible default pay model for an employment type (used to pre-fill the editor). */
export function defaultPayType(employment: JobPost["employment_type"]): PayType {
  return employment === "contract" || employment === "temporary" || employment === "internship" ? "hourly" : "salary";
}

/** A neutral, editable EEO / at-will boilerplate the owner can insert and customize. */
export const STANDARD_COMPLIANCE = `## Equal opportunity employer
We are an equal opportunity employer and value diversity on our team. We do not discriminate on the basis of race, color, religion, sex, sexual orientation, gender identity, national origin, age, disability, genetic information, veteran status, or any other characteristic protected by law.

We are committed to providing reasonable accommodations for qualified individuals with disabilities. If you need an accommodation during the application process, please let us know.

Employment is at-will. This posting is a description of the role and is not a contract or guarantee of employment.`;
