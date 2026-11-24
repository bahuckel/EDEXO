/**
 * Edges of organicTracking.ts (Stryker 2026-11-24): the sale key from the journal's symbols or, without any, its
 * localised names, the Sample/Analyse counter and the unsold line's label. Each case fails when the named fallback or
 * comparison changes.
 */
import { describe, expect, it } from "vitest";
import {
  displayLabelFromOrganicLine,
  nextOrganicProgressCount,
  speciesKeyFromOrganicJournal,
  speciesKeyFromSellBio,
} from "../src/server/organicTracking.js";
import type { JournalLine } from "../src/shared/types.js";

const line = (o: Record<string, unknown>) => o as unknown as JournalLine;
const NAMES = { Genus_Localised: " Stratum ", Species_Localised: " Stratum  Tectonicas ", Variant_Localised: " Green" };

describe("the sale key", () => {
  it("is built from the symbols, trimmed and lower-cased, whatever the localised names say", () => {
    const l = line({ Genus: " $Codex_Ent_Stratum_Genus_Name; ", Species: "$S;", Variant: "$V; ", ...NAMES });
    expect(speciesKeyFromOrganicJournal(l)).toBe("$codex_ent_stratum_genus_name;|$s;|$v;");
    expect(speciesKeyFromSellBio(l as unknown as Record<string, unknown>)).toBe("$codex_ent_stratum_genus_name;|$s;|$v;");
  });

  it("takes the symbols when only one of the three is there", () => {
    expect(speciesKeyFromOrganicJournal(line({ Genus: "$G;", ...NAMES }))).toBe("$g;||");
    expect(speciesKeyFromOrganicJournal(line({ Species: "$S;", ...NAMES }))).toBe("|$s;|");
    expect(speciesKeyFromOrganicJournal(line({ Variant: "$V;", ...NAMES }))).toBe("||$v;");
  });

  it("falls back to the localised names when no symbol is a non-empty string", () => {
    const l = line({ Genus: 7, Species: "  ", Variant: null, ...NAMES });
    expect(speciesKeyFromOrganicJournal(l)).toBe("stratum|stratum tectonicas|green");
    expect(speciesKeyFromOrganicJournal(line({ Variant: "  ", ...NAMES }))).toBe("stratum|stratum tectonicas|green");
    expect(speciesKeyFromOrganicJournal(line({ Species_Localised: "Tectonicas" }))).toBe("|tectonicas|");
    expect(speciesKeyFromOrganicJournal(line({ Genus_Localised: 1, Variant_Localised: ["x"] }))).toBe("||");
  });
});

describe("the Sample and Analyse counter", () => {
  it("counts a Sample up to two, an Analyse as three, and a Log not at all", () => {
    const at = (prev: number, ScanType: unknown) => nextOrganicProgressCount(prev, line({ ScanType }));
    expect([at(0, "Sample"), at(1, "Sample"), at(2, "Sample"), at(5, "Sample")]).toEqual([1, 2, 2, 2]);
    expect([at(0, "Analyse"), at(2, "Analyse")]).toEqual([3, 3]);
    expect([at(0, "Log"), at(2, "Log"), at(1, "Something new")]).toEqual([null, null, null]);
  });

  it("counts a line without a scan type up to three", () => {
    const at = (prev: number, ScanType?: unknown) => nextOrganicProgressCount(prev, line({ ScanType }));
    expect([at(0), at(2), at(3), at(1, "")]).toEqual([1, 3, 3, 2]);
  });
});

describe("the unsold line's label", () => {
  it("is the game's variant name when there is one", () => {
    expect(displayLabelFromOrganicLine(line({ ...NAMES, Variant_Localised: " Stratum Tectonicas - Green " }))).toBe(
      "Stratum Tectonicas - Green",
    );
  });

  it("joins genus and species otherwise, either alone, and says Unknown without both", () => {
    const g = { Genus_Localised: " Stratum " };
    const s = { Species_Localised: " Tectonicas " };
    expect(displayLabelFromOrganicLine(line({ ...g, ...s, Variant_Localised: "  " }))).toBe("Stratum Tectonicas");
    expect(displayLabelFromOrganicLine(line({ ...g, Variant_Localised: 3 }))).toBe("Stratum");
    expect(displayLabelFromOrganicLine(line(s))).toBe("Tectonicas");
    expect(displayLabelFromOrganicLine(line({ Genus_Localised: 1, Species_Localised: null }))).toBe("Unknown");
  });
});
