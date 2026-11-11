/**
 * The atmosphere keys agree across sources (review 2026-11-07 §3.4, 2026-11-10 A5). The app keys an atmosphere four
 * ways on purpose (the measured tables tell neon from neon-rich, the gas shares do not, the genus split counts words),
 * but each key must give the journal's spelling and Spansh's the same answer: A5 was one of them reading "Thin
 * Argon-rich" as something no species had.
 */
import { describe, expect, it } from "vitest";
import { atmosphereCompositionKey, atmosphereTypeKeyOf } from "../src/shared/scanAtmosphereMatch.js";
import { atmosphereKey as genusSplitAtmosphereKey } from "../src/server/genusBodySplit.js";
import { mapEdsmBodyToExplorationRecord } from "../src/server/edsmSystemHydration.js";
import { planetScanFromExplorationRecord } from "../src/server/footScannedCatalog.js";
import type { PlanetScan } from "../src/shared/types.js";

/** The journal's `AtmosphereType`, and the ways Spansh and EDSM write the same atmosphere. */
const SPELLINGS: [journal: string, others: string[]][] = [
  ["CarbonDioxide", ["Thin Carbon dioxide", "Hot thin Carbon dioxide", "Thick Carbon dioxide"]],
  ["CarbonDioxideRich", ["Thin Carbon dioxide-rich"]],
  ["SulphurDioxide", ["Thin Sulphur dioxide", "Thin Sulfur dioxide"]],
  ["Ammonia", ["Thin Ammonia"]],
  ["Water", ["Thin Water"]],
  ["WaterRich", ["Thin Water-rich"]],
  ["Methane", ["Thin Methane"]],
  ["MethaneRich", ["Thin Methane-rich"]],
  ["Nitrogen", ["Thin Nitrogen"]],
  ["Oxygen", ["Thin Oxygen"]],
  ["Helium", ["Thin Helium"]],
  ["Argon", ["Thin Argon"]],
  ["ArgonRich", ["Thin Argon-rich", "Thin Argon Rich"]],
  ["Neon", ["Thin Neon"]],
  ["NeonRich", ["Thin Neon-rich", "Thin Neon Rich"]],
];

const journalScan = (t: string) => ({ PlanetClass: "Rocky body", AtmosphereType: t }) as unknown as PlanetScan;
const hydratedScan = (t: string) =>
  planetScanFromExplorationRecord(
    mapEdsmBodyToExplorationRecord({ bodyId: 1, name: "X 1", type: "Planet", subType: "Rocky body", atmosphereType: t }, 1, "X")!,
  )!;

describe("the atmosphere keys", () => {
  it.each(SPELLINGS)("give %s the same key as the other sources' spellings", (journal, others) => {
    for (const other of others) {
      expect(atmosphereTypeKeyOf(hydratedScan(other)), `type key: ${other}`).toBe(atmosphereTypeKeyOf(journalScan(journal)));
      expect(genusSplitAtmosphereKey(other), `genus split key: ${other}`).toBe(genusSplitAtmosphereKey(journal));
    }
  });

  it("keep -rich apart where the tables do, and fold it for gas shares", () => {
    expect(atmosphereTypeKeyOf(journalScan("NeonRich"))).not.toBe(atmosphereTypeKeyOf(journalScan("Neon")));
    expect(genusSplitAtmosphereKey("NeonRich")).not.toBe(genusSplitAtmosphereKey("Neon"));
    expect(atmosphereCompositionKey("NeonRich")).toBe(atmosphereCompositionKey("Neon"));
    // A composition row's gas name, either spelling.
    expect(atmosphereCompositionKey("Sulfur dioxide")).toBe(atmosphereCompositionKey("SulphurDioxide"));
    expect(atmosphereCompositionKey("Carbon dioxide")).toBe(atmosphereCompositionKey("CarbonDioxide"));
  });
});
