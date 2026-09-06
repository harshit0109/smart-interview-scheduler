/** @type {import('next').NextConfig} */

// The FastAPI backend origin. Server-side only (no NEXT_PUBLIC_ prefix) — the
// browser always talks to this Next server on a same-origin /api path and the
// rewrite below proxies through. Avoids CORS entirely.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
