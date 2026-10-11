/**
 * Every atmosphere keyer gives one key per gas whichever source spelled it (plan 1.1, 2026-10-11): the
 * journal's AtmosphereType beside EDSM's and the Spansh dump's spellings, including the dump's "Hot
 * Water" (no thin/thick) and the American "Sulfur" an EDDN export once wrote. A row that splits is the
 * B4/B5 kind of bug: a looked-up body misses the table row a journal body finds.
 * Same matrix as docs/perf/atmo-key-audit.mts.
 */
import { describe, expect, it } from "vitest";
import { bodyTypeAtmosphere } from "../src/shared/bodyTypeKey.js";
import { atmosphereKey } from "../src/server/genusBodySplit.js";
import { atmosphereObservationKey } from "../src/server/speciesAtmosphereObservations.js";
import { atmosphereCompositionKey, atmosphereTypeKeyOf, normalizeScanAtmosphereForMatch } from "../src/shared/scanAtmosphereMatch.js";
import { atmosphereTypeFromDump } from "../src/server/galaxyBodyScan.js";
import type { PlanetScan } from "../src/shared/types.js";

const PAIRS: [string, string[]][] = [
  ["CarbonDioxide", ["Thin Carbon dioxide", "Hot thin Carbon dioxide", "Carbon dioxide", "Thick Carbon dioxide", "Hot thick Carbon dioxide"]],
  ["CarbonDioxideRich", ["Thin Carbon dioxide-rich", "Hot thin Carbon dioxide-rich"]],
  ["SulphurDioxide", ["Thin Sulphur dioxide", "Hot thin Sulphur dioxide", "Thin Sulfur dioxide"]],
  ["Neon", ["Thin Neon"]],
  ["NeonRich", ["Thin Neon-rich", "Thin Neon Rich"]],
  ["Argon", ["Thin Argon"]],
  ["ArgonRich", ["Thin Argon-rich"]],
  ["Methane", ["Thin Methane", "Hot thin Methane"]],
  ["MethaneRich", ["Thin Methane-rich", "Thick Methane-rich"]],
  ["Water", ["Thin Water", "Hot thin Water", "Thick Water", "Hot Water"]],
  ["SilicateVapour", ["Hot thin Silicate vapour", "Silicate vapour"]],
  ["WaterRich", ["Thin Water-rich"]],
  ["Ammonia", ["Thin Ammonia", "Hot thin Ammonia"]],
  ["Nitrogen", ["Thin Nitrogen"]],
  ["Oxygen", ["Thin Oxygen"]],
  ["Helium", ["Thin Helium"]],
  ["", ["No atmosphere", "None"]],
];
const scan = (t: string) => ({ AtmosphereType: t }) as unknown as PlanetScan;
const KEYERS: [string, (t: string) => string][] = [
  ["bodyTypeAtmosphere", (t) => bodyTypeAtmosphere(t)],
  ["genus prior atmosphereKey", (t) => atmosphereKey(t)],
  ["atmosphereObservationKey", (t) => atmosphereObservationKey(t)],
  ["atmosphereTypeKeyOf", (t) => atmosphereTypeKeyOf(scan(t))],
  ["atmosphereCompositionKey", (t) => atmosphereCompositionKey(normalizeScanAtmosphereForMatch(scan(t)))],
  ["galaxy dump -> atmosphereTypeKeyOf", (t) => atmosphereTypeKeyOf(scan(atmosphereTypeFromDump(t) ?? ""))],
];

describe("atmosphere keys across sources", () => {
  for (const [name, key] of KEYERS) {
    it(`${name}: the journal's spelling and the others' give one key`, () => {
      for (const [journal, others] of PAIRS) {
        for (const other of others) expect([other, key(other)]).toEqual([other, key(journal)]);
      }
    });
  }
  it("keeps -rich apart where the tables tell them apart", () => {
    expect(atmosphereTypeKeyOf(scan("NeonRich"))).not.toBe(atmosphereTypeKeyOf(scan("Neon")));
    expect(atmosphereKey("Thin Neon-rich")).not.toBe(atmosphereKey("Thin Neon"));
  });
});
