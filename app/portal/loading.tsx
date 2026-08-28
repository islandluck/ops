/** Instant skeleton for the team portal while its route payload streams in. */
export default function PortalLoading() {
  return (
    <div className="space-y-4">
      <div className="h-7 w-40 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-muted/40" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-border bg-muted/40" />
    </div>
  );
}
