/**
 * Measured odds over the ranking model (2026-10-10, docs/perf/deep-dive/REPORT-20261010.md): Recepta by
 * the sulphur dioxide in a carbon dioxide or oxygen atmosphere, Bacterium tela by atmosphere and branch.
 */
import { describe, expect, it } from "vitest";
import { applyMeasuredOdds, measuredPastPrior, PRASINUM_THIN_AMMONIA_PCT } from "../src/server/measuredOdds.js";
import type { PlanetScan, SpeciesMatch } from "../src/shared/types.js";

const m = (id: string, genus: string, pct: number, share: number): SpeciesMatch =>
  ({ entry: { id, genusDataDir: genus, displayName: id }, presenceProbabilityPercent: pct, genusSharePercent: share }) as SpeciesMatch;
const scan = (o: Partial<PlanetScan>) => o as PlanetScan;
const co2 = (so2: number) =>
  scan({
    AtmosphereType: "CarbonDioxide",
    SurfaceTemperature: 180,
    Volcanism: "",
    atmosphereComposition: [
      { Name: "CarbonDioxide", Percent: 100 - so2 },
      { Name: "SulphurDioxide", Percent: so2 },
    ],
  });

describe("Recepta by its sulphur dioxide", () => {
  it("rises with the share, the species split kept", () => {
    const low = [m("recepta_recepta_umbrux", "recepta", 0.5, 60), m("recepta_recepta_conditivus", "recepta", 0.3, 40)];
    applyMeasuredOdds(low, co2(1.05));
    expect(low.map((x) => x.presenceProbabilityPercent)).toEqual([14.4, 9.6]);
    const high = [m("recepta_recepta_umbrux", "recepta", 0.5, 60), m("recepta_recepta_conditivus", "recepta", 0.3, 40)];
    applyMeasuredOdds(high, co2(2.2));
    expect(high.map((x) => x.presenceProbabilityPercent)).toEqual([53.4, 35.6]);
  });

  it("stands down once a DSS has named the genera (1.2.19 review: the rate answers 'is Recepta here at all')", () => {
    const named = [m("recepta_recepta_umbrux", "recepta", 60, 60), m("recepta_recepta_conditivus", "recepta", 40, 40)];
    applyMeasuredOdds(named, co2(1.05), true);
    expect(named.map((x) => x.presenceProbabilityPercent)).toEqual([60, 40]);
  });

  it("leaves a sulphur dioxide atmosphere, and a trace under the line, to the model", () => {
    const so2 = [m("recepta_recepta_umbrux", "recepta", 40, 100)];
    applyMeasuredOdds(so2, scan({ AtmosphereType: "SulphurDioxide", atmosphereComposition: [{ Name: "SulphurDioxide", Percent: 100 }] }));
    expect(so2[0]!.presenceProbabilityPercent).toBe(40);
    const trace = [m("recepta_recepta_umbrux", "recepta", 0.4, 100)];
    applyMeasuredOdds(trace, co2(0.99));
    expect(trace[0]!.presenceProbabilityPercent).toBe(0.4);
  });
});

describe("Bacterium tela's measured share", () => {
  const neon = scan({ AtmosphereType: "Neon", SurfaceTemperature: 45, Volcanism: "minor nitrogen magma volcanism" });
  it("on a cold volcanic neon body (nitrogen magma): 29 % of the Bacterium, the total kept", () => {
    const rows = [m("bacterium_bacterium_acies", "bacterium", 90, 92), m("bacterium_bacterium_tela", "bacterium", 3.7, 4), m("bacterium_bacterium_vesicula", "bacterium", 4, 4)];
    applyMeasuredOdds(rows, neon);
    const [acies, tela, ves] = rows;
    expect(tela!.presenceProbabilityPercent).toBe(28.3);
    expect(tela!.genusSharePercent).toBe(29);
    expect(acies!.presenceProbabilityPercent! + tela!.presenceProbabilityPercent! + ves!.presenceProbabilityPercent!).toBeCloseTo(97.7, 0);
    expect(acies!.presenceProbabilityPercent!).toBeGreaterThan(ves!.presenceProbabilityPercent!);
  });

  it("not on a cold calm body, nor where tela is the only Bacterium, nor on an unmeasured atmosphere", () => {
    const calm = [m("bacterium_bacterium_acies", "bacterium", 90, 95), m("bacterium_bacterium_tela", "bacterium", 5, 5)];
    applyMeasuredOdds(calm, scan({ AtmosphereType: "Neon", SurfaceTemperature: 45, Volcanism: "" }));
    expect(calm[1]!.presenceProbabilityPercent).toBe(5);
    const alone = [m("bacterium_bacterium_tela", "bacterium", 40, 100)];
    applyMeasuredOdds(alone, neon);
    expect(alone[0]!.presenceProbabilityPercent).toBe(40);
    const nitrogen = [m("bacterium_bacterium_informem", "bacterium", 80, 90), m("bacterium_bacterium_tela", "bacterium", 8, 10)];
    applyMeasuredOdds(nitrogen, scan({ AtmosphereType: "Nitrogen", SurfaceTemperature: 160, Volcanism: "minor water magma volcanism" }));
    expect(nitrogen[1]!.presenceProbabilityPercent).toBe(8);
  });
});

