import { Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

interface MiniCard {
  title: string;
  cat: string;
  dot: string;
  agent: string;
  meta?: string;
}

const COLUMNS: { label: string; tone: string; cards: MiniCard[]; hero?: boolean }[] =
  [
    {
      label: "Agent Working",
      tone: "bg-indigo-400",
      cards: [
        {
          title: "Re-engage 5 cooled trial signups",
          cat: "Growth",
          dot: "bg-emerald-500",
          agent: "Growth Agent",
          meta: "Drafting…",
        },
        {
          title: "Draft June newsletter",
          cat: "Content",
          dot: "bg-violet-500",
          agent: "Content Agent",
        },
      ],
    },
    {
      label: "Ready for Approval",
      tone: "bg-amber-400",
      hero: true,
      cards: [
        {
          title: "Follow up with 12 warm leads",
          cat: "Growth",
          dot: "bg-emerald-500",
          agent: "Growth Agent",
          meta: "12 actions",
        },
        {
          title: "Invoice reminders · 3 clients",
          cat: "Finance",
          dot: "bg-rose-500",
          agent: "Finance Agent",
        },
      ],
    },
    {
      label: "Done",
      tone: "bg-teal-500",
      cards: [
        {
          title: "Updated 14 HubSpot records",
          cat: "Growth",
          dot: "bg-emerald-500",
          agent: "Growth Agent",
        },
        {
          title: "Sent 4 calendar invites",
          cat: "Admin",
          dot: "bg-sky-500",
          agent: "Admin Agent",
        },
      ],
    },
  ];

export function HeroBoard() {
  return (
    <div className="relative rounded-2xl border border-border bg-canvas p-3 shadow-elevated sm:p-4">
      {/* faux top bar */}
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
        </div>
        <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Approval Center
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {COLUMNS.map((col) => (
          <div key={col.label} className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 px-1">
              <span className={cn("h-1.5 w-1.5 rounded-full", col.tone)} />
              <span className="truncate text-[10.5px] font-semibold text-muted-foreground">
                {col.label}
              </span>
            </div>
            {col.cards.map((card, i) => (
              <div
                key={card.title}
                className={cn(
                  "rounded-lg border bg-card p-2.5 shadow-card",
                  col.hero && i === 0
                    ? "border-amber-300 ring-2 ring-amber-200"
                    : "border-border",
                )}
              >
                <div className="mb-1.5 flex items-center gap-1">
                  <span className={cn("h-1.5 w-1.5 rounded-full", card.dot)} />
                  <span className="text-[9.5px] font-medium text-muted-foreground">
                    {card.cat}
                  </span>
                  {card.meta && (
                    <span className="ml-auto rounded bg-muted px-1 text-[9px] font-medium text-muted-foreground">
                      {card.meta}
                    </span>
                  )}
                </div>
                <p className="text-[11.5px] font-medium leading-snug text-foreground">
                  {card.title}
                </p>
                {col.hero && i === 0 ? (
                  <div className="mt-2 flex items-center gap-1">
                    <span className="inline-flex items-center gap-1 rounded-md bg-success px-2 py-1 text-[10px] font-semibold text-white shadow-sm">
                      <Check className="h-2.5 w-2.5" /> Approve
                    </span>
                    <span className="rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      Changes
                    </span>
                  </div>
                ) : (
                  <div className="mt-1.5 flex items-center gap-1">
                    <span className="inline-flex h-3.5 items-center rounded-full bg-primary/10 px-1 text-[8px] font-semibold text-primary">
                      {card.agent}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* floating "agent prepared" chip */}
      <div className="absolute -bottom-3 -right-2 hidden items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium shadow-elevated sm:flex">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        Agents prepared 6 tasks
      </div>
    </div>
  );
}
