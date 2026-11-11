/**
 * Genus evidence carries who named the genera (review 2026-11-10 Phase 3, after A1-A3): a body's own DSS, Spansh's
 * copy of it and a sample filter the candidates; a twin moon's DSS never does.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { filteringGenera, ownGenusEvidence, sampleGenusEvidence } from "../src/shared/genusEvidence.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { getProjectRoot } from "../src/server/paths.js";
import type { GenusHint, PlanetScan, SpeciesDatabase } from "../src/shared/types.js";

const STRATUM: GenusHint = { Genus: "$Codex_Ent_Stratum_Genus_Name;", Genus_Localised: "Stratum" };

describe("genus evidence", () => {
  it("filters on a body's own DSS, Spansh's copy of one and a sample, never on a twin moon's DSS", () => {
    expect(filteringGenera({ source: "own-dss", genera: [STRATUM] })).toEqual([STRATUM]);
    expect(filteringGenera({ source: "spansh", genera: [STRATUM] })).toEqual([STRATUM]);
    expect(filteringGenera(sampleGenusEvidence(STRATUM))).toEqual([STRATUM]);
    expect(filteringGenera({ source: "sibling-dss", genera: [STRATUM] })).toBeNull();
    expect(filteringGenera(null)).toBeNull();
  });

  it("is a body's own list, marked Spansh's on a remote body; none before a DSS", () => {
    expect(ownGenusEvidence({ genusHints: [STRATUM] })).toEqual({ source: "own-dss", genera: [STRATUM] });
    expect(ownGenusEvidence({ genusHints: [STRATUM], remote: { source: "spansh", fetchedAt: "" } })?.source).toBe("spansh");
    expect(ownGenusEvidence({ genusHints: null })).toBeNull();
  });

  describe("in the matcher", () => {
    let db: SpeciesDatabase;
    beforeAll(() => {
      db = loadSpeciesDatabaseFromTree(getProjectRoot());
    });
    // A thin CO2 rocky body many genera grow on.
    const scan = {
      PlanetClass: "Rocky body",
      AtmosphereType: "CarbonDioxide",
      Atmosphere: "thin carbon dioxide atmosphere",
      SurfaceTemperature: 175,
      SurfaceGravity: 0.6 * 9.80665,
      SurfacePressure: 1500,
      Landable: true,
    } as unknown as PlanetScan;
    const genera = (ev: Parameters<typeof matchDatabaseToScan>[2]) =>
      new Set(matchDatabaseToScan(db, scan, ev, null, { includeBacterium: true }).matches.map((m) => m.entry.genusDataDir));

    it("lists the same genera with a twin's DSS as with none, and only Stratum with the body's own", () => {
      const none = genera(null);
      expect(none.size).toBeGreaterThan(1);
      expect(genera({ source: "sibling-dss", genera: [STRATUM] })).toEqual(none);
      expect([...genera({ source: "own-dss", genera: [STRATUM] })]).toEqual(["stratum"]);
    });
  });
});
