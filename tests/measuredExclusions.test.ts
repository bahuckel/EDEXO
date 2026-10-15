/**
 * Measured exclusions (plan-15102026-1.2.18 Part 3b): places a species never grows although its rate says it should.
 * Every condition of a rule must hold; a value the body lacks never matches; a match demotes, never removes.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanetScan, SpeciesDatabase, SpeciesEntry, SpeciesMatchContext } from "../src/shared/types.js";
import {
  describeExclusion,
  measuredExclusion,
  setMeasuredExclusionsRootForTests,
} from "../src/server/measuredExclusions.js";
import { setColourStarNeverRootForTests } from "../src/server/colourStarNever.js";
import { setHostStarObservationsRootForTests } from "../src/server/speciesHostStarObservations.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-exclusions-"));
  mkdirSync(path.join(root, "data", "exomastery"), { recursive: true });
  writeFileSync(
    path.join(root, "data", "exomastery", "measured-exclusions.json"),
    JSON.stringify({
      formatVersion: 1,
      species: {
        frutexa_frutexa_acus: [
          {
            when: [
              { value: "host", op: "=", is: "K" },
              { value: "main", op: "=", is: "K" },
            ],
            speciesBodies: 10242,
            expected: 400.2,
          },
          { when: [{ value: "region", op: "=", is: "Hawking's Gap" }], speciesBodies: 10242, expected: 120 },
        ],
        concha_concha_aureolas: [
          { when: [{ value: "sma_ls", op: ">=", is: 19.945804 }], speciesBodies: 2367, expected: 300 },
        ],
      },
    }),
  );
  setMeasuredExclusionsRootForTests(root);
  setColourStarNeverRootForTests(root);
  setHostStarObservationsRootForTests(root);
});

afterEach(() => {
  setMeasuredExclusionsRootForTests(null);
  setColourStarNeverRootForTests(null);
  setHostStarObservationsRootForTests(null);
  rmSync(root, { recursive: true, force: true });
});

describe("measuredExclusion", () => {
  it("needs every condition of a rule", () => {
    expect(measuredExclusion("frutexa_frutexa_acus", { host: "K", main: "K" })?.expected).toBe(400.2);
    expect(measuredExclusion("frutexa_frutexa_acus", { host: "K", main: "G" })).toBeNull();
    expect(measuredExclusion("frutexa_frutexa_acus", { region: "Hawking's Gap" })?.expected).toBe(120);
  });

  it("never matches on a value the body lacks, or a species without rules", () => {
    expect(measuredExclusion("frutexa_frutexa_acus", { host: "K" })).toBeNull();
    expect(measuredExclusion("concha_concha_aureolas", {})).toBeNull();
    expect(measuredExclusion("concha_concha_aureolas", { sma_ls: 25 })).not.toBeNull();
    expect(measuredExclusion("concha_concha_aureolas", { sma_ls: 10 })).toBeNull();
    expect(measuredExclusion("tussock_tussock_ignis", { host: "K", main: "K" })).toBeNull();
  });

  it("says the rule in words", () => {
    expect(describeExclusion(measuredExclusion("frutexa_frutexa_acus", { host: "K", main: "K" })!)).toBe(
      "parent star K and main star K",
    );
    expect(describeExclusion(measuredExclusion("concha_concha_aureolas", { sma_ls: 25 })!)).toBe("orbit ≥ 19.95 ls");
  });
});

describe("in the matcher", () => {
  const entry = {
    id: "concha_concha_aureolas",
    displayName: "Concha aureolas",
    genus: "Concha",
    genusDataDir: "concha",
    criteria: { planetClassAnyOf: ["Rocky body"], landable: true },
  } as unknown as SpeciesEntry;
  const db = { species: [entry] } as SpeciesDatabase;
  const ctx = {} as SpeciesMatchContext;

  it("demotes a body on a wide orbit (semi-major axis read in light-seconds), keeps a close one", () => {
    const wide = { PlanetClass: "Rocky body", Landable: true, SemiMajorAxis: 25 * 299_792_458 } as unknown as PlanetScan;
    const a = matchDatabaseToScan(db, wide, null, null, { includeBacterium: true, matchContext: ctx });
    expect(shownSpeciesMatches(a.matches)).toHaveLength(0);
    expect(a.matches[0]!.unlikelyReasons?.[0]?.field).toBe("Never found here");
    expect(a.matches[0]!.unlikelyReasons?.[0]?.detail).toMatch(/none of its 2,367 bodies/);

    const close = { PlanetClass: "Rocky body", Landable: true, SemiMajorAxis: 5 * 299_792_458 } as unknown as PlanetScan;
    const b = matchDatabaseToScan(db, close, null, null, { includeBacterium: true, matchContext: ctx });
    expect(shownSpeciesMatches(b.matches)).toHaveLength(1);
  });
});
