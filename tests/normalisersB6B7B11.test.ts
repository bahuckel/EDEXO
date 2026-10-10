/**
 * Code review 2026-10-10, B6 / B7 / B11 (plan 1.1, 2026-10-11).
 *
 * B6: the body-type prior's airless cells were keyed "no" (EDSM and Spansh write "No atmosphere") and a
 * journal body ("None") looked up "none", so every airless body from the journal missed the prior.
 * B7: "Gas giant with ammonia-based life" was filed with the ammonia worlds.
 * B11: a demoted row restored for the signal count or a DSS-named genus lost its soft-band factor.
 */
import { describe, expect, it } from "vitest";
import { bodyTypeAtmosphere, bodyTypePlanetClass } from "../src/shared/bodyTypeKey.js";
import { restoreDemotionsBelowSignalCount } from "../src/server/demotionPasses.js";
import type { SpeciesMatch } from "../src/shared/types.js";

describe("body-type key", () => {
  it("files every spelling of an airless body under one key", () => {
    for (const s of ["None", "none", "", null, undefined, "No atmosphere", "no atmosphere", "No Atmosphere"]) {
      expect(bodyTypeAtmosphere(s)).toBe("none");
    }
  });

  it("keeps the gases as before, journal and EDSM spellings alike", () => {
    expect(bodyTypeAtmosphere("CarbonDioxide")).toBe("carbondioxide");
    expect(bodyTypeAtmosphere("Thin Carbon dioxide")).toBe("carbondioxide");
    expect(bodyTypeAtmosphere("NeonRich")).toBe("neon");
    expect(bodyTypeAtmosphere("Thin Neon-rich")).toBe("neon");
  });

  it("keeps the gas giants out of the ammonia and water worlds", () => {
    expect(bodyTypePlanetClass("Gas giant with ammonia-based life")).not.toBe("ammoniaworld");
    expect(bodyTypePlanetClass("Sudarsky class I gas giant")).not.toBe("ammoniaworld");
    expect(bodyTypePlanetClass("Water giant")).not.toBe("water");
    expect(bodyTypePlanetClass("Ammonia world")).toBe("ammoniaworld");
    expect(bodyTypePlanetClass("Water world")).toBe("water");
    expect(bodyTypePlanetClass("High metal content world")).toBe("hmc");
    expect(bodyTypePlanetClass("High metal content body")).toBe("hmc");
    expect(bodyTypePlanetClass("Rocky Ice world")).toBe("rockyice");
  });
});

describe("restoring a demoted row", () => {
  type Row = Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">;
  const row = (id: string, genus: string, extra: Partial<Row> = {}): Row =>
    ({ entry: { id, genusDataDir: genus }, reasons: [], ...extra }) as unknown as Row;

  it("keeps its soft factor, for the signal count and for a DSS-named genus", () => {
    const demoted = (id: string, genus: string) =>
      row(id, genus, { unlikely: true, unlikelyReasons: [{ field: "StarType", detail: "x", soft: true }], presenceFactor: 0.07 });

    const strict: Row[] = [row("a_a", "a")];
    const unlikely: Row[] = [demoted("b_b", "b")];
    restoreDemotionsBelowSignalCount(strict, unlikely, 2, null);
    expect(strict.find((m) => m.entry.id === "b_b")?.presenceFactor).toBe(0.07);

    const strict2: Row[] = [row("a_a", "a")];
    const unlikely2: Row[] = [demoted("c_c", "c")];
    restoreDemotionsBelowSignalCount(strict2, unlikely2, null, new Set(["a", "c"]));
    expect(strict2.find((m) => m.entry.id === "c_c")?.presenceFactor).toBe(0.07);
  });
});
