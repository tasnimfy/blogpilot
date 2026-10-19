// ---------------------------------------------------------------------------
// Post-build fix for Next.js `output: "standalone"`.
//
// The standalone server (npm run start -> node .next/standalone/server.js,
// and docker/entrypoint.sh) serves /_next/static/* (CSS, JS, media) from
// .next/standalone/.next/static, but `next build` does NOT copy those assets
// there. Without this step every page renders as unstyled HTML (assets 404).
//
// This is the copy the official Next.js standalone docs require:
//   https://nextjs.org/docs/pages/api-reference/next-config-js/output
// ---------------------------------------------------------------------------

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const nextDir = join(root, ".next");
const standaloneDir = join(nextDir, "standalone");

if (!existsSync(standaloneDir)) {
  console.log("[prepare-standalone] No .next/standalone output found; skipping.");
  process.exit(0);
}

// 1. Static assets (CSS/JS/fonts/media) -> .next/standalone/.next/static
const staticSrc = join(nextDir, "static");
const staticDest = join(standaloneDir, ".next", "static");
if (existsSync(staticSrc)) {
  mkdirSync(staticDest, { recursive: true });
  cpSync(staticSrc, staticDest, { recursive: true });
  console.log("[prepare-standalone] Copied .next/static -> .next/standalone/.next/static");
} else {
  console.warn("[prepare-standalone] WARNING: .next/static not found; standalone assets will 404.");
}

// 2. Public assets (favicon, robots.txt, ...) -> .next/standalone/public
//    (this repo has no public/ directory yet; skip silently if absent)
const publicSrc = join(root, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, join(standaloneDir, "public"), { recursive: true });
  console.log("[prepare-standalone] Copied public -> .next/standalone/public");
}

console.log("[prepare-standalone] Done. Standalone server can now serve static assets.");