describe("Bacterium omentum's measured share (with tela's on the same body)", () => {
  const nmagma = (atm: string) => scan({ AtmosphereType: atm, SurfaceTemperature: 40, Volcanism: "minor nitrogen magma volcanism" });
  it("neon with nitrogen magma: omentum a third, tela 29 %, acies the rest", () => {
    const rows = [
      m("bacterium_bacterium_acies", "bacterium", 80, 85),
      m("bacterium_bacterium_omentum", "bacterium", 15, 10),
      m("bacterium_bacterium_tela", "bacterium", 5, 5),
    ];
    applyMeasuredOdds(rows, nmagma("Neon"));
    expect(rows.map((x) => x.genusSharePercent)).toEqual([38, 33, 29]);
    expect(rows.map((x) => x.presenceProbabilityPercent)).toEqual([38, 33, 29]);
  });

  it("neon-rich, the two alone: they split the Bacterium between them", () => {
    const rows = [m("bacterium_bacterium_omentum", "bacterium", 50, 50), m("bacterium_bacterium_tela", "bacterium", 50, 50)];
    applyMeasuredOdds(rows, nmagma("NeonRich"));
    expect(rows.map((x) => x.genusSharePercent)).toEqual([52, 48]);
  });

  it("not without nitrogen or ammonia magma", () => {
    const rows = [m("bacterium_bacterium_acies", "bacterium", 80, 80), m("bacterium_bacterium_omentum", "bacterium", 20, 20)];
    applyMeasuredOdds(rows, scan({ AtmosphereType: "Neon", SurfaceTemperature: 40, Volcanism: "minor water magma volcanism" }));
    expect(rows[1]!.presenceProbabilityPercent).toBe(20);
  });
});

describe("spelled the EDSM / Spansh way (code review 2026-10-10, B5)", () => {
  it("a looked-up body gets the same measured odds as a scanned one", () => {
    const rows = [m("bacterium_bacterium_acies", "bacterium", 90, 92), m("bacterium_bacterium_tela", "bacterium", 3.7, 4), m("bacterium_bacterium_vesicula", "bacterium", 4, 4)];
    applyMeasuredOdds(rows, scan({ AtmosphereType: "Thin Neon", SurfaceTemperature: 45, Volcanism: "Minor Nitrogen Magma" }));
    expect(rows[1]!.genusSharePercent).toBe(29);
    const rec = [m("recepta_recepta_umbrux", "recepta", 0.5, 100)];
    applyMeasuredOdds(rec, scan({ AtmosphereType: "Thin Carbon dioxide", atmosphereComposition: [{ Name: "SulphurDioxide", Percent: 2.2 }, { Name: "CarbonDioxide", Percent: 97.8 }] }));
    expect(rec[0]!.presenceProbabilityPercent).toBe(89);
  });

  it("neon-rich stays apart from neon", () => {
    const rows = [m("bacterium_bacterium_omentum", "bacterium", 50, 50), m("bacterium_bacterium_tela", "bacterium", 50, 50)];
    applyMeasuredOdds(rows, scan({ AtmosphereType: "Thin Neon-rich", SurfaceTemperature: 40, Volcanism: "Minor Nitrogen Magma" }));
    expect(rows.map((x) => x.genusSharePercent)).toEqual([52, 48]);
  });
});

