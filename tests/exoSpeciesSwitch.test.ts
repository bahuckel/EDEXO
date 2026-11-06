/**
 * Sampling another genus destroys the sample in progress (owner, 2026-11-06: "to sample a new genus, the old sample is
 * destroyed, so you start over"); going back to the first species, the game writes its `Log` again: sample one. CMDR
 * Nimblor's report: "sample bacterium then stratum and then bacterium again, it then thinks im still sampling stratum
 * until i sample bacterium the third time and then it thinks its the first sample not the second". The tracker only
 * switched species on a line with a position: a `Log` that landed while Status.json was being rewritten (no fix) was
 * dropped, species switch and all. A line without a position still switches and counts; it only cannot be placed.
 */
import { describe, expect, it } from "vitest";
import { ingestExoOrganicJournalLine, restoreOrganicSessionFromJournal } from "../src/server/exoOrganicTracker.js";
import { getCachedSpeciesDatabase } from "../src/server/snapshot.js";

const BODY = "Smojai UJ-F b13-0 B 4";
const RADIUS_M = 5_246_376;
const fix = (latDeg: number) => ({
  latDeg,
  lonDeg: 32.5,
  planetRadiusM: RADIUS_M,
  bodyName: BODY,
  headingDeg: 62,
  temperatureK: null,
  gravityG: null,
});

function newStore() {
  return {
    exoOrganicTracker: null,
    exoOrganicLastFix: null,
    footSessionBodyKey: null,
    footSessionBodyNameNorm: null,
    footTravelOdometerEnabled: false,
    firstFootfallBodies: new Set<string>(),
    surfaceSampleMarks: [] as unknown[],
    explorationScans: new Map<string, { surfaceGravity?: number; radius?: number }>(),
    surfaceShipMark: null,
    addSurfaceSampleMark() {},
    beginFootTravelOdometerSession() {},
  } as never;
}

const SPECIES = {
  bacterium: ["Bacterium", "Bacterium Cerbrus"],
  stratum: ["Stratum", "Stratum Tectonicas"],
} as const;

function line(scanType: string, which: keyof typeof SPECIES, i: number) {
  const [genus, species] = SPECIES[which];
  return {
    event: "ScanOrganic",
    timestamp: `2026-11-06T10:${String(10 + i).padStart(2, "0")}:00Z`,
    ScanType: scanType,
    Genus_Localised: genus,
    Species_Localised: species,
    WasLogged: false,
    SystemAddress: 685719759473,
    Body: 22,
  } as never;
}

/** Steps of [scan type, species, whether Status.json had a position]; the overlay after the last one. */
function run(steps: [string, keyof typeof SPECIES, boolean][]) {
  const store = newStore();
  const db = getCachedSpeciesDatabase();
  steps.forEach(([type, which, withFix], i) => ingestExoOrganicJournalLine(store, line(type, which, i), withFix ? fix(-12.5 + i * 0.05) : null, process.cwd(), db));
  // The overlay's count (effectiveSampleCount): scans placed plus scans known and not placed, at most three.
  const t = (store as unknown as { exoOrganicTracker: { speciesDisplay: string; anchors: unknown[]; recoveredSamples?: number } | null })
    .exoOrganicTracker;
  return t ? { speciesDisplay: t.speciesDisplay, sampleCount: Math.min(3, (t.recoveredSamples ?? 0) + t.anchors.length) } : null;
}

describe("sampling another species starts over", () => {
  it("Stratum, Bacterium, Stratum, Stratum: Stratum at two, not three (owner's report)", () => {
    const o = run([
      ["Log", "stratum", true],
      ["Log", "bacterium", true],
      ["Log", "stratum", true],
      ["Sample", "stratum", true],
    ]);
    expect(o?.speciesDisplay.toLowerCase()).toContain("stratum");
    expect(o?.sampleCount).toBe(2);
  });

  it("the same with the switching scans landing between Status.json writes", () => {
    const o = run([
      ["Log", "stratum", true],
      ["Log", "bacterium", false],
      ["Log", "stratum", false],
      ["Sample", "stratum", true],
    ]);
    expect(o?.speciesDisplay.toLowerCase()).toContain("stratum");
    expect(o?.sampleCount).toBe(2);
  });

  it("Bacterium, Stratum, Bacterium again: Bacterium at once, its Sample the second (Nimblor's report)", () => {
    const steps: [string, keyof typeof SPECIES, boolean][] = [
      ["Log", "bacterium", true],
      ["Log", "stratum", true],
      ["Log", "bacterium", false],
    ];
    const afterLog = run(steps);
    expect(afterLog?.speciesDisplay.toLowerCase()).toContain("bacterium");
    expect(afterLog?.sampleCount).toBe(1);
    const afterSample = run([...steps, ["Sample", "bacterium", true]]);
    expect(afterSample?.speciesDisplay.toLowerCase()).toContain("bacterium");
    expect(afterSample?.sampleCount).toBe(2);
  });

  it("a Sample of the run in progress without a position still counts", () => {
    const o = run([
      ["Log", "bacterium", true],
      ["Sample", "bacterium", false],
    ]);
    expect(o?.sampleCount).toBe(2);
  });
});

/*
  The same sequences rebuilt from the journal, as at a start in the middle of a run (restoreOrganicSessionFromJournal):
  the count restarts at each change of species, so only the last species' scans since then count.
*/
describe("sampling another species starts over, rebuilt from the journal", () => {
  const restored = (steps: [string, keyof typeof SPECIES][]) => {
    const store = newStore();
    const lines = steps.map(([type, which], i) => line(type, which, i));
    restoreOrganicSessionFromJournal(store, lines, process.cwd(), getCachedSpeciesDatabase());
    const t = (store as unknown as { exoOrganicTracker: { speciesDisplay: string; anchors: unknown[]; recoveredSamples?: number } | null })
      .exoOrganicTracker;
    return t ? { species: t.speciesDisplay.toLowerCase(), count: Math.min(3, (t.recoveredSamples ?? 0) + t.anchors.length) } : null;
  };

  it("Stratum, Bacterium, Stratum, Stratum: Stratum at two", () => {
    expect(restored([["Log", "stratum"], ["Log", "bacterium"], ["Log", "stratum"], ["Sample", "stratum"]])).toMatchObject({ count: 2 });
    expect(restored([["Log", "stratum"], ["Log", "bacterium"], ["Log", "stratum"], ["Sample", "stratum"]])?.species).toContain("stratum");
  });

  it("Bacterium, Stratum, Bacterium, Bacterium: Bacterium at two", () => {
    const r = restored([["Log", "bacterium"], ["Log", "stratum"], ["Log", "bacterium"], ["Sample", "bacterium"]]);
    expect(r?.species).toContain("bacterium");
    expect(r?.count).toBe(2);
  });
});
