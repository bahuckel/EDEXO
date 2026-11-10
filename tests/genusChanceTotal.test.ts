/**
 * One species of a genus per body, so a genus's shown chances add up to at most 100 %, before a DSS too (review
 * 2026-11-10 A6, T15): the signal multiplier gave a capped genus signals × its share, and Tussock read 174.7 % on a
 * 7-signal rocky ammonia body. The floors still judge the numbers they were measured on; only the shown ones scale.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { getProjectRoot } from "../src/server/paths.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { rankCandidates } from "../src/server/candidatePipeline.js";
import type { BodyExoState, PlanetScan, SpeciesDatabase, SpeciesMatch, SpeciesMatchContext } from "../src/shared/types.js";

const root = getProjectRoot();
const db = loadSpeciesDatabase() as unknown as SpeciesDatabase;
const store = {
  systemPositions: new Map(),
  remoteSystems: new Map(),
  explorationScansRevision: 0,
  soldScansInSystem: () => [],
  liveScansInSystem: () => [],
} as never;

// The journal Scan of Col 359 Sector FH-L d8-1 2 (tests/matchSpecies.test.ts), and the review's two variants of it.
const HMC = {
  BodyName: "Col 359 Sector FH-L d8-1 2",
  BodyID: 2,
  StarSystem: "Col 359 Sector FH-L d8-1",
  SystemAddress: 44753242555,
  PlanetClass: "High metal content body",
  Atmosphere: "thin carbon dioxide atmosphere",
  AtmosphereType: "CarbonDioxide",
  atmosphereComposition: [
    { Name: "CarbonDioxide", Percent: 66.017136 },
    { Name: "SulphurDioxide", Percent: 33.98288 },
  ],
  Volcanism: "",
  MassEM: 0.048198,
  radius: 2355967.25,
  SurfaceGravity: 3.460993,
  SurfaceTemperature: 163.069,
  SurfacePressure: 505.189514,
  Landable: true,
  SemiMajorAxis: 380207663774.49036,
  distanceFromArrivalLs: 1268.2,
} as unknown as PlanetScan;
const ROCKY = {
  ...HMC,
  BodyName: "rocky",
  PlanetClass: "Rocky body",
  AtmosphereType: "Ammonia",
  Atmosphere: "thin ammonia atmosphere",
  atmosphereComposition: [{ Name: "Ammonia", Percent: 100 }],
  SurfaceTemperature: 170,
  SurfaceGravity: 1.2,
  SurfacePressure: 150,
  MassEM: 0.004,
  radius: 1100000,
} as unknown as PlanetScan;
const ctx = {
  parentStarType: "K",
  systemMainStarClass: "K",
  hostStarClasses: ["K"],
  distanceFromArrivalLs: 1268.2,
  orbitsAStar: true,
  parentKind: "Star",
  systemBodyListComplete: true,
} as unknown as SpeciesMatchContext;

function genusTotals(scan: PlanetScan, signals: number): Map<string, number> {
  const b = {
    key: "k",
    bodyName: scan.BodyName,
    bodyId: scan.BodyID,
    systemAddress: scan.SystemAddress,
    starSystem: scan.StarSystem,
    biologicalSignals: signals,
    genusHints: null,
    dssComplete: false,
    scan,
    organicGenusLocks: [],
    confirmedVariants: [],
    updatedAt: "",
  } as unknown as BodyExoState;
  const c = { ...ctx, surfacePressureAtm: (scan.SurfacePressure ?? 0) / 101325 } as SpeciesMatchContext;
  const matches = matchDatabaseToScan(db, scan, null, [], { includeBacterium: true, matchContext: c, biologicalSignals: signals })
    .matches as SpeciesMatch[];
  rankCandidates(matches, b, { scan, rec: null, ctx: c, journalHost: null }, store, db, root);
  const totals = new Map<string, number>();
  for (const m of matches) {
    if (m.unlikely || typeof m.presenceProbabilityPercent !== "number") continue;
    totals.set(m.entry.genus, (totals.get(m.entry.genus) ?? 0) + m.presenceProbabilityPercent);
  }
  return totals;
}

describe("a genus's chance before a DSS", () => {
  it("adds up to at most 100 % over its species, at every signal count", () => {
    for (const [scan, counts] of [
      [HMC, [1, 2, 3, 4, 5, 6]],
      [ROCKY, [3, 5, 7]],
    ] as const) {
      for (const n of counts) {
        const over = [...genusTotals(scan, n)].filter(([, t]) => t > 100.5);
        expect([scan.BodyName, n, over]).toEqual([scan.BodyName, n, []]);
      }
    }
  });
});