describe("the cold volcanic Bacterium (verrata, scopulum; 2026-10-11)", () => {
  const body = (atm: string, volc: string, t = 60) => scan({ AtmosphereType: atm, SurfaceTemperature: t, Volcanism: volc });
  it("water geysers on neon: verrata 37, tela 33, acies the rest", () => {
    const rows = [
      m("bacterium_bacterium_acies", "bacterium", 70, 70),
      m("bacterium_bacterium_verrata", "bacterium", 10, 10),
      m("bacterium_bacterium_tela", "bacterium", 20, 20),
    ];
    applyMeasuredOdds(rows, body("Neon", "minor water geysers volcanism"));
    expect(rows.map((x) => x.genusSharePercent)).toEqual([30, 37, 33]);
  });
  it("carbon dioxide geysers on neon-rich, scopulum and tela alone: 59 / 41", () => {
    const rows = [m("bacterium_bacterium_scopulum", "bacterium", 20, 20), m("bacterium_bacterium_tela", "bacterium", 80, 80)];
    applyMeasuredOdds(rows, body("NeonRich", "minor carbon dioxide geysers volcanism"));
    expect(rows.map((x) => x.genusSharePercent)).toEqual([59, 41]);
  });
  it("not on a hot body: tela's hot share, verrata left to the model", () => {
    const rows = [m("bacterium_bacterium_verrata", "bacterium", 30, 30), m("bacterium_bacterium_tela", "bacterium", 20, 20), m("bacterium_bacterium_cerbrus", "bacterium", 50, 50)];
    applyMeasuredOdds(rows, body("SulphurDioxide", "minor water geysers volcanism", 320));
    expect(rows[1]!.genusSharePercent).toBe(53);
  });
});

describe("Anemone prasinum on rocky thin ammonia (plan 1.3.4 S-5)", () => {
  const ammonia = (planetClass: string) =>
    scan({ AtmosphereType: "Ammonia", PlanetClass: planetClass, SurfaceTemperature: 170, atmosphereComposition: [{ Name: "Ammonia", Percent: 100 }] });
  it("reads its measured rate before a DSS, and passes the genus prior's veto", () => {
    const rows = [m("anemone_prasinum_bioluminescent", "anemone", 0.1, 100), m("bacterium_bacterium_alcyoneum", "bacterium", 90, 100)];
    applyMeasuredOdds(rows, ammonia("Rocky body"), false, "O");
    expect(rows.map((x) => x.presenceProbabilityPercent)).toEqual([PRASINUM_THIN_AMMONIA_PCT, 90]);
    expect(measuredPastPrior(rows[0]!, ammonia("Rocky body"), "O")).toBe(true);
    expect(measuredPastPrior(rows[1]!, ammonia("Rocky body"), "O")).toBe(false);
  });

  it("not while the system's main star is unknown: the star gate abstains then, and the body could be anywhere", () => {
    const unknown = [m("anemone_prasinum_bioluminescent", "anemone", 0.1, 100)];
    applyMeasuredOdds(unknown, ammonia("Rocky body"));
    expect(unknown[0]!.presenceProbabilityPercent).toBe(0.1);
    const unresolved = [{ ...m("anemone_prasinum_bioluminescent", "anemone", 0.1, 100), spatialGateUnresolved: true }];
    applyMeasuredOdds(unresolved, ammonia("Rocky body"), false, "O");
    expect(unresolved[0]!.presenceProbabilityPercent).toBe(0.1);
    expect(measuredPastPrior(unknown[0]!, ammonia("Rocky body"), null)).toBe(false);
  });

  it("not after a DSS, nor on another planet class or atmosphere", () => {
    const named = [m("anemone_prasinum_bioluminescent", "anemone", 100, 100)];
    applyMeasuredOdds(named, ammonia("Rocky body"), true, "O");
    expect(named[0]!.presenceProbabilityPercent).toBe(100);
    const hmc = [m("anemone_prasinum_bioluminescent", "anemone", 0.1, 100)];
    applyMeasuredOdds(hmc, ammonia("High metal content body"), false, "O");
    expect(hmc[0]!.presenceProbabilityPercent).toBe(0.1);
    expect(measuredPastPrior(hmc[0]!, co2(0), "O")).toBe(false);
  });
});
