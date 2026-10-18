/**
 * The 1.2.20 profiles built from a year of EDDN bodies (scripts/build-dss-profiles.ts --species): no observed-
 * temperature envelope from them (`observedEnvelope: false` — their min / max is where the species was seen in a year,
 * and Roseum Anemone's 219 K floor demoted a confirmed find at 202.9 K), and `siteOnly` profiles are for the species
 * guide's charts only (Sinuous Tubers Blatteum's moved a confirmed find on hold-out D under the 1 % floor).
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { hasExomasteryProfileFile } from "../src/server/exomasteryProfile.js";
import { getProjectRoot } from "../src/server/paths.js";

const db = loadSpeciesDatabase();
const entry = (id: string) => db.species.find((e) => e.id === id)!;

describe("profile flags", () => {
  it("an EDDN-year profile is scored but sets no temperature envelope", () => {
    const roseum = entry("anemone_roseum");
    expect(hasExomasteryProfileFile(getProjectRoot(), roseum)).toBe(true);
    expect(roseum.observedTemperatureK).toBeUndefined();
    expect(entry("brain_trees_brain_tree_puniceum").observedTemperatureK).toBeUndefined();
  });

  it("a site-only profile is no profile to the app", () => {
    expect(hasExomasteryProfileFile(getProjectRoot(), entry("sinuous_tuber_sinuous_tubers_blatteum"))).toBe(false);
    expect(entry("sinuous_tuber_sinuous_tubers_blatteum").observedTemperatureK).toBeUndefined();
  });
});
