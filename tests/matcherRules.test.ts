/**
 * Matcher rules no test named (review 2026-11-07 §3.3, plan 2.3): the orbit's `softBelow` steps, the star-orbit
 * factor, the observed envelope's "kept at ×", the one-signal icy Deltahedronix demotion, the all-conditions drop, and
 * the order the demotion passes run in. Each against the function, on entries made for the rule.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { speciesMatchesCriteria, speciesMatchesExcludingTempPressure } from "../src/server/matchSpecies.js";
import {
  demoteDeltahedronixOnOneSignalIcy,
  dropUnprovenStrictSpecies,
  runDemotionPasses,
} from "../src/server/demotionPasses.js";
import type { PlanetScan, SpeciesEntry, SpeciesMatchContext } from "../src/shared/types.js";

// A rocky body in carbon dioxide, which every entry here allows: only the rule under test can object.
const entry = (id: string, criteria: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({
    id,
    displayName: id,
    genus: "Test",
    genusDataDir: "test",
    criteria: { planetClassAnyOf: ["Rocky body"], atmosphereTypeAnyOf: ["CarbonDioxide"], ...criteria },
    ...extra,
  }) as unknown as SpeciesEntry;
const scan = (o: Record<string, unknown> = {}) =>
  ({ PlanetClass: "Rocky body", AtmosphereType: "CarbonDioxide", ...o }) as unknown as PlanetScan;
const ctx = (o: Partial<SpeciesMatchContext>) => o as SpeciesMatchContext;

describe("the orbit's softBelow steps", () => {
  // Clypeus speculumi's shape: codex minimum 2,495 ls, grows less often down to 2,300.
  const e = entry("test_orbit", { orbitDistanceFromParentStarLs: { min: 2495, softBelow: [{ fromLs: 2300, factor: 0.1 }] } });
  const at = (ls: number) => speciesMatchesExcludingTempPressure(e, scan(), ctx({ orbitDistanceFromParentStarLs: ls }));

  it("keeps a body under the minimum, down to the step, at the step's factor", () => {
    for (const ls of [2300, 2400, 2494]) {
      const r = at(ls);
      expect(r.ok, `${ls} ls`).toBe(true);
      expect(r.presenceFactor, `${ls} ls`).toBe(0.1);
      expect(r.reasons.some((x) => x.field === "Orbit" && x.detail.includes("kept at ×0.1"))).toBe(true);
    }
  });

  it("demotes a body under the step, and leaves one in range at full chance", () => {
    const under = at(2299);
    expect(under.ok).toBe(false);
    expect(under.reasons).toEqual([expect.objectContaining({ field: "Orbit", soft: true })]);
    const inRange = at(2600);
    expect(inRange.ok).toBe(true);
    expect(inRange.presenceFactor).toBeUndefined();
  });
});

describe("the star-orbit factor (a moon-grower on a planet round a star)", () => {
  const e = entry("test_moon_grower", { softMaxSemiMajorAxisLs: 20 });

  it("keeps the row at 0.15 of its chance round a star", () => {
    const r = speciesMatchesCriteria(e, scan(), null, null, ctx({ orbitsAStar: true }));
    expect(r.ok).toBe(true);
    expect(r.presenceFactor).toBe(0.15);
    expect(r.reasons.some((x) => x.field === "Orbit" && x.detail.includes("about 15 %"))).toBe(true);
  });

  it("demotes a moon farther out than the limit, and passes a close one", () => {
    const far = speciesMatchesCriteria(e, scan({ SemiMajorAxis: 30 * 299_792_458 }), null, null, ctx({ orbitsAStar: false }));
    expect(far.ok).toBe(false);
    expect(far.reasons.some((x) => x.field === "Orbit" && x.soft)).toBe(true);
    const near = speciesMatchesCriteria(e, scan({ SemiMajorAxis: 10 * 299_792_458 }), null, null, ctx({ orbitsAStar: false }));
    expect(near.ok).toBe(true);
    expect(near.presenceFactor).toBeUndefined();
  });
});

describe("the observed envelope's kept-at factor", () => {
  // Inside Aleoida arcus' firm 175-180 K edges, which would object first. Its measured factor is 0.02
  // (data/exomastery/observed-temperature.json).
  const envelope = { min: 175, max: 177, count: 50 };
  const kept = entry("aleoida_aleoida_arcus", {}, { observedTemperatureK: envelope });
  const unmeasured = entry("test_no_factor", {}, { observedTemperatureK: envelope });

  it("keeps a species with a measured factor at that factor outside its envelope", () => {
    const r = speciesMatchesCriteria(kept, scan({ SurfaceTemperature: 177.6 }), null, null, null);
    expect(r.ok).toBe(true);
    expect(r.presenceFactor).toBe(0.02);
    expect(r.reasons.some((x) => x.field === "ObservedTemperature" && x.detail.includes("kept at ×0.02"))).toBe(true);
  });

  it("demotes one without a factor, and lets half a kelvin past the edge through untouched", () => {
    const r = speciesMatchesCriteria(unmeasured, scan({ SurfaceTemperature: 177.6 }), null, null, null);
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual([expect.objectContaining({ field: "ObservedTemperature", soft: true })]);
    const edge = speciesMatchesCriteria(kept, scan({ SurfaceTemperature: 177.5 }), null, null, null);
    expect(edge.ok).toBe(true);
    expect(edge.presenceFactor).toBeUndefined();
  });
});

type Row = Parameters<typeof demoteDeltahedronixOnOneSignalIcy>[0][number];
const row = (id: string, criteria: Record<string, unknown> = {}) =>
  ({ entry: entry(id, criteria), reasons: [], unlikely: false }) as unknown as Row;
const ids = (rows: { entry: SpeciesEntry }[]) => rows.map((r) => r.entry.id);

describe("Deltahedronix on a one-signal icy body", () => {
  const run = (planetClass: string, signals: number | null, assumed: boolean) => {
    const strict = [row("recepta_recepta_deltahedronix"), row("recepta_recepta_umbrux")];
    const unlikely: Row[] = [];
    demoteDeltahedronixOnOneSignalIcy(strict, unlikely, planetClass, signals, assumed);
    return { strict: ids(strict), unlikely };
  };

  it("is demoted on the game's own count of one, with the reason", () => {
    const r = run("Icy body", 1, false);
    expect(r.strict).toEqual(["recepta_recepta_umbrux"]);
    expect(ids(r.unlikely)).toEqual(["recepta_recepta_deltahedronix"]);
    expect(r.unlikely[0]!.unlikely).toBe(true);
    expect(r.unlikely[0]!.reasons.at(-1)).toMatchObject({ field: "BioSignals", soft: true });
  });

  it("stays on an assumed count (AutoScan only), two signals, no count, or another class", () => {
    for (const [cls, n, assumed] of [["Icy body", 1, true], ["Icy body", 2, false], ["Icy body", null, false], ["Rocky body", 1, false]] as const)
      expect(run(cls, n, assumed).strict, `${cls} ${n} ${assumed}`).toEqual(["recepta_recepta_deltahedronix", "recepta_recepta_umbrux"]);
  });
});

describe("the all-conditions drop", () => {
  const strictOnly = { allConditionsRequired: true, systemBodyClassesAnyOf: ["Earthlike body"] };

  it("drops an all-conditions species whose companion body is not proven, unless a DSS named the genus", () => {
    const run = (c: Partial<SpeciesMatchContext>, named: boolean) => {
      const strict = [row("test_strict", strictOnly), row("test_plain")];
      const unlikely = [row("test_strict_demoted", strictOnly)];
      dropUnprovenStrictSpecies(strict as never, unlikely as never, ctx(c), () => named);
      return { strict: ids(strict), unlikely: ids(unlikely) };
    };
    expect(run({ systemBodyClasses: ["Icy body"], systemBodyListComplete: false }, false)).toEqual({ strict: ["test_plain"], unlikely: [] });
    expect(run({ systemBodyClasses: ["Earthlike body"], systemBodyListComplete: true }, false)).toEqual({
      strict: ["test_strict", "test_plain"],
      unlikely: [],
    });
    expect(run({ systemBodyClasses: [], systemBodyListComplete: false }, true)).toEqual({
      strict: ["test_strict", "test_plain"],
      unlikely: ["test_strict_demoted"],
    });
  });
});

describe("the demotion passes", () => {
  it("drop an unproven all-conditions species before the signal-count restore, which cannot bring it back", () => {
    const strict = [row("test_strict", { allConditionsRequired: true, systemBodyClassesAnyOf: ["Earthlike body"] })];
    const unlikely: Row[] = [];
    runDemotionPasses(strict as never, unlikely as never, {
      planetClass: "Rocky body",
      matchContext: ctx({ systemBodyClasses: [], systemBodyListComplete: false }),
      spatialCatalogue: null,
      biologicalSignals: 3,
      signalCountAssumed: false,
      dssNamed: () => false,
      restoreGenera: null,
      restore: true,
    });
    expect(ids(strict)).toEqual([]);
    expect(ids(unlikely)).toEqual([]);
  });

  // A reorder changes which objection a restore counts (review 2026-11-07 §3.3): the order is part of the behaviour.
  it("run in the matcher's order", () => {
    const src = readFileSync("src/server/demotionPasses.ts", "utf8");
    const body = src.slice(src.indexOf("export function runDemotionPasses("));
    const calls = [...body.slice(body.indexOf("): void {")).matchAll(/(\w+)\(\s*strict,\s*unlikely/g)].map((m) => m[1]);
    expect(calls).toEqual([
      "demoteFailedSpatialGates",
      "demoteFailedHostStarGates",
      "demoteFailedSystemBodyGates",
      "weighOutsideStarlight",
      "demoteRegionallyRareSiblings",
      "demoteRegionallyDepleted",
      "demoteDeltahedronixOnOneSignalIcy",
      "dropUnprovenStrictSpecies",
      "restoreDemotionsBelowSignalCount",
    ]);
  });
});
