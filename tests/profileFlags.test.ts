/**
 * Profile flags. `observedEnvelope: false` (no observed-temperature envelope) was set on the 1.2.20 EDDN-year profiles
 * and dropped in the 1.4.0 rebuild on every sighting (below); `siteOnly` profiles are for the species guide's charts
 * only (Sinuous Tubers Blatteum's moved a confirmed find on hold-out D under the 1 % floor).
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { hasExomasteryProfileFile } from "../src/server/exomasteryProfile.js";
import { getProjectRoot } from "../src/server/paths.js";

const db = loadSpeciesDatabase();
const entry = (id: string) => db.species.find((e) => e.id === id)!;

describe("profile flags", () => {
  /*
    1.2.20 kept EDDN-year profiles out of the envelope: their min / max was where a species was seen in one year, and
    Roseum Anemone's 219 K floor demoted a confirmed find at 202.9 K. The 1.4.0 profiles are built from every sighting
    with outliers cleaned, so they set it again — and Roseum's floor is now 201.97 K, under that find.
  */
  it("a 1.4.0 profile sets the temperature envelope, and Roseum's covers the 202.9 K find", () => {
    const roseum = entry("anemone_roseum");
    expect(hasExomasteryProfileFile(getProjectRoot(), roseum)).toBe(true);
    expect(roseum.observedTemperatureK).toBeDefined();
    expect(roseum.observedTemperatureK!.min).toBeLessThanOrEqual(202.9);
  });

  it("a site-only profile is no profile to the app", () => {
    expect(hasExomasteryProfileFile(getProjectRoot(), entry("sinuous_tuber_sinuous_tubers_blatteum"))).toBe(false);
    expect(entry("sinuous_tuber_sinuous_tubers_blatteum").observedTemperatureK).toBeUndefined();
  });
});
