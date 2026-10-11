/**
 * Why this chance (plan 1.7, 2026-10-11): the facts behind a shown row's number. Read only: the
 * percentages are not touched; the genus line says how often the genus grows on bodies like this one;
 * two species of one genus get mirrored field reasons; and the row's hover text lists them.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import type { BodyExoState, PlanetScan, SpeciesMatch } from "../src/shared/types.js";
import { explainChances } from "../src/server/chanceWhy.js";
import { chanceWhyText } from "../src/client/ChanceWhyList.js";

const root = path.resolve(__dirname, "..");
const scan = {
  PlanetClass: "Rocky body",
  Atmosphere: "thin carbon dioxide atmosphere",
  AtmosphereType: "CarbonDioxide",
  AtmosphereComposition: [{ Name: "CarbonDioxide", Percent: 100 }],
  Volcanism: "",
  SurfaceTemperature: 182,
  SurfaceGravity: 1.3,
  SurfacePressure: 3000,
  MassEM: 0.02,
  Radius: 1_800_000,
  DistanceFromArrivalLS: 900,
  SemiMajorAxis: 9e9,
  Parents: [{ Star: 0 }],
} as unknown as PlanetScan;
const splitInputs = {
  scan,
  stars: [{ bodyId: 0, starType: "K", luminosity: "Va", subclass: 3, distanceFromArrivalLs: 0 }],
  coords: { x: -1200, y: 30, z: 2600 },
  signals: 4,
  catalogue: null,
  root,
};
const row = (id: string, genus: string, pct: number) =>
  ({ entry: { id, genus, genusDataDir: genus.toLowerCase(), displayName: id }, reasons: [], presenceProbabilityPercent: pct }) as unknown as SpeciesMatch;

describe("why this chance", () => {
  it("gives the genus line, mirrored field reasons for two of a genus, and leaves the numbers alone", () => {
    const m = [row("concha_concha_labiata", "Concha", 36), row("concha_concha_renibus", "Concha", 4), row("frutexa_frutexa_fera", "Frutexa", 50)];
    const body = { biologicalSignals: 4, genusHints: [], systemAddress: 1, bodyId: 2 } as unknown as BodyExoState;
    explainChances(m, body, { scan, rec: null, ctx: { parentStarType: "K" }, journalHost: null }, root, {
      splitGenera: new Set(["Concha"]),
      splitInputs,
    });
    expect(m.map((x) => x.presenceProbabilityPercent)).toEqual([36, 4, 50]);
    for (const x of m) expect(x.chanceWhy?.find((l) => l.kind === "genus")?.label).toMatch(/bodies like this/);
    const fieldsOf = (x: SpeciesMatch) => new Map((x.chanceWhy ?? []).filter((l) => l.kind === "field").map((l) => [l.label, l.weight!]));
    const lab = fieldsOf(m[0]!);
    const ren = fieldsOf(m[1]!);
    expect(lab.size).toBeGreaterThan(0);
    // Two species: each reason pushes one up exactly as far as it pushes the other down.
    for (const [label, w] of lab) if (ren.has(label)) expect(ren.get(label)).toBeCloseTo(-w, 1);
    // A genus with one shown row has nothing to be set against.
    expect(fieldsOf(m[2]!).size).toBe(0);
    expect(chanceWhyText(m[0]!)).toContain("Against the other Concha here:");
  });
});
