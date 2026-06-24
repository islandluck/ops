import {
  Inbox,
  PenLine,
  Receipt,
  Telescope,
  TrendingUp,
  ShieldCheck,
  ShieldAlert,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { Badge, Dot } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  CATEGORY_META,
  PERMISSION_META,
  RISK_META,
  STATUS_META,
} from "@/lib/constants";
import type { Category, PermissionMode, RiskLevel, TaskStatus } from "@/lib/types";

export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  growth: TrendingUp,
  admin: Inbox,
  content: PenLine,
  research: Telescope,
  finance: Receipt,
};

export function CategoryIcon({
  category,
  className,
}: {
  category: Category;
  className?: string;
}) {
  const Icon = CATEGORY_ICONS[category];
  return <Icon className={className} />;
}

export function CategoryTag({
  category,
  className,
}: {
  category: Category;
  className?: string;
}) {
  const meta = CATEGORY_META[category];
  const Icon = CATEGORY_ICONS[category];
  return (
    <Badge className={cn(meta.tag, className)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function RiskBadge({
  risk,
  className,
}: {
  risk: RiskLevel;
  className?: string;
}) {
  const meta = RISK_META[risk];
  return (
    <Badge className={cn(meta.tag, className)}>
      <Dot className={meta.dot} />
      {meta.label}
    </Badge>
  );
}

export function StatusPill({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px] font-medium",
        meta.headerText,
        className,
      )}
    >
      <Dot className={meta.dot} />
      {meta.label}
    </span>
  );
}

const PERMISSION_ICONS: Record<PermissionMode, LucideIcon> = {
  suggest: Shield,
  approval: ShieldCheck,
  auto: ShieldAlert,
};

export function PermissionBadge({
  mode,
  className,
}: {
  mode: PermissionMode;
  className?: string;
}) {
  const meta = PERMISSION_META[mode];
  const Icon = PERMISSION_ICONS[mode];
  return (
    <Badge className={cn(meta.tag, className)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function CategoryIconChip({
  category,
  className,
  size = "md",
}: {
  category: Category;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const meta = CATEGORY_META[category];
  const Icon = CATEGORY_ICONS[category];
  const dim =
    size === "sm" ? "h-6 w-6" : size === "lg" ? "h-10 w-10" : "h-8 w-8";
  const icon = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg",
        meta.iconBg,
        dim,
        className,
      )}
    >
      <Icon className={icon} />
    </span>
  );
}
