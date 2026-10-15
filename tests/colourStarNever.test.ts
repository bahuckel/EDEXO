/**
 * Colour-star classes a species is never confirmed under (plan-15102026-1.2.18 Part 1): the table is read by class
 * key whatever the star's spelling, and a listed class demotes the row into the unlikely tier — the brightest star in
 * the body's sky decides, not the star it orbits.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanetScan, SpeciesDatabase, SpeciesEntry, SpeciesMatchContext } from "../src/shared/types.js";
import { colourStarNever, setColourStarNeverRootForTests } from "../src/server/colourStarNever.js";
import { setHostStarObservationsRootForTests } from "../src/server/speciesHostStarObservations.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-colourstar-"));
  mkdirSync(path.join(root, "data", "exomastery"), { recursive: true });
  writeFileSync(
    path.join(root, "data", "exomastery", "colour-star-never.json"),
    JSON.stringify({
      formatVersion: 1,
      minExpected: 20,
      species: { stratum_stratum_paleas: { G: { expected: 3663.3, speciesBodies: 17590 } } },
    }),
  );
  setColourStarNeverRootForTests(root);
  setHostStarObservationsRootForTests(root);
});

afterEach(() => {
  setColourStarNeverRootForTests(null);
  setHostStarObservationsRootForTests(null);
  rmSync(root, { recursive: true, force: true });
});

describe("colourStarNever", () => {
  it("answers by class key, journal code or Spansh label alike", () => {
    expect(colourStarNever("stratum_stratum_paleas", "G")?.expected).toBe(3663.3);
    expect(colourStarNever("stratum_stratum_paleas", "G (White-Yellow) Star")?.cls).toBe("G");
    expect(colourStarNever("stratum_stratum_paleas", "K")).toBeNull();
    expect(colourStarNever("stratum_stratum_paleas", null)).toBeNull();
    expect(colourStarNever("tussock_tussock_ignis", "G")).toBeNull();
  });

  it("demotes the row under a listed colour star, and only there", () => {
    const entry = {
      id: "stratum_stratum_paleas",
      displayName: "Stratum paleas",
      genus: "Stratum",
      genusDataDir: "stratum",
      criteria: { planetClassAnyOf: ["Rocky body"], landable: true },
    } as unknown as SpeciesEntry;
    const db = { species: [entry] } as SpeciesDatabase;
    const scan = { PlanetClass: "Rocky body", Landable: true } as unknown as PlanetScan;
    // The body orbits a K dwarf, but a G star is the brightest in its sky: the colour star decides.
    const underG = { parentStarType: "K", colourStarType: "G" } as SpeciesMatchContext;
    const a = matchDatabaseToScan(db, scan, null, null, { includeBacterium: true, matchContext: underG });
    expect(shownSpeciesMatches(a.matches)).toHaveLength(0);
    expect(a.matches[0]!.unlikelyReasons?.[0]?.field).toBe("StarType");
    expect(a.matches[0]!.unlikelyReasons?.[0]?.detail).toMatch(/brightest in this body's sky/);

    const underK = { parentStarType: "G", colourStarType: "K" } as SpeciesMatchContext;
    const b = matchDatabaseToScan(db, scan, null, null, { includeBacterium: true, matchContext: underK });
    expect(shownSpeciesMatches(b.matches)).toHaveLength(1);
  });
});
