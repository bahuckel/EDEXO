/**
 * Rare colours (1.2.19, plan F2): systems each colour variant has been logged in, from EDAstro's codex
 * (data/codex/variant-region-systems.json), the [RARE] mark and the notice.
 */
import { describe, expect, it } from "vitest";
import { codexVariantId } from "../src/server/codexFirst.js";
import { codexRegionGaps, colourRarity, nearestInRegion } from "../src/server/codexVariantCounts.js";
import { RARE_COLOUR_MAX_SYSTEMS } from "../src/shared/rareColour.js";
import { createNoticesService } from "../src/server/notices.js";
import { rareColourOf, rareColourTitle } from "../src/client/codexMark.js";
import type { SpeciesMatch } from "../src/shared/types.js";

const root = process.cwd();

describe("colour variant counts", () => {
  it("a species colour finds its codex id through EDSM's table", () => {
    expect(codexVariantId(root, "Stratum Excutitus", "Teal")).toBe("codex_ent_stratum_01_ae");
    expect(codexVariantId(root, "Stratum Excutitus", "Ultraviolet")).toBeNull();
  });

  it("a rare colour reads its systems galaxy-wide and in the region; a common one is not rare", () => {
    const [grey] = colourRarity(root, "Aleoida Arcus", "Grey", "Inner Orion Spur");
    expect(grey).toMatchObject({ colour: "Grey", galaxySystems: 1, regionSystems: 1, region: "Inner Orion Spur" });
    const [elsewhere] = colourRarity(root, "Aleoida Arcus", "Grey", "Galactic Centre");
    expect(elsewhere?.regionSystems).toBe(0);
    const [teal] = colourRarity(root, "Stratum Excutitus", "Teal", null);
    expect(teal?.regionSystems).toBeNull();
    expect(teal!.galaxySystems).toBeLessThanOrEqual(RARE_COLOUR_MAX_SYSTEMS);
  });

  it("both colours of an 'or' label are read; an unknown colour gives nothing", () => {
    expect(colourRarity(root, "Stratum Excutitus", "Teal or Ultraviolet", null).map((r) => r.colour)).toEqual(["Teal"]);
    expect(colourRarity(root, "Stratum Excutitus", "Teal or Grey", null).map((r) => r.colour)).toEqual(["Teal", "Grey"]);
    expect(colourRarity(root, "Stratum Excutitus", "(unknown)", null)).toEqual([]);
    expect(colourRarity(root, "Stratum Excutitus", null, null)).toEqual([]);
  });
});

describe("the [RARE] mark", () => {
  it("shows only colours at or under the limit, with the counts on hover", () => {
    const m = {
      entry: { displayName: "Aleoida Arcus" },
      colourRarity: [
        { colour: "Grey", galaxySystems: 1, regionSystems: 0, region: "Galactic Centre" },
        { colour: "Green", galaxySystems: 400, regionSystems: 20, region: "Galactic Centre" },
      ],
    } as unknown as SpeciesMatch;
    expect(rareColourOf(m).map((r) => r.colour)).toEqual(["Grey"]);
    expect(rareColourTitle(m)).toMatch(/^Grey Aleoida Arcus has been logged in 1 system galaxy-wide, none in Galactic Centre/);
  });
});

describe("the rare-colour notice", () => {
  const find = {
    bodyKey: "5:3",
    systemAddress: 5,
    system: "Five",
    body: "3 a",
    species: "Aleoida Arcus",
    speciesId: "aleoida-arcus",
    colour: "Grey",
    galaxySystems: 1,
    regionSystems: 0,
    region: "Tenebrae",
  };

  it("once per species, colour and body; withdrawn when the candidate leaves; off when switched off", () => {
    const n = createNoticesService({ filePath: null });
    expect(n.announceRareColours([find], "2026-10-17T12:00:00Z", new Set(["5:3"]))).toBe(true);
    expect(n.announceRareColours([find], "2026-10-17T12:01:00Z", new Set(["5:3"]))).toBe(false);
    expect(n.list()[0]).toMatchObject({ kind: "codex", title: "Rare colour possible: Aleoida Arcus (Grey)" });
    expect(n.list()[0]!.text).toBe("3 a in Five — logged in 1 system galaxy-wide, none in Tenebrae (EDAstro)");
    expect(n.announceRareColours([], "2026-10-17T12:02:00Z", new Set(["5:3"]))).toBe(true);
    expect(n.list()).toEqual([]);
    n.setPrefs({ rareColours: false });
    expect(n.announceRareColours([find], "2026-10-17T12:03:00Z", new Set(["5:3"]))).toBe(false);
  });
});

describe("codex gaps by region", () => {
  it("lists the region's colours not in your codex, rarest here first; a logged one leaves the list", () => {
    const names = new Map([["codex_ent_aleoids_01_w", "Aleoida Arcus - Grey"]]);
    const none = codexRegionGaps(root, new Set(), "Inner Orion Spur", names)!;
    expect(none.logged).toBe(0);
    expect(none.gaps.length).toBe(none.known);
    expect(none.gaps[0]!.regionSystems).toBeLessThanOrEqual(none.gaps[none.gaps.length - 1]!.regionSystems);
    const grey = none.gaps.find((g) => g.key === "codex_ent_aleoids_01_w");
    expect(grey).toMatchObject({ name: "Aleoida Arcus - Grey", regionSystems: 1, galaxySystems: 1 });
    const withGrey = codexRegionGaps(root, new Set(["innerorionspur|codex_ent_aleoids_01_w"]), "Inner Orion Spur", names)!;
    expect(withGrey.logged).toBe(1);
    expect(withGrey.gaps.some((g) => g.key === "codex_ent_aleoids_01_w")).toBe(false);
    expect(codexRegionGaps(root, new Set(), "Nowhere Special", names)).toBeNull();
  });
});

describe("nearest system in the region (a click on a codex gap)", () => {
  it("finds a system in THAT region only; another region has none of a one-system colour", () => {
    const sol = { x: 0, y: 0, z: 0 };
    const here = nearestInRegion(root, "Inner Orion Spur", "codex_ent_aleoids_01_w", sol)!;
    expect(here).toMatchObject({ known: 1, complete: true });
    expect(here.name.length).toBeGreaterThan(0);
    expect(nearestInRegion(root, "Galactic Centre", "codex_ent_aleoids_01_w", sol)).toBeNull();
  });

  it("the nearer of two known systems wins, from wherever you are", () => {
    // Stratum Excutitus - Teal: six systems galaxy-wide, one per region; pick a region that has one.
    const sol = { x: 0, y: 0, z: 0 };
    const a = nearestInRegion(root, "Inner Orion Spur", "codex_ent_stratum_01_ae", sol)!;
    const far = nearestInRegion(root, "Inner Orion Spur", "codex_ent_stratum_01_ae", { x: a.x + 5000, y: 0, z: a.z })!;
    expect(far.systemAddress).toBe(a.systemAddress);
    expect(far.distanceLy).toBeGreaterThan(a.distanceLy);
  });
});

