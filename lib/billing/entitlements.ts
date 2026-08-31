import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import type { PlanTier } from "./plans";

/**
 * Plan entitlements — what a workspace is allowed to use, given its subscription,
 * trial, and grandfathering. Enforcement is OFF unless `BILLING_ENFORCED=1`, so
 * building + wiring gates changes nothing until you deliberately flip it on.
 *
 * Grandfathering: workspaces created before `BILLING_ENFORCE_FROM` (an ISO date)
 * keep full access, so existing beta users are never locked out when you enable
 * enforcement. Everyone created after gets a self-serve trial, then must subscribe.
 */

export const TIER_RANK: Record<PlanTier, number> = { free: 0, starter: 1, operator: 2, agency: 3 };

/** Gated features → the minimum tier that unlocks them. Anything not listed is
 *  "core" and available on every tier (tasks, approvals, today, brief, settings…). */
export const FEATURE_MIN_TIER = {
  social: "starter",
  content: "starter",
  executive: "operator",
  boardroom: "operator",
  opportunities: "operator",
  deep_dive: "operator",
  email_manager: "operator",
  ads: "operator",
  command_center: "operator",
  multi_workspace: "agency",
} as const satisfies Record<string, PlanTier>;

export type Feature = keyof typeof FEATURE_MIN_TIER;
export const ALL_FEATURES = Object.keys(FEATURE_MIN_TIER) as Feature[];

function trialDays(): number {
  const n = Number(process.env.BILLING_TRIAL_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 14;
}
function isEnforced(): boolean {
  return process.env.BILLING_ENFORCED === "1";
}
function enforceFrom(): Date | null {
  const s = process.env.BILLING_ENFORCE_FROM;
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface Entitlement {
  /** The paid tier on record (free when there's no active subscription). */
  tier: PlanTier;
  /** What the workspace can actually use, after trial / grandfather / enforcement. */
  effectiveTier: PlanTier;
  status: string;
  enforced: boolean;
  trialing: boolean;
  trialEndsAt: string | null;
  grandfathered: boolean;
  canUse: (f: Feature) => boolean;
}

export async function getEntitlement(workspaceId: string): Promise<Entitlement> {
  const [ws] = await db
    .select({
      tier: workspaces.subscription_tier,
      status: workspaces.subscription_status,
      createdAt: workspaces.created_at,
      trialEndsAt: workspaces.trial_ends_at,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  const tier = (ws?.tier ?? "free") as PlanTier;
  const status = ws?.status ?? "none";
  const enforced = isEnforced();
  const created = ws?.createdAt ? new Date(ws.createdAt) : new Date();
  const from = enforceFrom();
  const grandfathered = !!from && created.getTime() < from.getTime();

  const now = Date.now();
  const hasStripeSub = status === "active" || status === "trialing";
  // Self-serve trial: a no-card window from signup for workspaces that aren't
  // grandfathered and haven't subscribed.
  const selfTrialEnd = created.getTime() + trialDays() * 86_400_000;
  const inSelfTrial = status === "none" && !grandfathered && now < selfTrialEnd;
  const trialing = status === "trialing" || inSelfTrial;
  const trialEndsAt =
    status === "trialing" && ws?.trialEndsAt
      ? new Date(ws.trialEndsAt).toISOString()
      : inSelfTrial
        ? new Date(selfTrialEnd).toISOString()
        : null;

  let effectiveTier: PlanTier;
  if (!enforced) {
    effectiveTier = "agency"; // gating off → everyone has everything
  } else if (hasStripeSub) {
    effectiveTier = tier === "free" ? "operator" : tier; // a Stripe sub carries its tier
  } else if (grandfathered || inSelfTrial) {
    effectiveTier = "operator"; // beta users + trialers get the full core product
  } else {
    effectiveTier = "free";
  }

  const rank = TIER_RANK[effectiveTier];
  return {
    tier,
    effectiveTier,
    status,
    enforced,
    trialing,
    trialEndsAt,
    grandfathered,
    canUse: (f: Feature) => rank >= TIER_RANK[FEATURE_MIN_TIER[f]],
  };
}

export async function canUseFeature(workspaceId: string, feature: Feature): Promise<boolean> {
  return (await getEntitlement(workspaceId)).canUse(feature);
}
