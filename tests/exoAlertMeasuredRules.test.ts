/**
 * A confirmed species is reported against the codex lists only, never against a rule measured on a year of finds
 * (owner, 2026-10-18: HIP 64848 1 a / 1 b carry Stratum laminamus under a G colour star — never seen in the EDDN year,
 * so it reads unlikely before a DSS — and the app shows it once a DSS names Stratum, yet each body raised "Confirmed
 * here, listed only as unlikely" with "the codex list is wrong, widen that line").
 */
import { describe, expect, it } from "vitest";
import type { BodyExoState, PlanetScan, SpeciesMatch } from "../src/shared/types.js";
import { computeExoDataAlertsForBody } from "../src/server/exoDataConsistencyAlerts.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";

const scan = {
  BodyName: "HIP 64848 1 a",
  BodyID: 11,
  PlanetClass: "Rocky body",
  Atmosphere: "Thin Ammonia",
  AtmosphereType: "Ammonia",
  AtmosphereComposition: [{ Name: "Ammonia", Percent: 100 }],
  Volcanism: "",
  SurfaceGravity: 1.3619,
  SurfaceTemperature: 167.71,
  SurfacePressure: 120.27,
  Landable: true,
  MassEM: 0.004717,
  Radius: 1174871.6,
  SemiMajorAxis: 1843842.03,
  Parents: [{ Planet: 8 }, { Null: 7 }, { Star: 0 }],
} as unknown as PlanetScan;
// The body orbits a Y dwarf in a planet slot; the G star is the brightest in its sky.
const ctx = { parentStarType: "Y", systemMainStarClass: "G", hostStarClasses: ["G"], colourStarType: "G", colourCandidateStarTypes: ["Y"] };

function alertsFor(s: PlanetScan) {
  const db = loadSpeciesDatabase();
  const laminamus = db.species.find((e) => e.id === "stratum_stratum_laminamus")!;
  const body = {
    key: "594592958827:11",
    biologicalSignals: 6,
    genusHints: [],
    organicGenusLocks: [{ genusLocalised: "Stratum", speciesLocalised: "Stratum Laminamus", variantLocalised: "", source: "spansh" }],
  } as unknown as BodyExoState;
  return computeExoDataAlertsForBody({
    body,
    mergedScan: s,
    matches: [{ entry: laminamus, reasons: [] } as unknown as SpeciesMatch],
    speciesMatchCtx: ctx,
    db,
    includeBacterium: true,
  }).alerts.filter((a) => a.speciesEntryId === laminamus.id);
}

describe("confirmed-species alerts and the measured rules", () => {
  it("no alert when only the colour-star rule (a measured rule) disagrees", () => {
    expect(alertsFor(scan)).toEqual([]);
  });

  it("still reports a codex list the find falls outside, without the measured rule in it", () => {
    const co2 = { ...scan, Atmosphere: "thin carbon dioxide atmosphere", AtmosphereType: "CarbonDioxide", AtmosphereComposition: [{ Name: "CarbonDioxide", Percent: 100 }] } as unknown as PlanetScan;
    const [a, ...rest] = alertsFor(co2);
    expect(rest).toEqual([]);
    expect(a?.title).toContain("Confirmed here, listed only as unlikely");
    expect(a?.detail).toContain("Ammonia");
    expect(a?.detail).not.toContain("Colour star");
  });
});
