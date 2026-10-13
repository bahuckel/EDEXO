/**
 * Encyclopedia bands (plan 1.8, 2026-10-11): per-atmosphere 5/25/50/75/95 % bands and within-genus
 * shares from `data/exomastery/species-bands.json` reach the card; the charts say "most at" where a
 * band exists instead of a mode; the body's atmosphere, volcanism and host meet the file's keys.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { guideBands, type GuideBands } from "../src/shared/fieldGuide.js";
import { GuideBandsBlock, GuideMeasuredBlock, GuideWithinBlock, guideBodyFrom } from "../src/client/FieldGuide.js";
import { buildFieldGuide } from "../src/server/fieldGuide.js";
import { buildEncyclopediaPayload, getCachedSpeciesDatabase } from "../src/server/snapshot.js";
import { getProjectRoot } from "../src/server/paths.js";
import { atmosphereTypeKeyOf } from "../src/shared/scanAtmosphereMatch.js";
import type { PlanetScan } from "../src/shared/types.js";

const root = getProjectRoot();
const file = JSON.parse(readFileSync(join(root, "data", "exomastery", "species-bands.json"), "utf8")) as {
  species: Record<string, { atmo: { key: string }[] }>;
  atmoLabels: Record<string, string>;
};

const scan = (over: Partial<PlanetScan>) =>
  ({
    BodyName: "B 1",
    BodyID: 1,
    StarSystem: "B",
    SystemAddress: 1,
    PlanetClass: "Rocky body",
    Atmosphere: "thin carbon dioxide atmosphere",
    AtmosphereType: "CarbonDioxide",
    Volcanism: "",
    SurfaceGravity: 0.13 * 9.80665,
    SurfaceTemperature: 177,
    SurfacePressure: 3546,
    distanceFromArrivalLs: 2500,
    ...over,
  }) as PlanetScan;

describe("encyclopedia bands", () => {
  it("has bands only for species the app knows, keyed as the app keys a journal atmosphere", () => {
    buildEncyclopediaPayload();
    const ids = new Set(getCachedSpeciesDatabase().species.map((e) => e.id));
    for (const id of Object.keys(file.species)) expect(ids.has(id), id).toBe(true);
    // Every atmosphere key in the file is what the app makes of the journal's AtmosphereType.
    const journal: Record<string, string> = {
      carbondioxide: "CarbonDioxide",
      sulphurdioxide: "SulfurDioxide",
      neonrich: "NeonRich",
      argonrich: "ArgonRich",
      carbondioxiderich: "CarbonDioxideRich",
      methanerich: "MethaneRich",
      waterrich: "WaterRich",
    };
    const keys = new Set(Object.values(file.species).flatMap((s) => s.atmo.map((a) => a.key)));
    for (const k of keys) {
      if (k === "none") continue;
      const type = journal[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
      expect(atmosphereTypeKeyOf(scan({ AtmosphereType: type })), k).toBe(k);
    }
  });

  it("reaches the field guide with its within-genus shares", () => {
    const guide = buildFieldGuide(root, getCachedSpeciesDatabase());
    const arcus = guide.genera.find((g) => g.id === "aleoida")!.species.find((s) => s.name === "Aleoida arcus")!;
    const b = arcus.bands!;
    expect(b.n).toBeGreaterThan(1000);
    const co2 = b.atmo.find((a) => a.key === "carbondioxide")!;
    const t = co2.bands["body.surfaceTemperature"]!;
    expect(t).toHaveLength(5);
    expect([...t].sort((x, y) => x - y)).toEqual(t);
    expect(t[0]).toBeGreaterThanOrEqual(170);
    expect(t[4]).toBeLessThan(185);
    // Arcus is never the Aleoida on an ammonia world.
    const ammonia = b.within!.atmosphere.find((r) => r.key === "ammonia")!;
    expect(ammonia.n).toBe(0);
    expect(ammonia.genusN).toBeGreaterThan(100);
  });

  it("draws the body's atmosphere first with its value, and the charts say most-at rather than mode", () => {
    const b: GuideBands = guideBands(
      {
        n: 500,
        all: { "body.surfaceTemperature": [175, 176, 177, 178, 180] },
        atmo: [
          { key: "ammonia", label: "thin ammonia", n: 300, "body.surfaceTemperature": [160, 165, 168, 170, 175] },
          { key: "carbondioxide", label: "thin carbon dioxide", n: 200, "body.surfaceTemperature": [175, 176, 177, 178, 180] },
        ],
        within: { genus: "Aleoida", genusN: 900, atmosphere: [["carbondioxide", 600, 200]], volcanism: [["none", 900, 500]], host: [] },
      },
      { carbondioxide: "carbon dioxide" },
    )!;
    const body = guideBodyFrom(scan({}), null, { parentStarType: "K3" }, "1")!;
    expect(body.atmoKey).toBe("carbondioxide");
    expect(body.volcFamily).toBe("none");
    const html = renderToStaticMarkup(createElement(GuideBandsBlock, { b, body }));
    expect(html.indexOf("thin carbon dioxide")).toBeLessThan(html.indexOf("thin ammonia"));
    expect(html).toContain("this body&#x27;s atmosphere");
    // The words, not the classes on them (the block is in tw: utilities since plan 3.4).
    expect(html.replace(/ class="[^"]*"/g, "")).toContain("175–180 K</b> on thin carbon dioxide, most at <b>176–178 K");
    expect(html).toContain("this body 177 K");

    const within = renderToStaticMarkup(createElement(GuideWithinBlock, { b, name: "Aleoida arcus", body }));
    expect(within).toContain("carbon dioxide");
    expect(within).toContain('class="fg-within--mine"');

    const m = {
      bodies: 500,
      planet: [],
      atmosphere: [],
      volcanism: [],
      star: [],
      locked: null,
      materials: [],
      hist: { "body.surfaceTemperature": { min: 170, max: 185, mode: 176, mean: 177, n: 500, counts: [1, 2, 3, 4] } },
    };
    const charts = renderToStaticMarkup(createElement(GuideMeasuredBlock, { m, body, bands: b }));
    expect(charts).toContain("most at <b>176–178 K</b>");
    expect(charts).not.toMatch(/mode <b>/);
    // No band for the parameter: the middle half is read off the chart's own bins, never the mode.
    const bins = renderToStaticMarkup(createElement(GuideMeasuredBlock, { m, body, bands: null }));
    expect(bins).toContain("most at <b>177–183 K</b>");
    expect(bins).not.toMatch(/mode <b>/);
  });

  it("keys the body's atmosphere from the text when the scan has no type", () => {
    const k = (Atmosphere: string) => guideBodyFrom(scan({ AtmosphereType: undefined, Atmosphere }), null, null, "1")!.atmoKey;
    expect(k("thin neon rich atmosphere")).toBe("neonrich");
    expect(k("thin sulfur dioxide atmosphere")).toBe("sulphurdioxide");
    expect(k("")).toBe("none");
    expect(k("No atmosphere")).toBe("none");
  });
});
