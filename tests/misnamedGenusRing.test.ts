/**
 * The run's sample ring when the game names the genus after a species (owner, 2026-11-04: "the BIG circle around a
 * log/sample of a plant ... is still not visible"): his journals say `Genus_Localised: "Luteolum Anemone"` for every
 * Anemone and "Roseum Sinuous Tubers" for every Tubers, which matched no genus, so the run's distance was 0 m and no
 * ring was drawn.
 */
import { describe, expect, it } from "vitest";
import { buildExoMinimapDto, ingestExoOrganicJournalLine } from "../src/server/exoOrganicTracker.js";
import { GameStateStore } from "../src/server/gameState.js";
import { getCachedSpeciesDatabase, loadSpeciesDatabase } from "../src/server/snapshot.js";

const fix = {
  latDeg: -43.9578,
  lonDeg: 124.65986,
  planetRadiusM: 6_765_988,
  bodyName: "Eembaids YF-O e6-6618 C 4",
  headingDeg: 0,
  temperatureK: null,
  gravityG: null,
};

// The lines as his journal has them (2026-11-04).
const anemone = {
  timestamp: "2026-11-04T18:46:40Z",
  event: "ScanOrganic",
  ScanType: "Log",
  Genus: "$Codex_Ent_Sphere_Name;",
  Genus_Localised: "Luteolum Anemone",
  Species: "$Codex_Ent_SphereEFGH_01_Name;",
  Species_Localised: "Rubeum Bioluminescent Anemone",
  Variant: "$Codex_Ent_SphereEFGH_01_Name;",
  Variant_Localised: "Rubeum Bioluminescent Anemone",
  WasLogged: false,
  SystemAddress: 28425546918588,
  Body: 9,
};
const tubers = {
  ...anemone,
  Genus: "$Codex_Ent_Tube_Name;",
  Genus_Localised: "Roseum Sinuous Tubers",
  Species: "$Codex_Ent_TubeABCD_01_Name;",
  Species_Localised: "Prasinum Sinuous Tubers",
  Variant: "$Codex_Ent_TubeABCD_01_Name;",
  Variant_Localised: "Prasinum Sinuous Tubers",
};

describe("a genus the game names after a species", () => {
  for (const [name, line] of [
    ["Anemone", anemone],
    ["Sinuous Tubers", tubers],
  ] as const) {
    it(`${name}: the run takes its species' sample distance, and the radar rings the sample with it`, () => {
      loadSpeciesDatabase();
      const store = new GameStateStore();
      store.exoOrganicLastFix = fix as never;
      ingestExoOrganicJournalLine(store as never, line as never, fix as never, process.cwd(), getCachedSpeciesDatabase());
      expect(store.exoOrganicTracker?.minSampleDistanceM).toBe(100);
      const mm = buildExoMinimapDto(store as never, "28425546918588:9", store.exoOrganicTracker!.minSampleDistanceM)!;
      const sample = mm.marks.find((m) => m.kind === "sample" && m.active);
      expect(sample?.ringM).toBe(100);
    });
  }
});
