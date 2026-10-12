import { describe, expect, it } from "vitest";
import { ARTIZEN_RULE, moneyRows } from "@/lib/pledges";

describe("Artizen rule card", () => {
  it("shows zeros plainly with an empty line", () => {
    expect(moneyRows({ people: 0, feesCents: 0, paidCents: 0 })).toEqual([
      { label: "Pledged", value: "50% of winnings (prize not yet decided)" },
      { label: "In place now", value: "$0" },
      { label: "Paid out so far", value: "$0" },
      { label: "People in line", value: "0" },
    ]);
  });

  it("takes paid and people from the live line, not fees claimed", () => {
    const rows = moneyRows({ people: 3, feesCents: 99_999, paidCents: 1_250 });
    expect(rows.find((r) => r.label === "Paid out so far")?.value).toBe("$12.50");
    expect(rows.find((r) => r.label === "People in line")?.value).toBe("3");
    expect(rows.find((r) => r.label === "In place now")?.value).toBe("$0");
  });

  it("keeps the rule copy free of em dashes, dates for results, and Tempo or card payments", () => {
    const text = [...ARTIZEN_RULE.rows.map((r) => `${r.label} ${r.value}`), ARTIZEN_RULE.setOn, ARTIZEN_RULE.pledged].join(" ");
    expect(text).not.toMatch(/—|Tempo|card payment|13 Oct/i);
    expect(ARTIZEN_RULE.rows.map((r) => r.label)).toEqual([
      "Who pledges", "What", "Who gets it", "Order", "When", "What counts as paid", "Record",
    ]);
  });
});
