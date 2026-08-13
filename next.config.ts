import type { NextConfig } from "next";

// GitHub Pages serves static files only. `output: 'export'` rules out API routes,
// middleware, server actions and cookies() — all authorization lives in Postgres RLS.
//
// basePath is required because this deploys to a *project* page
// (https://l05dhruv.github.io/raduler/) rather than a user page. It is configurable so
// a future custom domain only needs an env var, not a code change.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  // Emits `route/index.html` instead of `route.html`, which GitHub Pages serves for
  // deep links without any rewrite rules.
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
