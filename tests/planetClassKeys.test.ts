/**
 * Every planet-class keyer gives one key per class whichever source spelled it (plan 1.1, 2026-10-11):
 * the journal's PlanetClass beside EDSM's and the Spansh dump's subType. Same matrix as
 * docs/perf/class-key-audit.mts. The landable classes keep the keys the shipped tables were built with.
 */
import { describe, expect, it } from "vitest";
import { bodyTypePlanetClass } from "../src/shared/bodyTypeKey.js";
import { planetClassKey } from "../src/shared/planetClassKey.js";
import { planetClassId } from "../src/shared/normalise/planetClass.js";
import { journalPlanetClass } from "../src/shared/spanshPlanetClass.js";
import { planetClassFromDump } from "../src/server/galaxyBodyScan.js";
import { bodyFacts } from "../src/server/genusBodySplit.js";
import { planetClassIndex } from "../src/shared/galaxyTraits.js";
import type { PlanetScan } from "../src/shared/types.js";

const PAIRS: [string, string[]][] = [
  ["High metal content body", ["High metal content world", "High Metal Content Body"]],
  ["Rocky body", ["Rocky Body"]],
  ["Icy body", ["Icy body"]],
  ["Rocky ice body", ["Rocky Ice world", "Rocky ice world"]],
  ["Metal rich body", ["Metal-rich body"]],
  ["Earthlike body", ["Earth-like world", "Earthlike world"]],
  ["Water world", ["Water world"]],
  ["Ammonia world", ["Ammonia world"]],
  ["Water giant", ["Water giant"]],
  ["Sudarsky class I gas giant", ["Class I gas giant"]],
  ["Sudarsky class II gas giant", ["Class II gas giant"]],
  ["Sudarsky class III gas giant", ["Class III gas giant"]],
  ["Sudarsky class IV gas giant", ["Class IV gas giant"]],
  ["Sudarsky class V gas giant", ["Class V gas giant"]],
  ["Gas giant with water based life", ["Gas giant with water-based life"]],
  ["Gas giant with ammonia based life", ["Gas giant with ammonia-based life"]],
  ["Helium rich gas giant", ["Helium-rich gas giant"]],
  ["Helium gas giant", ["Helium gas giant"]],
];
const KEYERS: [string, (t: string) => unknown][] = [
  ["bodyTypePlanetClass", (t) => bodyTypePlanetClass(t)],
  ["planetClassKey", (t) => planetClassKey(t)],
  ["planetClassId", (t) => planetClassId(t)],
  ["journalPlanetClass", (t) => journalPlanetClass(t)],
  ["planetClassFromDump", (t) => planetClassFromDump(t)],
  ["genus prior bodyFacts().type", (t) => bodyFacts({ PlanetClass: t } as unknown as PlanetScan).type],
  ["galaxyTraits.planetClassIndex", (t) => planetClassIndex(t)],
];

describe("planet-class keys across sources", () => {
  for (const [name, key] of KEYERS) {
    it(`${name}: the journal's spelling and the others' give one key`, () => {
      for (const [journal, others] of PAIRS) {
        for (const other of others) expect([other, key(other)]).toEqual([other, key(journal)]);
      }
    });
  }
  it("keeps the landable classes on the keys the tables were built with", () => {
    expect(["Rocky body", "Icy body", "High metal content body", "Rocky ice body", "Metal rich body"].map(bodyTypePlanetClass)).toEqual(
      ["rocky", "icy", "hmc", "rockyice", "metalrich"],
    );
    const type = (c: string) => bodyFacts({ PlanetClass: c } as unknown as PlanetScan).type;
    expect(["Rocky body", "Icy body", "High metal content body", "Rocky ice body", "Metal rich body"].map(type)).toEqual(
      ["rocky", "icy", "hmc", "rocky-ice", "metal-rich"],
    );
  });
});
