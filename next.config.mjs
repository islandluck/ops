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
};

export default nextConfig;
