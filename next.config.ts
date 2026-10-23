import type { NextConfig } from "next";
const config: NextConfig = {
  agentRules: false,
  turbopack: { root: process.cwd() },
  distDir: process.env.STARS_NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["node:sqlite"],
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_DATA_MODE: process.env.DATA_MODE === "supabase" ? "supabase" : "local",
  },
  outputFileTracingIncludes: {
    "/api/artist-portrait": ["./assets/licensed/zhang-jie.jpg"],
  },
  outputFileTracingExcludes: {
    "/*": ["./.data/**", "./.test-data/**", "./.npm-cache/**", "./.env*", "./shared-conversation*", "./verification/**", "./verification-*", "./*-docs.html", "./playwright-report/**", "./test-results/**"]
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
    ] }];
  }
};
export default config;
