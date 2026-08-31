"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { getEntitlementAction } from "@/app/actions";
import type { EntitlementView } from "@/lib/types";

/**
 * A slim banner counting down the free trial. Only shows when enforcement is on
 * AND the workspace is trialing — invisible by default, so it appears exactly
 * when it's meaningful (access will lapse without a plan).
 */
export function TrialBanner() {
  const [ent, setEnt] = useState<EntitlementView | null>(null);

  useEffect(() => {
    getEntitlementAction()
      .then(setEnt)
      .catch(() => {});
  }, []);

  if (!ent || !ent.enforced || !ent.trialing || !ent.trialEndsAt) return null;
  const days = Math.max(0, Math.ceil((new Date(ent.trialEndsAt).getTime() - Date.now()) / 86_400_000));

  return (
    <div className="flex items-center justify-center gap-2 border-b border-amber-500/25 bg-amber-500/10 px-4 py-1.5 text-center text-[12.5px] text-amber-700 dark:text-amber-300">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>{days === 0 ? "Your free trial ends today." : `${days} day${days === 1 ? "" : "s"} left in your free trial.`}</span>
      <Link href="/billing" className="font-semibold underline underline-offset-2 transition hover:opacity-80">
        Choose a plan
      </Link>
    </div>
  );
}
