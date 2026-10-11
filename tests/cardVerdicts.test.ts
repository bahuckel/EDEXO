/**
 * Encyclopedia cards graded by the matcher (plan 1.10, code review B9): a card takes the tier of the
 * matcher's own reasons on the body, a tagged reason grades its own card, and a card the matcher does
 * not grade is never red.
 */
import { describe, expect, it } from "vitest";
import { cardVerdictsFor, cardVerdictsFromReasons } from "../src/server/cardVerdicts.js";
import { buildEncyclopediaPayload, getCachedSpeciesDatabase } from "../src/server/snapshot.js";
import { applyCardVerdicts, buildEncyclopediaSpawnConditionCards } from "../src/shared/speciesSpawnConditionCards.js";
import type { PlanetScan } from "../src/shared/types.js";

const entry = (id: string) => {
  buildEncyclopediaPayload();
  const e = getCachedSpeciesDatabase().species.find((x) => x.id === id);
  if (!e) throw new Error(id);
  return e;
};

const scan = (over: Partial<PlanetScan>): PlanetScan =>
  ({
    BodyName: "B 1",
    BodyID: 1,
    StarSystem: "B",
    SystemAddress: 1,
    PlanetClass: "Rocky body",
    Atmosphere: "thin carbon dioxide atmosphere",
    AtmosphereType: "CarbonDioxide",
    atmosphereComposition: [{ Name: "CarbonDioxide", Percent: 100 }],
    Volcanism: "",
    Landable: true,
    SurfaceGravity: 0.13 * 9.80665,
    SurfaceTemperature: 177,
    SurfacePressure: 3546,
    ...over,
  }) as PlanetScan;

describe("cards graded by the matcher", () => {
  it("takes the worst reason per card, a tagged reason on its own card", () => {
    const v = cardVerdictsFromReasons(
      [
        { field: "StarType", card: "supported-star-types", soft: true, detail: "Genus colour table has no variant for host class Y." },
        { field: "AtmosphereType", detail: "Codex lists Ammonia; got CarbonDioxide" },
      ],
      [
        { field: "StarType", detail: "K" },
        { field: "PlanetClass", detail: "Rocky body" },
        { field: "Genus", detail: "The DSS named this genus" },
      ],
    );
    expect(v["supported-star-types"]!.tier).toBe("yellow");
    expect(v["parent-star-type"]!.tier).toBe("blue");
    expect(v["atmosphere-type"]!.tier).toBe("red");
    expect(v["planet-class"]!.tier).toBe("blue");
    expect(Object.keys(v)).not.toContain("Genus");
  });

  it("only the matcher can make a card red", () => {
    const cards = [
      { id: "planet-class", label: "Planet class", lines: [], caption: "This body: HMC — not listed", tier: "red" as const },
      { id: "supported-star-types", label: "Supported star types", lines: [], caption: "No colour for this body's star class", tier: "red" as const },
      { id: "starlight", label: "Starlight", lines: [], caption: "ok", tier: "blue" as const },
    ];
    const out = applyCardVerdicts(cards, { "planet-class": { tier: "yellow", detail: "Codex lists Rocky body; journal has HMC." } });
    expect(out[0]).toMatchObject({ tier: "yellow", caption: "Codex lists Rocky body; journal has HMC." });
    expect(out[1]!.tier).toBe("yellow");
    expect(out[1]!.caption).toMatch(/not a reason the app excludes it/);
    expect(out[2]).toBe(cards[2]);
    expect(applyCardVerdicts(cards, null)).toBe(cards);
  });

  it("grades a real species on a real scan: a soft miss yellow, a wall red", () => {
    const arcus = entry("aleoida_aleoida_arcus");
    const ctx = { parentStarType: "K" };
    const ok = cardVerdictsFor(arcus, scan({}), null, ctx);
    expect(ok["atmosphere-type"]!.tier).toBe("blue");
    expect(ok["surface-temperature"]!.tier).toBe("blue");
    // Off its listed atmosphere: the matcher demotes, so the card is yellow, not red.
    const methane = scan({ Atmosphere: "thin methane atmosphere", AtmosphereType: "Methane", atmosphereComposition: [{ Name: "Methane", Percent: 100 }] });
    expect(cardVerdictsFor(arcus, methane, null, ctx)["atmosphere-type"]!.tier).toBe("yellow");
    // Far outside the codex temperature band is a wall.
    const flat = scan({ SurfaceTemperature: 260 });
    const bad = cardVerdictsFor(arcus, flat, null, ctx);
    expect(bad["surface-temperature"]!.tier).toBe("red");
    const cards = applyCardVerdicts(
      buildEncyclopediaSpawnConditionCards({ entry: arcus, scan: flat, estimatedSurfaceTempK: null, speciesMatchContext: ctx }),
      bad,
    );
    expect(cards.find((c) => c.id === "surface-temperature")!.tier).toBe("red");
    // Every red card left is one the matcher walls on.
    for (const c of cards) if (c.tier === "red") expect(bad[c.id]?.tier).toBe("red");
  });
});
