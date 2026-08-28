/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint is intentionally not configured for this prototype; skip during builds.
  eslint: { ignoreDuringBuilds: true },
  // Keep the document-parsing stack (pdf-parse → pdfjs-dist + the native canvas)
  // OUT of the webpack server bundle. pdfjs references browser globals (DOMMatrix)
  // and @napi-rs/canvas ships native .node binaries — bundling either breaks the
  // server runtime. Externalized, they're require()'d from node_modules at runtime
  // (only when Deep Dive actually parses a document).
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  // The board's whole-workspace bundle save posts every task in one server
  // action. Next's default 1MB body limit silently rejected it once a workspace
  // grew large — so settings edits (like turning a background agent OFF) never
  // persisted. Raise the ceiling so a busy workspace saves reliably. The real
  // anti-runaway fix is the per-agent generation caps + targeted writes; this is
  // defense-in-depth for everything else that still rides the bundle save.
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
    // Let the client Router Cache reuse a dynamic route's rendered payload for 30s
    // instead of Next 15's default of 0. Every route here is dynamic (per-user
    // cookies), so with the default the shared (product) layout re-ran its Supabase
    // Auth network call + workspace/role DB queries on EVERY navigation between
    // pages. Caching for 30s makes moving between recently-visited pages instant and
    // eliminates that repeated auth+DB work — the biggest "clicking is slow" fix.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
