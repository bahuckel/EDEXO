import { describe, expect, it } from "vitest";
import { parseMarketId } from "../../src/shared/colonize/marketId";

describe("parseMarketId", () => {
  it("spells one market the same way from every source", () => {
    const spellings = [3799000101, "3799000101", " 3799000101 ", "3,799,000,101", "03799000101"];
    expect(new Set(spellings.map(parseMarketId))).toEqual(new Set(["3799000101"]));
  });

  it("is not fooled into inventing market 0", () => {
    expect(parseMarketId("")).toBeNull();
    expect(parseMarketId("   ")).toBeNull();
    expect(parseMarketId(0)).toBe("0");
    expect(parseMarketId("0")).toBe("0");
  });

  it("rejects what is not an id", () => {
    for (const bad of [null, undefined, Number.NaN, -1, 1.5, Infinity, "abc", "12a", "1e3", {}, [], true]) {
      expect(parseMarketId(bad), String(bad)).toBeNull();
    }
  });
});
