import { describe, expect, it, vi } from "vitest";

// The route only needs a non-null client to get past the "not connected" check; these cases stop before any query.
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({}), DB_MISSING: { error: "Database not connected yet" } }));
const { POST } = await import("@/app/api/claims/submit/route");

function post(payload: unknown) {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  return POST(new Request("http://x/api/claims/submit", { method: "POST", body: form }));
}

const base = {
  fingerprints: ["ab"],
  payout: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  display: { mode: "full", name: "Ana Ortiz" },
  noChargeback: true,
  notRestrictedRegion: true,
  timestamp: 1,
};

describe("claim submit input checks", () => {
  it("rejects fingerprints that are not all strings with a 400", async () => {
    const res = await post({ ...base, fingerprints: ["ab", 3] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Claim details are missing");
  });

  it("rejects a public name that looks like a wallet or link", async () => {
    const res = await post({ ...base, display: { mode: "full", name: "Pay 0x1234 instead" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("A name cannot include a link, email or wallet address");
  });

  it("ignores the name when the claim is shown by project only", async () => {
    const res = await post({ ...base, display: { mode: "project", name: "0x1234" } });
    // Gets past the name check and stops at the missing files instead.
    expect((await res.json()).error).toBe("No files sent");
  });
});
