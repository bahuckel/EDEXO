/**
 * One atmosphere, however it is spelled.
 *
 * The journal writes `AtmosphereType: "SulphurDioxide"`; Spansh and EDSM write `Thin Sulphur dioxide`
 * with the density folded in; an EDDN export built from the scan's `Atmosphere` text writes the
 * game's other spelling, `Thin Sulfur dioxide`. All of them are one gas to a species row.
 */
import { describe, expect, it } from "vitest";
import {
  atmosphereCompositionKey,
  atmosphereListKey,
  normalizeScanAtmosphereForMatch,
} from "../src/shared/scanAtmosphereMatch.js";
import { normalizeAtmosphereToJournal } from "../src/server/speciesCriterionParser.js";
import type { PlanetScan } from "../src/shared/types.js";

const scan = (AtmosphereType: string) => ({ AtmosphereType }) as PlanetScan;
const key = (t: string) => atmosphereCompositionKey(normalizeScanAtmosphereForMatch(scan(t)));

describe("atmosphere spellings", () => {
  it("folds the game's two spellings of sulphur together", () => {
    expect(key("Thin Sulfur dioxide")).toBe(key("SulphurDioxide"));
    expect(key("Thin Sulphur dioxide")).toBe(key("SulphurDioxide"));
  });

  it("strips every leading density word, hot included", () => {
    expect(key("Hot thin Sulphur dioxide")).toBe(key("SulphurDioxide"));
    expect(key("Hot thick Carbon dioxide")).toBe(key("CarbonDioxide"));
    expect(key("Thin Carbon dioxide rich")).toBe(key("CarbonDioxideRich"));
  });

  it("still reads no atmosphere as none", () => {
    expect(normalizeScanAtmosphereForMatch(scan("No atmosphere"))).toBe("");
  });

  it("keeps -rich apart for a species list, however it is spelled (1.4.0)", () => {
    // The game treats "X-rich" as its own atmosphere: aurasus on 0 of 2,988 CO2-rich bodies of the EDDN year.
    const list = (t: string) => atmosphereListKey(normalizeScanAtmosphereForMatch(scan(t)));
    expect(list("Thin Carbon dioxide-rich")).toBe(list("CarbonDioxideRich"));
    expect(list("CarbonDioxideRich")).not.toBe(list("CarbonDioxide"));
    expect(list("Thin Sulfur dioxide")).toBe(list("SulphurDioxide"));
    expect(normalizeAtmosphereToJournal(["Carbon dioxide-rich", "Argon-rich", "CO2-rich", "Carbon Dioxide"])).toEqual([
      "CarbonDioxideRich",
      "ArgonRich",
      "CarbonDioxide",
    ]);
  });
});
