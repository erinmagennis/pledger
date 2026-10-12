// Copy the DKIM verifier from ../verify/src into src/lib/verify/ for the Next build.
// Turbopack does not map NodeNext-style './x.js' imports to .ts files outside the app,
// so the copy drops the .js suffixes. Run after any change in ../verify/src:
//   node scripts/sync-verify.mjs
// test/verify-sync.test.ts fails if the copy drifts.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../verify/src/", import.meta.url));
const to = fileURLToPath(new URL("../src/lib/verify/", import.meta.url));

export const HEADER = "// GENERATED from verify/src by app/scripts/sync-verify.mjs. Do not edit here.\n";
export const rewrite = (src) => HEADER + src.replace(/(from\s+['"]\.\/[\w-]+)\.js(['"])/g, "$1$2");

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from).filter((f) => f.endsWith(".ts"))) {
    writeFileSync(to + f, rewrite(readFileSync(from + f, "utf8")));
    console.log("synced", f);
  }
}
