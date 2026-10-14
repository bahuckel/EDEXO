/**
 * The neutron planner's supercharge (2026-10-15): a range typed in for another ship was planned with the current
 * ship's supercharge. The drawer now sends ×4 or ×6 with the range.
 */
import { describe, expect, it } from "vitest";
import { planBoost } from "../src/server/routes/neutronRoutes.js";

describe("the supercharge a neutron plan uses", () => {
  it("takes the drawer's ×4 or ×6 over the current ship's", () => {
    expect(planBoost(4, 6)).toBe(4);
    expect(planBoost(6, 4)).toBe(6);
  });
  it("falls back to the current ship's, then ×4, for anything else", () => {
    expect(planBoost(undefined, 6)).toBe(6);
    expect(planBoost(5, 6)).toBe(6);
    expect(planBoost("6", null)).toBe(4);
    expect(planBoost(null, null)).toBe(4);
  });
});
