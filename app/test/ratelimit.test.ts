import { beforeEach, describe, expect, it } from "vitest";
import { limit, resetLimits } from "@/lib/ratelimit";

beforeEach(resetLimits);

describe("limit", () => {
  it("allows up to max in the window, then says no", () => {
    for (let i = 0; i < 3; i++) expect(limit("k", "1.1.1.1", 3, 1000, 100 + i)).toBe(true);
    expect(limit("k", "1.1.1.1", 3, 1000, 200)).toBe(false);
    expect(limit("k", "1.1.1.1", 3, 1000, 300)).toBe(false);
  });

  it("opens again once the window passes", () => {
    for (let i = 0; i < 3; i++) limit("k", "ip", 3, 1000, 0);
    expect(limit("k", "ip", 3, 1000, 999)).toBe(false);
    expect(limit("k", "ip", 3, 1000, 1000)).toBe(true);
  });

  it("does not count refused requests toward the window", () => {
    limit("k", "ip", 1, 1000, 0);
    for (let t = 100; t < 900; t += 100) expect(limit("k", "ip", 1, 1000, t)).toBe(false);
    expect(limit("k", "ip", 1, 1000, 1000)).toBe(true);
  });

  it("keeps IPs and keys apart", () => {
    expect(limit("a", "ip1", 1, 1000, 0)).toBe(true);
    expect(limit("a", "ip1", 1, 1000, 1)).toBe(false);
    expect(limit("a", "ip2", 1, 1000, 1)).toBe(true);
    expect(limit("b", "ip1", 1, 1000, 1)).toBe(true);
  });
});
