/**
 * Which genera, before a DSS (Phase A.8, owner 2026-10-02): src/server/genusPrior.ts against the
 * shipped table, data/exomastery/genus-prior.json.
 */
import { describe, expect, it } from "vitest";
import {
  applyGenusPrior,
  genusPriorCells,
  genusPriorFor,
  genusPriorKey,
  rescueByGenusPrior,
  vetoUnseenGenera,
} from "../src/server/genusPrior.js";
import type { PlanetScan, SpeciesMatch } from "../src/shared/types.js";

const root = process.cwd();
const hmc = (o: Partial<PlanetScan> = {}): PlanetScan =>
  ({
    PlanetClass: "High metal content body",
    SurfaceTemperature: 260,
    AtmosphereType: "SulphurDioxide",
    Volcanism: "",
    ...o,
  }) as PlanetScan;

function match(id: string, genus: string, pct: number): SpeciesMatch {
  return {
    entry: { id, displayName: id, genus, genusDataDir: genus.toLowerCase(), criteria: {} },
    reasons: [],
    presenceProbabilityPercent: pct,
  } as unknown as SpeciesMatch;
}

describe("the table's keys", () => {
  it("spells a genus one way however it is written", () => {
    expect(genusPriorKey("Brain Tree")).toBe(genusPriorKey("Brain Trees"));
    expect(genusPriorKey("Sinuous Tuber")).toBe(genusPriorKey("Sinuous Tubers"));
    expect(genusPriorKey("Bacterium")).toBe("bacter");
  });

  it("reads the journal's spellings into the dump's cells, finest first", () => {
    expect(genusPriorCells(hmc({ Volcanism: "minor rocky magma volcanism" }), 1, "K")).toEqual([
      "L0|hmc|1|sulphur dioxide|13|K|rocky",
      "L1|hmc|1|sulphur dioxide|13|K",
      "L2|hmc|1|sulphur dioxide|13",
      "L3|hmc|1|sulphur dioxide",
      "L4|hmc|1",
      "L5|1",
    ]);
    expect(genusPriorCells(hmc(), 9, "Neutron Star")[0]).toBe("L0|hmc|5|sulphur dioxide|13|N|none");
  });

  it("finds a well-filled cell for a common body", () => {
    const p = genusPriorFor(root, hmc(), 1, "K")!;
    expect(p.n).toBeGreaterThanOrEqual(100);
    expect(p.p[genusPriorKey("Bacterium")]).toBeGreaterThan(0.5);
  });
});

describe("re-splitting a body's chance between genera", () => {
  const body = { genusHints: null, biologicalSignals: 1 };

  it("keeps the body's total and the shares inside each genus", () => {
    const ms = [
      match("bacterium_a", "Bacterium", 30),
      match("bacterium_b", "Bacterium", 10),
      match("stratum_t", "Stratum", 60),
    ];
    applyGenusPrior(ms, body, hmc(), { parentStarType: "K" }, root);
    const total = ms.reduce((a, m) => a + m.presenceProbabilityPercent!, 0);
    expect(total).toBeCloseTo(100, 0);
    expect(ms[0]!.presenceProbabilityPercent! / ms[1]!.presenceProbabilityPercent!).toBeCloseTo(3, 1);
    // On a one-signal HMC the dump says Bacterium far more often than Stratum.
    expect(ms[0]!.presenceProbabilityPercent! + ms[1]!.presenceProbabilityPercent!).toBeGreaterThan(
      ms[2]!.presenceProbabilityPercent!,
    );
  });

  it("does nothing once a DSS has named the genera, or without a signal count", () => {
    const ms = [match("bacterium_a", "Bacterium", 40), match("stratum_t", "Stratum", 60)];
    applyGenusPrior(
      ms,
      { genusHints: [{ Genus: "x", Genus_Localised: "Stratum" }], biologicalSignals: 1 },
      hmc(),
      null,
      root,
    );
    applyGenusPrior(ms, { genusHints: null, biologicalSignals: null }, hmc(), null, root);
    expect(ms.map((m) => m.presenceProbabilityPercent)).toEqual([40, 60]);
  });
});

