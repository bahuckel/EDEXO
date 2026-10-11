/**
 * One answer to "does this body report volcanism" (plan 1.1, 2026-10-11), for every spelling the
 * sources use: the journal's empty string, EDSM's and the Spansh dump's "No volcanism", and the
 * spellings no source uses today but a copy of the check once mishandled ("None", "no").
 */
import { describe, expect, it } from "vitest";
import { reportsVolcanism } from "../src/shared/volcanismText.js";
import { bodyTypeVolcanism } from "../src/shared/bodyTypeKey.js";
import { volcanismKind } from "../src/shared/geology.js";

const QUIET = ["", "   ", null, undefined, "No volcanism", "no volcanism", "No Volcanism ", "None", "none", "no"];
const ACTIVE = [
  "minor water magma volcanism",
  "Minor Water Magma",
  "major silicate vapour geysers volcanism",
  "Major Silicate Vapour Geysers",
  "Carbon Dioxide Geysers",
  "Minor Nitrogen Magma",
];

describe("reportsVolcanism", () => {
  it("is false for every spelling of none", () => {
    for (const v of QUIET) expect(reportsVolcanism(v)).toBe(false);
  });
  it("is true for journal and dump spellings of a real volcanism", () => {
    for (const v of ACTIVE) expect(reportsVolcanism(v)).toBe(true);
  });
  it("is what the keyed readers agree on", () => {
    for (const v of QUIET) {
      expect(bodyTypeVolcanism(v)).toBe("none");
      expect(volcanismKind(v)).toBeNull();
    }
    for (const v of ACTIVE) {
      expect(bodyTypeVolcanism(v)).not.toBe("none");
      expect(volcanismKind(v)).not.toBeNull();
    }
  });
});
