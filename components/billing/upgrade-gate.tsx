"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getEntitlementAction } from "@/app/actions";
import type { EntitlementView } from "@/lib/types";

/**
 * Wrap a premium surface so it shows an upgrade prompt when the workspace isn't
 * entitled — but ONLY when enforcement is on (`BILLING_ENFORCED=1`). With
 * enforcement off (the default) it always renders children, so nothing changes.
 * This is the UX layer; enforce sensitive server actions separately for security.
 */
export function UpgradeGate({
  feature,
  title,
  children,
}: {
  feature: string;
  title: string;
  children: React.ReactNode;
}) {
  const [ent, setEnt] = useState<EntitlementView | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getEntitlementAction()
      .then(setEnt)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const blocked = loaded && ent?.enforced === true && ent.can[feature] === false;
  if (blocked) return <UpgradeScreen title={title} />;
  return <>{children}</>;
}

function UpgradeScreen({ title }: { title: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-6 w-6" />
        </span>
        <h2 className="text-[17px] font-semibold">{title} is on the Operator plan</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          Upgrade to unlock {title} and the full AI ops team — every agent, all integrations, human-in-the-loop.
        </p>
        <Button className="mt-5" onClick={() => router.push("/billing")}>
          View plans <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
