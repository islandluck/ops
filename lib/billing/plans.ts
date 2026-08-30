/**
 * Operator's own subscription plans — the tiers we charge customers to USE Operator.
 * Runs on the PLATFORM Stripe account (`STRIPE_SECRET_KEY`), distinct from the
 * per-workspace Stripe a founder connects to sell their own products.
 *
 * Stripe Price IDs are read from env so the code is deploy-ready before the
 * products exist: create them in Stripe, then set STRIPE_PRICE_* — no code change.
 */

export type PlanTier = "free" | "starter" | "operator" | "agency";

export interface PlanDef {
  key: PlanTier;
  name: string;
  /** Env var holding this tier's Stripe Price ID (recurring monthly). */
  priceEnv?: string;
  /** Display price, e.g. "$149" or "$999–1,500". */
  amountLabel: string;
  /** "/mo" etc. */
  cadence: string;
  tagline: string;
  features: string[];
  /** The anchor tier we lead with. */
  anchor?: boolean;
}

export const PLANS: PlanDef[] = [
  {
    key: "free",
    name: "Free",
    amountLabel: "$0",
    cadence: "",
    tagline: "Beta access while you evaluate Operator.",
    features: ["Full workspace", "Try every surface", "No card required"],
  },
  {
    key: "starter",
    name: "Starter",
    priceEnv: "STRIPE_PRICE_STARTER",
    amountLabel: "$149",
    cadence: "/mo",
    tagline: "Solo founders testing the water.",
    features: ["Social + Content agents", "1 workspace", "Core integrations", "Human-in-the-loop approvals"],
  },
  {
    key: "operator",
    name: "Operator",
    priceEnv: "STRIPE_PRICE_OPERATOR",
    amountLabel: "$500",
    cadence: "/mo",
    tagline: "The full AI ops team — our core plan.",
    features: [
      "Every agent (Executive, Boardroom, more)",
      "All integrations",
      "1 workspace",
      "Human-in-the-loop approvals",
    ],
    anchor: true,
  },
  {
    key: "agency",
    name: "Agency",
    priceEnv: "STRIPE_PRICE_AGENCY",
    amountLabel: "$999",
    cadence: "/mo",
    tagline: "Small agencies running multiple clients.",
    features: ["Everything in Operator", "Multiple client workspaces", "More seats", "Priority support"],
  },
];

const PAID_TIERS: PlanTier[] = ["starter", "operator", "agency"];

export function planByTier(tier: string | null | undefined): PlanDef {
  return PLANS.find((p) => p.key === tier) ?? PLANS[0];
}

/** The platform Stripe secret key (Andros's account) — subscriptions live here. */
export function platformStripeKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY || undefined;
}

/** The Stripe Price ID configured for a tier, or null if not set up yet. */
export function priceIdForTier(tier: PlanTier): string | null {
  const def = PLANS.find((p) => p.key === tier);
  if (!def?.priceEnv) return null;
  return process.env[def.priceEnv] || null;
}

/** Reverse-map a Stripe Price ID back to a tier (for webhook syncing). */
export function tierForPriceId(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null;
  for (const tier of PAID_TIERS) {
    if (priceIdForTier(tier) === priceId) return tier;
  }
  return null;
}

/** True once the platform key + at least one paid Price ID are configured. */
export function billingConfigured(): boolean {
  return Boolean(platformStripeKey()) && PAID_TIERS.some((t) => priceIdForTier(t));
}

/** Tiers that currently have a usable Price ID (so the UI only offers real ones). */
export function purchasableTiers(): PlanTier[] {
  return PAID_TIERS.filter((t) => priceIdForTier(t));
}
