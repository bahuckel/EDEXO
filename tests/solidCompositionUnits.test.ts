/**
 * EDSM and Spansh send a body's solid composition in per cent; the journal's `Composition`, which every reader
 * expects, is a 0-1 fraction (review 2026-11-10 A4). Stored as sent, a 6 % ice body read as 600 %: measured
 * exclusions fired on it ("ice content ≥ 38 %" hid Bacterium cerbrus) and the split tables binned it last.
 */
import { describe, expect, it } from "vitest";
import { mapEdsmBodyToExplorationRecord, solidCompositionAsFractions } from "../src/server/edsmSystemHydration.js";
import { planetScanFromExplorationRecord } from "../src/server/footScannedCatalog.js";
import { exclusionValues } from "../src/server/matchSpeciesBands.js";
import type { PlanetScan } from "../src/shared/types.js";

describe("a looked-up body's solid composition", () => {
  it("is stored as the journal's fractions", () => {
    const rec = mapEdsmBodyToExplorationRecord(
      {
        id64: 1,
        bodyId: 3,
        name: "Test 1 a",
        type: "Planet",
        subType: "Rocky body",
        solidComposition: { Ice: 6, Rock: 62.7, Metal: 31.3 },
      },
      1,
      "Test",
    );
    expect(rec?.composition).toEqual({ Ice: 0.06, Rock: 0.627, Metal: 0.313 });
    expect(solidCompositionAsFractions({})).toBeNull();
    expect(solidCompositionAsFractions([1, 2])).toBeNull();
  });

  it("gives the matcher the same values as the same body's journal scan", () => {
    const rec = mapEdsmBodyToExplorationRecord(
      {
        id64: 1,
        bodyId: 3,
        name: "Test 1 a",
        type: "Planet",
        subType: "Rocky body",
        isLandable: true,
        surfaceTemperature: 180,
        gravity: 0.1,
        solidComposition: { Ice: 6, Rock: 62.7, Metal: 31.3 },
      },
      1,
      "Test",
    )!;
    const hydrated = planetScanFromExplorationRecord(rec)!;
    const journal: PlanetScan = { ...hydrated, composition: { Ice: 0.06, Rock: 0.627, Metal: 0.313 } };
    const pick = (s: PlanetScan) => {
      const v = exclusionValues(s, undefined) as unknown as Record<string, number | null>;
      return { c_ice: v.c_ice, c_rock: v.c_rock, c_metal: v.c_metal };
    };
    expect(pick(hydrated)).toEqual(pick(journal));
    expect(pick(hydrated).c_ice).toBeCloseTo(0.06, 6);
  });
});
