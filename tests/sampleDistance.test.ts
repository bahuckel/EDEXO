/**
 * One sample-distance function (review P16, owner 2026-11-05): the genus by the game's name for it, else the genus of
 * the species named, for the genera the game names after a species ("Luteolum Anemone"); read from the database,
 * not the genus file again.
 */
import { describe, expect, it } from "vitest";
import { sampleDistanceM } from "../src/server/speciesTreeLoader.js";
import { getCachedSpeciesDatabase, loadSpeciesDatabase } from "../src/server/snapshot.js";

describe("sampleDistanceM", () => {
  loadSpeciesDatabase();
  const species = getCachedSpeciesDatabase().species;
  const of = (genus: string) => species.find((e) => e.genus.toLowerCase() === genus.toLowerCase())!.genusMinSampleDistanceM;

  it("takes the genus by the game's name for it", () => {
    expect(sampleDistanceM(species, "Stratum")).toBe(of("Stratum"));
    expect(sampleDistanceM(species, " bacterium ")).toBe(of("Bacterium"));
    expect(of("Stratum")).toBeGreaterThan(0);
  });

  it("falls back to the species' genus for a genus the game names after a species", () => {
    const anemone = species.find((e) => /anemone/i.test(e.genus))!;
    expect(sampleDistanceM(species, "Luteolum Anemone", "Luteolum Anemone")).toBe(anemone.genusMinSampleDistanceM);
    expect(anemone.genusMinSampleDistanceM).toBeGreaterThan(0);
  });

  it("is 0 when neither is known", () => {
    expect(sampleDistanceM(species, "Nothing", "Nothing At All")).toBe(0);
    expect(sampleDistanceM(species, "")).toBe(0);
  });

  it("gives every genus of the database its distance", () => {
    for (const g of new Set(species.map((e) => e.genus))) {
      const want = species.find((e) => e.genus === g && (e.genusMinSampleDistanceM ?? 0) > 0)?.genusMinSampleDistanceM ?? 0;
      expect(sampleDistanceM(species, g)).toBe(want);
    }
  });
});