describe("hiding a genus such bodies almost never carry, before a DSS (owner, 2026-10-02, Weqea DF-L b49-4 C 6)", () => {
  const c6 = () => hmc({ SurfaceTemperature: 183.39, AtmosphereType: "CarbonDioxide", Volcanism: "" });
  const body = { genusHints: null, biologicalSignals: 4 };

  /*
    Owner, 2026-10-03 ("no misses"): the limits are now where only 0.01 % of a genus's own real bodies
    fall, not 0.25 %. On C 6's kind of body (5,332 in the dump) Osseus is on 0.3 %, Concha 0.1 % and
    Fungoida 2.9 % — real, if small, so all eight stay before the DSS, the long shots low in the list.
  */
  it("keeps every genus C 6's kind of body really carries, however small", () => {
    const ms = [
      match("stratum_t", "Stratum", 100),
      match("bacterium_a", "Bacterium", 89),
      match("frutexa_m", "Frutexa", 63),
      match("tussock_p", "Tussock", 38),
      match("fungoida_g", "Fungoida", 13),
      match("osseus_f", "Osseus", 11),
      match("concha_r", "Concha", 9),
      match("aleoida_c", "Aleoida", 8),
    ];
    vetoUnseenGenera(ms, body, c6(), { parentStarType: "M" }, root, new Set());
    expect(ms.filter((m) => !m.unlikely).map((m) => m.entry.genus)).toEqual([
      "Stratum",
      "Bacterium",
      "Frutexa",
      "Tussock",
      "Fungoida",
      "Osseus",
      "Concha",
      "Aleoida",
    ]);
  });

  it("hides a rare genus only where it does not grow, and never what was sampled here", () => {
    // Fonticulua is never seen on C 6's kind of body: under its own small limit there. (Fumerola was the
    // example until 2026-10-10 and Anemone until 2026-10-14: a year of EDDN found each where its odds sit
    // under any limit — Anemone once its codex sightings were read — so they have none.)
    const quiet = [
      match("stratum_t", "Stratum", 100),
      match("fonticulua_x", "Fonticulua", 10),
      match("osseus_f", "Osseus", 11),
    ];
    vetoUnseenGenera(quiet, body, c6(), { parentStarType: "M" }, root, new Set(["osseus_f"]));
    expect(quiet.find((m) => m.entry.genus === "Fonticulua")!.unlikely).toBe(true);
    expect(quiet.find((m) => m.entry.genus === "Osseus")!.unlikely).toBeFalsy();
    // On an icy body with water volcanism it grows, and it stays however small its chance.
    const icy = (o: Partial<PlanetScan> = {}) =>
      ({
        PlanetClass: "Icy body",
        SurfaceTemperature: 120,
        AtmosphereType: "Nitrogen",
        Volcanism: "minor water geysers volcanism",
        ...o,
      }) as PlanetScan;
    const live = [match("bacterium_a", "Bacterium", 90), match("fumerola_x", "Fumerola", 3)];
    vetoUnseenGenera(
      live,
      { genusHints: null, biologicalSignals: 2 },
      icy(),
      { parentStarType: "K" },
      root,
      new Set(),
    );
    expect(live.find((m) => m.entry.genus === "Fumerola")!.unlikely).toBeFalsy();
  });

  it("does nothing after a DSS", () => {
    const ms = [match("stratum_t", "Stratum", 100), match("osseus_f", "Osseus", 11)];
    vetoUnseenGenera(
      ms,
      { genusHints: [{ Genus: "x", Genus_Localised: "Stratum" }], biologicalSignals: 4 },
      c6(),
      { parentStarType: "M" },
      root,
      new Set(),
    );
    expect(ms.every((m) => !m.unlikely)).toBe(true);
  });
});

