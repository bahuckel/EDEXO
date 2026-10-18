/**
 * The galaxy map's system finder (plan docs/plan-finder-1.2.20.md): the file reader (the same layout
 * docs/perf/build_finder.py writes) and the search — radius from the nearest reference, every filter a floor,
 * the colonised and claimed hidden, sorting, the limit, the time budget.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FINDER_FLAG, normaliseFinderQuery, type FinderQuery } from "../src/shared/finder.js";
import { FinderIndex } from "../src/server/finderIndex.js";
import { RefGrid, colonisedRefs, findInFinder, searchFinder } from "../src/server/finderSearch.js";
import { writeFinder, type Sys } from "./helpers/finderFixture.js";

const dir = mkdtempSync(path.join(tmpdir(), "edexo-finder-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Round Sol: a colony at the origin, systems at known distances along x.
const at = (x: number, y = 0, z = 0) => ({ x, y, z });
const SYSTEMS: Sys[] = [
  { id: 1n, name: "Colony Home", ...at(0), listed: 5, u8: { flags: FINDER_FLAG.populated | FINDER_FLAG.colonised, planets: 4, stars: 1 } },
  { id: 2n, name: "Near ELW", ...at(10), listed: 6, bodyCount: 6, u8: { elw: 1, planets: 5, stars: 1, landable: 3, bio: 2, gg1: 1, flags: FINDER_FLAG.fullyScanned, mainStar: 4 }, starMask: 1 << 4 },
  { id: 3n, name: "Far ELW", ...at(140), listed: 20, u8: { elw: 2, planets: 18, stars: 2, gg2: 2, gg_water_life: 1, mainStar: 5 }, starMask: (1 << 5) | (1 << 16) },
  { id: 4n, name: "Too Far", ...at(160), listed: 30, u8: { elw: 3, planets: 29, mainStar: 5 } },
  { id: 5n, name: "Claimed One", ...at(20), listed: 9, u8: { elw: 1, planets: 8, flags: FINDER_FLAG.claimed } },
  { id: 6n, name: "Frontier Town", ...at(25), listed: 9, u8: { elw: 1, planets: 8, flags: FINDER_FLAG.populated | FINDER_FLAG.frontier } },
  { id: 7n, name: "Behind Block Edge", ...at(-149), listed: 3, u8: { rocky: 3, planets: 3 } },
  { id: 8n, name: "Second Colony", ...at(1000), listed: 2, u8: { flags: FINDER_FLAG.populated | FINDER_FLAG.colonised } },
  { id: 9n, name: "Near Second", ...at(1012), listed: 4, u8: { elw: 1, planets: 3 } },
];
const file = path.join(dir, "finder.bin");
writeFinder(file, SYSTEMS);
const index = FinderIndex.open(file);
const q = (over: Partial<FinderQuery>): FinderQuery => normaliseFinderQuery({ radiusLy: 150, ...over });
const fast = { yieldEvery: async () => {} };
const home = [{ name: "Colony Home", x: 0, y: 0, z: 0 }];

describe("the finder file", () => {
  it("reads the header, the block table and a block's columns", async () => {
    expect(index.meta.count).toBe(SYSTEMS.length);
    expect(index.blocks.reduce((a, b) => a + b.count, 0)).toBe(SYSTEMS.length);
    const all = await Promise.all(index.blocks.map((_, i) => index.block(i)));
    const names = all.flatMap((b) => b.names());
    expect(names.sort()).toEqual(SYSTEMS.map((s) => s.name).sort());
    const blk = all.find((b) => b.names().includes("Far ELW"))!;
    const j = blk.names().indexOf("Far ELW");
    expect(blk.id64[j]).toBe(3n);
    expect(blk.u8.gg2![j]).toBe(2);
    expect(blk.listed[j]).toBe(20);
    expect(blk.bodyCount[j]).toBe(0xffff);
  });
});

describe("the reference grid", () => {
  it("finds the nearest reference within the radius only", () => {
    const g = new RefGrid([{ name: "a", x: 0, y: 0, z: 0 }, { name: "b", x: 100, y: 0, z: 0 }], 50);
    expect(g.nearest(70, 0, 0)?.ref.name).toBe("b");
    expect(g.nearest(70, 0, 0)?.d).toBeCloseTo(30, 5);
    expect(g.nearest(50, 0, 0)?.d).toBeCloseTo(50, 5);
    expect(g.nearest(0, 51, 0)).toBeNull();
  });
});

describe("searchFinder", () => {
  it("keeps the radius, hides the colonised, claimed and Frontier's own, nearest first", async () => {
    const r = await searchFinder(index, q({ min: { elw: 1 } }), home, fast);
    expect(r.hits.map((h) => h.name)).toEqual(["Near ELW", "Far ELW"]);
    expect(r.hits[0]!.distLy).toBeCloseTo(10, 2);
    expect(r.hits[0]!.reference).toBe("Colony Home");
    expect(r.matched).toBe(2);
    const shown = await searchFinder(index, q({ min: { elw: 1 }, hideClaimed: false }), home, fast);
    expect(shown.hits.map((h) => h.name)).toEqual(["Near ELW", "Claimed One", "Frontier Town", "Far ELW"]);
    expect(shown.hits.find((h) => h.name === "Claimed One")!.claimed).toBe(true);
  });

  it("radius is inclusive and stops where it says", async () => {
    const r15 = await searchFinder(index, q({ radiusLy: 15, min: { elw: 1 } }), home, fast);
    expect(r15.hits.map((h) => h.name)).toEqual(["Near ELW"]);
    const r140 = await searchFinder(index, q({ radiusLy: 140, min: { elw: 1 } }), home, fast);
    expect(r140.hits.map((h) => h.name)).toEqual(["Near ELW", "Far ELW"]);
  });

  it("reads systems in a neighbouring block (the box test, not the block's own cell)", async () => {
    const r = await searchFinder(index, q({ min: { rocky: 1 } }), home, fast);
    expect(r.hits.map((h) => h.name)).toEqual(["Behind Block Edge"]);
  });

  it("every filter is a floor; derived ones add up", async () => {
    const names = async (over: Partial<FinderQuery>) =>
      (await searchFinder(index, q(over), home, fast)).hits.map((h) => h.name);
    expect(await names({ min: { elw: 2 } })).toEqual(["Far ELW"]);
    expect(await names({ min: { gg_any: 3 } })).toEqual(["Far ELW"]); // 2 class II + 1 water-based life
    expect(await names({ min: { gg_any: 1, landable: 3 } })).toEqual(["Near ELW"]);
    expect(await names({ min: { bodies: 10 } })).toEqual(["Far ELW"]);
    expect(await names({ min: { bio: 1 } })).toEqual(["Near ELW"]);
    expect(await names({ fullyScanned: true })).toEqual(["Near ELW"]);
    expect(await names({ mainStar: ["K"] })).toEqual(["Far ELW"]);
    expect(await names({ starsPresent: ["H"] })).toEqual(["Far ELW"]);
    expect(await names({ starsPresent: ["H", "G"] })).toEqual(["Near ELW", "Far ELW"]);
  });

  it("sorts by bodies and keeps to the limit, counting every match", async () => {
    const r = await searchFinder(index, q({ sort: "bodies", limit: 1 }), home, fast);
    expect(r.hits.map((h) => h.name)).toEqual(["Far ELW"]);
    expect(r.matched).toBe(3);
  });

  it("measures from the nearest of several references", async () => {
    const refs = [...home, { name: "Second Colony", x: 1000, y: 0, z: 0 }];
    const r = await searchFinder(index, q({ min: { elw: 1 } }), refs, fast);
    expect(r.hits.map((h) => [h.name, h.reference])).toEqual([
      ["Near ELW", "Colony Home"],
      ["Near Second", "Second Colony"],
      ["Far ELW", "Colony Home"],
    ]);
  });

  it("hides what the commander knows is claimed, by name or id", async () => {
    const r = await searchFinder(index, q({ min: { elw: 1 } }), home, {
      ...fast,
      knownClaimed: { ids: new Set(["3"]), names: new Set(["near elw"]) },
    });
    expect(r.hits).toEqual([]);
  });

  it("says what is missing instead of searching nothing, and stops at its budget", async () => {
    expect((await searchFinder(index, q({}), [], fast)).problem).toBe("no reference systems");
    let t = 0;
    const r = await searchFinder(index, q({}), home, { ...fast, budgetMs: 5, now: () => (t += 10) });
    expect(r.partial).toBe(true);
  });

  it("all colonised = the file's colonised systems; a name looked up in the file", async () => {
    const refs = await colonisedRefs(index, async () => {});
    expect(refs.map((r) => r.name).sort()).toEqual(["Colony Home", "Second Colony"]);
    expect(await findInFinder(index, "far elw", async () => {})).toMatchObject({ name: "Far ELW", x: 140 });
    expect(await findInFinder(index, "nowhere", async () => {})).toBeNull();
  });

  it("all colonised reads the stored distance and lists the same as measuring, reference named", async () => {
    const refs = await colonisedRefs(index, async () => {});
    for (const over of [{ min: { elw: 1 } }, { radiusLy: 15 }, { sort: "bodies" as const }]) {
      const measured = await searchFinder(index, q(over), refs, fast);
      const stored = await searchFinder(index, q(over), refs, { ...fast, precomputedColonised: true });
      expect(stored.hits.map((h) => [h.name, h.reference, h.distLy])).toEqual(
        measured.hits.map((h) => [h.name, h.reference, h.distLy]),
      );
      expect(stored.matched).toBe(measured.matched);
    }
  });

  it("many references take the grid path and find the same", async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ name: `r${i}`, x: 5000 + i, y: 0, z: 0 }));
    const r = await searchFinder(index, q({ min: { elw: 1 } }), [...many, ...home], fast);
    expect(r.hits.map((h) => h.name)).toEqual(["Near ELW", "Far ELW"]);
  });
});

describe("normaliseFinderQuery", () => {
  it("clamps the radius to 15-150 in steps of 5 and drops unknown filters", () => {
    expect(normaliseFinderQuery({ radiusLy: 3 }).radiusLy).toBe(15);
    expect(normaliseFinderQuery({ radiusLy: 999 }).radiusLy).toBe(150);
    expect(normaliseFinderQuery({ radiusLy: 42 }).radiusLy).toBe(40);
    const n = normaliseFinderQuery({ min: { elw: 2, nope: 5, ww: -1 } as never, limit: 99999 });
    expect(n.min).toEqual({ elw: 2 });
    expect(n.limit).toBe(1000);
    expect(n.hideClaimed).toBe(true);
    expect(n.reference).toBe("mine");
  });
});
