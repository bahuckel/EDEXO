/**
 * Volcanism and star-class keys agree across sources (review 2026-11-07 §3.4: volcanism keyed three ways, star class
 * three). The journal writes "minor water geysers volcanism" and an empty string for a quiet body; Spansh and EDSM
 * write "Minor Water Geysers" and "No volcanism". A star is the journal's `StarType` ("K", "M_RedGiant", "DA") where
 * Spansh writes a spectral class ("K2", "M_RedGiant8") or words. Each key must give both the same answer.
 */
import { describe, expect, it } from "vitest";
import { reportsVolcanism, volcanismFamily } from "../src/shared/volcanismText.js";
import { volcanismKey } from "../src/server/speciesVolcanismObservations.js";
import { volcanismKind } from "../src/server/genusBodySplit.js";
import { mapEdsmBodyToExplorationRecord } from "../src/server/edsmSystemHydration.js";
import { colourStarClassKey, hostStarClassKey } from "../src/shared/hostStarClass.js";

const VOLCANISM: [journal: string, spansh: string][] = [
  ["", "No volcanism"],
  ["minor water geysers volcanism", "Minor Water Geysers"],
  ["major water magma volcanism", "Major Water Magma"],
  ["carbon dioxide geysers volcanism", "Carbon Dioxide Geysers"],
  ["minor ammonia magma volcanism", "Minor Ammonia Magma"],
  ["nitrogen magma volcanism", "Nitrogen Magma"],
  ["methane magma volcanism", "Methane Magma"],
  ["major silicate vapour geysers volcanism", "Major Silicate Vapour Geysers"],
  ["metallic magma volcanism", "Metallic Magma"],
  ["minor rocky magma volcanism", "Minor Rocky Magma"],
];

const hydratedVolcanism = (v: string) =>
  mapEdsmBodyToExplorationRecord({ bodyId: 1, name: "X 1", type: "Planet", subType: "Rocky body", volcanismType: v }, 1, "X")!
    .volcanism ?? "";

describe("the volcanism keys", () => {
  it.each(VOLCANISM)("give %j the same answer as Spansh's %j", (journal, spansh) => {
    const other = hydratedVolcanism(spansh);
    expect(reportsVolcanism(other)).toBe(reportsVolcanism(journal));
    expect(volcanismFamily(other)).toBe(volcanismFamily(journal));
    expect(volcanismKey(other)).toBe(volcanismKey(journal));
    expect(volcanismKind(other)).toBe(volcanismKind(journal));
  });
});

/** The journal's `StarType`, and a Spansh star body as its dump writes the same star. */
const STARS: [journal: string, spansh: Record<string, unknown>][] = [
  ["K", { subType: "K (Yellow-Orange) Star", spectralClass: "K2" }],
  ["M", { subType: "M (Red dwarf) Star", spectralClass: "M5" }],
  ["F", { subType: "F (White) Star", spectralClass: "F8" }],
  ["M_RedGiant", { subType: "M (Red giant) Star", spectralClass: "M_RedGiant8" }],
  ["DA", { subType: "White Dwarf (DA) Star", spectralClass: "DA5" }],
  ["DAB", { subType: "White Dwarf (DAB) Star", spectralClass: "DAB5" }],
  ["N", { subType: "Neutron Star", spectralClass: "N0" }],
  ["TTS", { subType: "T Tauri Star", spectralClass: "TTS5" }],
  ["H", { subType: "Black Hole" }],
  ["L", { subType: "L (Brown dwarf) Star", spectralClass: "L4" }],
];

describe("the star-class keys", () => {
  it.each(STARS)("give the journal's %s the same class as Spansh's star", (journal, body) => {
    const rec = mapEdsmBodyToExplorationRecord({ bodyId: 0, name: "X", type: "Star", ...body }, 1, "X")!;
    expect(rec.starType).toBe(journal);
    expect(hostStarClassKey(rec.starType)).toBe(hostStarClassKey(journal));
    expect(colourStarClassKey(rec.starType)).toBe(colourStarClassKey(journal));
  });
});
