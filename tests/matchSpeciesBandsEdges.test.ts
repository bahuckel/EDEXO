/**
 * Mutations that survived the suite in matchSpeciesBands.ts (Stryker 2026-11-24, 65.0 %): the corpus check at a
 * temperature edge, the band builders and the body values the measured-exclusion rules read. Each case fails when
 * the named comparison, fallback or unit changes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/server/speciesTemperatureObservations.js", () => ({
  observedNearTemperature: vi.fn(() => 7),
}));

import { observedNearTemperature } from "../src/server/speciesTemperatureObservations.js";
import {
  exclusionValues,
  resolvePlanetTemperatureBand,
  sightingsBeyondEdge,
  speciesTempBand,
  tempBandsOverlap,
} from "../src/server/matchSpeciesBands.js";
import { hostStarClassKey } from "../src/shared/hostStarClass.js";
import { ATM_TO_PA, EARTH_G_MS2, LIGHT_SECOND_METERS } from "../src/shared/journalPhysics.js";
import type { PlanetScan, SpeciesCriterion, SpeciesEntry, SpeciesMatchContext } from "../src/shared/types.js";

const near = vi.mocked(observedNearTemperature);
const entry = { name: "Stratum Cucumisis" } as unknown as SpeciesEntry;
const NOTHING = { straddles: false, near: null };

const scan = (extra: Partial<PlanetScan> = {}): PlanetScan => ({
  BodyName: "Test 1 a",
  BodyID: 3,
  StarSystem: "Test",
  SystemAddress: 1,
  ...extra,
});

describe("the corpus check at a temperature edge", () => {
  beforeEach(() => {
    near.mockClear();
  });

  it("below the band: a bin ending at or under the edge answers alone", () => {
    expect(sightingsBeyondEdge(entry, { binLowK: 160, binHighK: 179 }, 175, 180, 200)).toEqual(NOTHING);
    expect(sightingsBeyondEdge(entry, { binLowK: 162, binHighK: 180 }, 175, 180, 200)).toEqual(NOTHING);
    expect(near).not.toHaveBeenCalled();
  });

  it("below the band: a bin straddling the edge asks the fine histogram below it", () => {
    expect(sightingsBeyondEdge(entry, { binLowK: 170, binHighK: 188 }, 175, 180, 200)).toEqual({ straddles: true, near: 7 });
    expect(near).toHaveBeenCalledExactlyOnceWith(entry, 175, { below: 180 });
  });

  it("above the band: a bin starting at or over the edge answers alone", () => {
    expect(sightingsBeyondEdge(entry, { binLowK: 201, binHighK: 219 }, 210, 180, 200)).toEqual(NOTHING);
    expect(sightingsBeyondEdge(entry, { binLowK: 200, binHighK: 218 }, 210, 180, 200)).toEqual(NOTHING);
    expect(near).not.toHaveBeenCalled();
  });

  it("above the band: a bin straddling the edge asks the fine histogram above it", () => {
    expect(sightingsBeyondEdge(entry, { binLowK: 192, binHighK: 210 }, 205, 180, 200)).toEqual({ straddles: true, near: 7 });
    expect(near).toHaveBeenCalledExactlyOnceWith(entry, 205, { above: 200 });
  });

  it("asks nothing on the edges themselves, inside the band or past an open side", () => {
    const wide = { binLowK: 100, binHighK: 300 };
    expect(sightingsBeyondEdge(entry, wide, 180, 180, 200)).toEqual(NOTHING);
    expect(sightingsBeyondEdge(entry, wide, 200, 180, 200)).toEqual(NOTHING);
    expect(sightingsBeyondEdge(entry, wide, 190, 180, 200)).toEqual(NOTHING);
    expect(sightingsBeyondEdge(entry, wide, 150, undefined, 200)).toEqual(NOTHING);
    expect(sightingsBeyondEdge(entry, wide, 250, 180, undefined)).toEqual(NOTHING);
    expect(near).not.toHaveBeenCalled();
  });
});

describe("the band builders", () => {
  const crit = (st: SpeciesCriterion["surfaceTemperatureK"]) => ({ surfaceTemperatureK: st }) as SpeciesCriterion;

  it("reads a band with one side open, and none without either side", () => {
    expect(speciesTempBand(crit({}))).toBeNull();
    expect(speciesTempBand(crit({ max: 190 }))).toEqual({ lo: -1e15, hi: 190 });
    expect(speciesTempBand(crit({ min: 300 }))).toEqual({ lo: 300, hi: 1e15 });
  });

  it("counts a planet band touching the species band's low edge as overlap", () => {
    expect(tempBandsOverlap({ minK: 150, maxK: 160 }, { lo: 160, hi: 190 })).toBe(true);
    expect(tempBandsOverlap({ minK: 150, maxK: 159.9 }, { lo: 160, hi: 190 })).toBe(false);
  });

  it("takes the estimate only without a measured temperature, and nothing without either", () => {
    const est = { tMin: 150, tMax: 260 };
    expect(resolvePlanetTemperatureBand(scan({ SurfaceTemperature: 180 }), est)).toEqual({ minK: 180, maxK: 180 });
    expect(resolvePlanetTemperatureBand(scan(), est)).toEqual({ minK: 150, maxK: 260 });
    expect(resolvePlanetTemperatureBand(scan(), null)).toBeNull();
  });
});

describe("the body values the measured-exclusion rules read", () => {
  it("converts every journal unit to the table's", () => {
    const ctx = {
      parentKind: "Star",
      parentStarType: "K",
      systemMainStarClass: "G",
      regionName: "Inner Orion Spur",
      distanceFromArrivalLs: 999,
    } as SpeciesMatchContext;
    const v = exclusionValues(
      scan({
        SurfaceTemperature: 180,
        MassEM: 0.05,
        SemiMajorAxis: LIGHT_SECOND_METERS * 300,
        OrbitalPeriod: -172_800,
        distanceFromArrivalLs: 420,
        SurfaceGravity: EARTH_G_MS2 * 0.25,
        SurfacePressure: ATM_TO_PA * 2,
        radius: 2_000_000,
        Eccentricity: 0.1,
        RotationPeriod: -259_200,
        composition: { Metal: 0.3, Rock: 0.6 } as unknown as PlanetScan["composition"],
      }),
      ctx,
    );
    expect(v).toEqual({
      temp: 180,
      mass: 0.05,
      parent: "Star",
      sma_ls: 300,
      orb_d: 2,
      dist_ls: 420,
      grav_g: 0.25,
      c_metal: 0.3,
      host: hostStarClassKey("K"),
      main: "G",
      region: "Inner Orion Spur",
      press_atm: 2,
      radius_km: 2000,
      ecc: 0.1,
      rot_d: 3,
      c_ice: undefined,
      c_rock: 0.6,
      gas: undefined,
      mat: undefined,
    });
    expect(v.host).toBeTruthy();
  });

  it("reads the lower-case composition keys and falls back to the context's distance", () => {
    const v = exclusionValues(
      scan({ composition: { metal: 0.2, rock: 0.5, ice: 0.3 } as unknown as PlanetScan["composition"] }),
      { distanceFromArrivalLs: 999 } as SpeciesMatchContext,
    );
    expect([v.c_metal, v.c_rock, v.c_ice, v.dist_ls]).toEqual([0.2, 0.5, 0.3, 999]);
    expect(v.host).toBeUndefined();
  });

  it("drops values that are not finite numbers", () => {
    const v = exclusionValues(
      scan({
        SurfaceTemperature: Number.NaN,
        MassEM: "5" as unknown as number,
        OrbitalPeriod: "86400" as unknown as number,
        RotationPeriod: "86400" as unknown as number,
        Eccentricity: Number.POSITIVE_INFINITY,
      }),
      undefined,
    );
    expect([v.temp, v.mass, v.orb_d, v.rot_d, v.ecc]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("keys gases and materials by name without spaces, keeps the larger share, skips unreadable rows", () => {
    const v = exclusionValues(
      scan({
        atmosphereComposition: [
          { Name: "Sulphur Dioxide", Percent: 60 },
          { name: "sulphurdioxide", percent: 70 },
          { Name: "Argon", Percent: 20 },
          { Name: "Argon", Percent: 10 },
          { Percent: 5 },
          { Name: "", Percent: 5 },
          { Name: "Neon", Percent: Number.NaN },
          { Name: "Helium" },
          null as unknown as { Name: string },
        ],
        materials: [{ Name: "Iron", Percent: 18.5 }],
      }),
      undefined,
    );
    expect(v.gas).toEqual({ gas_sulphurdioxide: 70, gas_argon: 20 });
    expect(v.mat).toEqual({ mat_iron: 18.5 });
  });

  it("builds the shares of one scan array once", () => {
    const rows = [{ Name: "Argon", Percent: 20 }];
    const s = scan({ atmosphereComposition: rows });
    expect(exclusionValues(s, undefined).gas).toEqual({ gas_argon: 20 });
    rows[0]!.Percent = 40;
    expect(exclusionValues(s, undefined).gas).toEqual({ gas_argon: 20 });
    expect(exclusionValues(scan({ atmosphereComposition: [] }), undefined).gas).toBeUndefined();
  });
});
