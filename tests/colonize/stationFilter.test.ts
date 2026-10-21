import { describe, expect, it } from "vitest";
import {
  parseMinLandingPad,
  parseStationKindFilter,
  stationMeetsKindFilter,
  stationMeetsMinPad,
} from "../../src/shared/colonize/stationFilter";

describe("stationMeetsMinPad", () => {
  it("treats Any as no restriction", () => {
    expect(stationMeetsMinPad("any", "S", "Space Outpost")).toBe(true);
  });

  it("uses the Pad column when present", () => {
    expect(stationMeetsMinPad("L", "L", "Space Outpost")).toBe(true);
    expect(stationMeetsMinPad("L", "M", "Starport - Coriolis")).toBe(false);
    expect(stationMeetsMinPad("M", "M", "Space Outpost")).toBe(true);
    expect(stationMeetsMinPad("M", "S", "Space Outpost")).toBe(false);
  });

  it("falls back to station type when pad is missing", () => {
    expect(stationMeetsMinPad("L", null, "Starport - Coriolis")).toBe(true);
    expect(stationMeetsMinPad("L", null, "Space Outpost")).toBe(false);
    expect(stationMeetsMinPad("L", null, "unknown")).toBe(false);
  });
});

describe("stationMeetsKindFilter", () => {
  it("splits space vs ground", () => {
    expect(stationMeetsKindFilter(false, "any")).toBe(true);
    expect(stationMeetsKindFilter(true, "space")).toBe(false);
    expect(stationMeetsKindFilter(true, "ground")).toBe(true);
    expect(stationMeetsKindFilter(false, "ground")).toBe(false);
  });
});

describe("filter parsers", () => {
  it("migrates largePadOnly to min landing pad L", () => {
    expect(parseMinLandingPad(undefined, true)).toBe("L");
    expect(parseMinLandingPad("M", true)).toBe("M");
    expect(parseStationKindFilter("ground")).toBe("ground");
    expect(parseStationKindFilter("nope")).toBe("any");
  });
});
