import path from "node:path";
import type { NextConfig } from "next";

// Root is the repo folder so the app can use postal-mime from ../verify/node_modules
// (needed by the DKIM verifier copy in src/lib/verify; no separate install in app).
const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  turbopack: {
    root: repoRoot,
    resolveAlias: { "postal-mime": "../verify/node_modules/postal-mime" },
  },
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
