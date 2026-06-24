/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint is intentionally not configured for this prototype; skip during builds.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
