/**
 * Instant skeleton for product routes. Without a loading boundary, Next.js
 * cannot prefetch these dynamic (cookie-reading) routes and navigation freezes
 * on the previous page until the server responds — the "every click is slow"
 * feeling. With it, the shell is prefetchable and a skeleton paints immediately
 * while the route's payload streams in. Renders inside the persisted AppShell.
 */
export default function ProductLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-border bg-card px-5 py-4 sm:px-7">
        <div className="min-w-0 space-y-2">
          <div className="h-6 w-52 animate-pulse rounded-md bg-muted" />
          <div className="h-3.5 w-72 max-w-full animate-pulse rounded bg-muted/60" />
        </div>
        <div className="ml-auto h-9 w-32 animate-pulse rounded-lg bg-muted" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-5 py-7 sm:px-7">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-muted/40" />
            ))}
          </div>
          <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <div className="h-80 animate-pulse rounded-xl border border-border bg-muted/40" />
            <div className="h-80 animate-pulse rounded-xl border border-border bg-muted/40" />
          </div>
        </div>
      </div>
    </div>
  );
}
