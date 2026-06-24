import { cn } from "@/lib/cn";

/** Operator wordmark + approval-check glyph. */
export function Logo({
  className,
  showText = true,
  size = "md",
}: {
  className?: string;
  showText?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const box =
    size === "sm" ? "h-7 w-7" : size === "lg" ? "h-10 w-10" : "h-8 w-8";
  const text =
    size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "relative inline-flex items-center justify-center rounded-[10px] bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-sm",
          box,
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-[60%] w-[60%]"
          aria-hidden
        >
          <path
            d="M5 12.5l4 4 10-10"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {showText && (
        <span className={cn("font-semibold tracking-tight text-foreground", text)}>
          Operator
        </span>
      )}
    </span>
  );
}