describe("bringing back a row the floor hid on the model's number (rescueByGenusPrior)", () => {
  // Hold-out D, Tussock divisa (2026-10-16): 5 signals, rocky, thin ammonia, 175 K, G host. The model put the only
  // Tussock candidate at 0.4 % and the floor hid it; the dump's cell carries Tussock on 91 % of such bodies.
  const scan = {
    PlanetClass: "Rocky body",
    SurfaceTemperature: 175.2,
    AtmosphereType: "Ammonia",
    Volcanism: "",
  } as PlanetScan;
  const body = { genusHints: null, biologicalSignals: 5 };
  const ctx = { parentStarType: "G" };
  const hidden = (id: string, genus: string, pct: number): SpeciesMatch => ({
    ...match(id, genus, pct),
    unlikely: true,
    unlikelyReasons: [{ field: "Chance here", detail: `${pct} % — under the 1 % this panel shows.` }],
  });

  it("brings it back at the genus prior's blend when its genus has nothing else shown", () => {
    const divisa = hidden("tussock_tussock_divisa", "Tussock", 0.4);
    const rows = [match("bacterium_bacterium_alcyoneum", "Bacterium", 100), divisa];
    rescueByGenusPrior(rows, body, scan, ctx, root);
    expect(divisa.unlikely).toBe(false);
    expect(divisa.unlikelyReasons).toEqual([]);
    expect(divisa.presenceProbabilityPercent).toBeGreaterThan(15);
    expect(rows[0]!.presenceProbabilityPercent).toBe(100);
  });

  it("brings back one row per genus, the likeliest (1.2.19 review: three hidden Tussock came back together)", () => {
    const divisa = hidden("tussock_tussock_divisa", "Tussock", 0.4);
    const catena = hidden("tussock_tussock_catena", "Tussock", 0.3);
    const albata = hidden("tussock_tussock_albata", "Tussock", 0.2);
    rescueByGenusPrior([match("bacterium_bacterium_alcyoneum", "Bacterium", 100), catena, albata, divisa], body, scan, ctx, root);
    expect([divisa, catena, albata].map((m) => m.unlikely)).toEqual([false, true, true]);
  });

  it("leaves it hidden when a sibling of its genus is already shown", () => {
    const divisa = hidden("tussock_tussock_divisa", "Tussock", 0.4);
    rescueByGenusPrior([match("tussock_tussock_catena", "Tussock", 40), divisa], body, scan, ctx, root);
    expect(divisa.unlikely).toBe(true);
  });

  it("leaves it hidden when the cell rarely carries the genus, or another reason hid it too", () => {
    const concha = hidden("concha_concha_aureolas", "Concha", 0.4);
    rescueByGenusPrior([concha], body, scan, ctx, root);
    expect(concha.unlikely).toBe(true);
    const two = hidden("tussock_tussock_divisa", "Tussock", 0.4);
    two.unlikelyReasons!.push({ field: "Region", detail: "not here" });
    rescueByGenusPrior([two], body, scan, ctx, root);
    expect(two.unlikely).toBe(true);
  });

  it("does nothing after a DSS", () => {
    const divisa = hidden("tussock_tussock_divisa", "Tussock", 0.4);
    rescueByGenusPrior([divisa], { genusHints: [{ Genus: "$Codex_Ent_Tussocks_Genus_Name;", Genus_Localised: "Tussock" }], biologicalSignals: 5 }, scan, ctx, root);
    expect(divisa.unlikely).toBe(true);
  });
});

describe("pressure and gravity cells (2026-10-16)", () => {
  it("puts two pressure / gravity cells in front when both are known, and leaves them out for the veto", () => {
    const scan = hmc({ SurfacePressure: 0.02 * 101_325, SurfaceGravity: 0.3 * 9.80665 });
    const cells = genusPriorCells(scan, 1, "K");
    expect(cells.slice(0, 2)).toEqual(["P0|hmc|1|sulphur dioxide|13|3|4|K|none", "P1|hmc|1|sulphur dioxide|13|3|4"]);
    expect(cells[2]).toBe("L0|hmc|1|sulphur dioxide|13|K|none");
    expect(genusPriorCells(scan, 1, "K", true)[0]).toBe("L0|hmc|1|sulphur dioxide|13|K|none");
    expect(genusPriorCells(hmc(), 1, "K")[0]).toBe("L0|hmc|1|sulphur dioxide|13|K|none");
  });

  it("finds a pressure / gravity cell for a common body", () => {
    const p = genusPriorFor(root, hmc({ SurfacePressure: 0.003 * 101_325, SurfaceGravity: 0.5 * 9.80665 }), 1, "K")!;
    expect(p.cell.startsWith("P")).toBe(true);
    expect(p.n).toBeGreaterThanOrEqual(100);
  });
});
