import Link from "next/link";

/** Friendly 404 for unknown routes, styled to match the app shell. */
export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
      <p className="text-4xl font-bold text-muted-foreground">404</p>
      <h2 className="text-base font-semibold">Page not found</h2>
      <p className="max-w-sm text-sm text-muted-foreground">That page doesn’t exist or has moved.</p>
      <Link
        href="/today"
        className="mt-1 inline-flex items-center rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition hover:bg-muted"
      >
        Go home
      </Link>
    </div>
  );
}
