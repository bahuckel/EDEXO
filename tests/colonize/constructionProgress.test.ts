import { describe, expect, it } from "vitest";
import { normalizeConstructionProgress } from "../../src/shared/colonize/constructionProgress";

describe("normalizeConstructionProgress", () => {
  it("treats legacy 0–100 values as fractions", () => {
    expect(normalizeConstructionProgress(50)).toBe(0.5);
  });

  it("passes through 0–1 values", () => {
    expect(normalizeConstructionProgress(0.75)).toBe(0.75);
  });

  it("clamps invalid input to 0", () => {
    expect(normalizeConstructionProgress(Number.NaN)).toBe(0);
  });
});
