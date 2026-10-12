import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
// @ts-expect-error plain .mjs script
import { rewrite } from "../scripts/sync-verify.mjs";

const from = new URL("../../verify/src/", import.meta.url);
const to = new URL("../src/lib/verify/", import.meta.url);

describe("src/lib/verify copy", () => {
  it("matches ../verify/src (run node scripts/sync-verify.mjs if this fails)", () => {
    const files = readdirSync(from).filter((f) => f.endsWith(".ts")).sort();
    expect(readdirSync(to).filter((f) => f.endsWith(".ts")).sort()).toEqual(files);
    for (const f of files) expect(readFileSync(new URL(f, to), "utf8"), f).toBe(rewrite(readFileSync(new URL(f, from), "utf8")));
  });
});
