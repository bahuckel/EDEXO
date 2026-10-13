import { mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNoticesService, type NoticesContext } from "../src/server/notices.js";
import { DEFAULT_NOTIFY_PREFS, mergeNotifyPrefs } from "../src/shared/notices.js";
import { JumponiumIndex, filterKeep } from "../src/server/jumponiumIndex.js";
import { parseJumpFilter } from "../src/server/routes/jumponiumRoutes.js";
import { routeInjections } from "../src/server/neutronRoute.js";
import {
  bodyJumponium,
  craftable,
  hydrateJumponium,
  injectionsToSaveJump,
  jumponiumLine,
  newJumponium,
  recipeFor,
} from "../src/shared/jumponium.js";

const at = (t: string, o: Record<string, unknown>) => ({ timestamp: t, ...o });
const login = (raw: Record<string, number>) =>
  at("2026-10-13T10:00:00Z", {
    event: "Materials",
    Raw: Object.entries(raw).map(([Name, Count]) => ({ Name, Count })),
    Manufactured: [],
    Encoded: [],
  });

describe("jumponium inventory", () => {
  it("knows nothing before a login, then follows the material events", () => {
    const st = newJumponium();
    jumponiumLine(
      st,
      at("2026-10-13T09:00:00Z", { event: "MaterialCollected", Category: "Raw", Name: "polonium", Count: 3 }),
    );
    expect(st.raw).toBeNull();
    jumponiumLine(st, login({ carbon: 10, polonium: 2, yttrium: 1 }));
    jumponiumLine(
      st,
      at("2026-10-13T10:05:00Z", { event: "MaterialCollected", Category: "Raw", Name: "polonium", Count: 3 }),
    );
    jumponiumLine(
      st,
      at("2026-10-13T10:06:00Z", {
        event: "MaterialCollected",
        Category: "Manufactured",
        Name: "polonium",
        Count: 9,
      }),
    );
    jumponiumLine(
      st,
      at("2026-10-13T10:07:00Z", { event: "MaterialDiscarded", Category: "Raw", Name: "carbon", Count: 4 }),
    );
    jumponiumLine(
      st,
      at("2026-10-13T10:08:00Z", {
        event: "MaterialTrade",
        TraderType: "raw",
        Paid: { Material: "carbon", Category: "Raw", Quantity: 6 },
        Received: { Material: "arsenic", Category: "Raw", Quantity: 1 },
      }),
    );
    expect(st.raw).toMatchObject({ carbon: 0, polonium: 5, yttrium: 1, arsenic: 1 });
  });

  it("caps raw by grade and never goes below zero", () => {
    const st = newJumponium();
    jumponiumLine(st, login({ polonium: 149, carbon: 299 }));
    jumponiumLine(
      st,
      at("2026-10-13T10:01:00Z", { event: "MaterialCollected", Category: "Raw", Name: "polonium", Count: 5 }),
    );
    jumponiumLine(
      st,
      at("2026-10-13T10:02:00Z", { event: "MaterialCollected", Category: "Raw", Name: "carbon", Count: 5 }),
    );
    jumponiumLine(
      st,
      at("2026-10-13T10:03:00Z", {
        event: "EngineerCraft",
        Ingredients: [
          { Name: "yttrium", Count: 4 },
          { Name: "heatexchangers", Count: 2 },
        ],
      }),
    );
    expect(st.raw).toMatchObject({ polonium: 150, carbon: 300, yttrium: 0 });
    expect(st.raw!.heatexchangers).toBeUndefined();
  });

  it("a premium injection uses its materials, is counted, and its recipe is learned", () => {
    const st = newJumponium();
    jumponiumLine(st, login({ carbon: 5, germanium: 5, arsenic: 5, niobium: 5, yttrium: 5, polonium: 5 }));
    const mats = ["carbon", "germanium", "arsenic", "niobium", "yttrium", "polonium"].map((Name) => ({
      Name,
      Count: Name === "niobium" ? 2 : 1,
    }));
    jumponiumLine(
      st,
      at("2026-10-13T10:10:00Z", { event: "Synthesis", Name: "FSD Premium", Materials: mats }),
    );
    expect(st.made.premium).toBe(1);
    expect(st.raw).toMatchObject({ carbon: 4, niobium: 3, polonium: 4 });
    expect(recipeFor(st, "premium").niobium).toBe(2);
    // 3 niobium at 2 each: one more premium, short of 1 niobium for the next.
    expect(craftable(st, "premium")).toEqual({ count: 1, short: { niobium: 1 } });
  });

  it("counts what each tier can make and what the next one needs", () => {
    const st = newJumponium();
    jumponiumLine(st, login({ carbon: 40, vanadium: 12, germanium: 1, cadmium: 8 }));
    expect(craftable(st, "basic")).toEqual({ count: 1, short: { germanium: 1 } });
    expect(craftable(st, "standard")).toEqual({ count: 0, short: { niobium: 1 } });
    expect(craftable(st, "premium")).toEqual({
      count: 0,
      short: { arsenic: 1, niobium: 1, yttrium: 1, polonium: 1 },
    });
  });

  it("survives the journal cache and drops what is not its shape", () => {
    const st = newJumponium();
    jumponiumLine(st, login({ polonium: 7 }));
    st.made.basic = 2;
    st.learned.basic = { carbon: 1, vanadium: 1, germanium: 1 };
    expect(hydrateJumponium(JSON.parse(JSON.stringify(st)))).toEqual(st);
    expect(
      hydrateJumponium({ raw: { polonium: "x" }, learned: { premium: { iron: 3 } }, made: { basic: -1 } }),
    ).toEqual({
      raw: {},
      loginAt: null,
      learned: {},
      made: {},
    });
    expect(hydrateJumponium(null)).toEqual(newJumponium());
  });
});

describe("a body's jumponium", () => {
  it("reads the scan's materials in any case, marks the top tenth, and the tiers it covers", () => {
    const b = bodyJumponium([
      { Name: "carbon", Percent: 20 },
      { name: "Vanadium", percent: 4 },
      { Name: "germanium", Percent: 5.9 },
      { Name: "cadmium", Percent: 1.2 },
      { Name: "niobium", Percent: 1.1 },
      { Name: "polonium", Percent: 0.9 },
      { Name: "iron", Percent: 18 },
    ]);
    expect(b!.hits.map((h) => [h.key, h.good])).toEqual([
      ["carbon", false],
      ["vanadium", false],
      ["germanium", true],
      ["cadmium", false],
      ["niobium", false],
      ["polonium", true],
    ]);
    expect(b!.tiers).toEqual(["basic", "standard"]);
  });

  it("is null for a body without a list or without jumponium", () => {
    expect(bodyJumponium(undefined)).toBeNull();
    expect(bodyJumponium([])).toBeNull();
    expect(bodyJumponium([{ Name: "iron", Percent: 30 }])).toBeNull();
  });
});

describe("jumponium notices (1.2.16)", () => {
  const SYS = "Blatrimpe";
  const ADDR = 7505623126738;
  const ctx = (stock: Record<string, number> | null): NoticesContext => ({
    isKnownBody: () => false,
    allScans: function* () {},
    currentSystem: () => ({ name: SYS, address: ADDR }),
    rawStock: () => stock,
  });
  const scan = (bodyId: number, materials: { Name: string; Percent: number }[], extra: Record<string, unknown> = {}) => ({
    timestamp: "2026-10-13T12:00:00Z",
    event: "Scan",
    ScanType: "Detailed",
    StarSystem: SYS,
    SystemAddress: ADDR,
    BodyID: bodyId,
    BodyName: `${SYS} ${bodyId}`,
    PlanetClass: "Rocky body",
    Landable: true,
    SurfaceGravity: 2.05,
    DistanceFromArrivalLS: 1120.4,
    Materials: materials,
    ...extra,
  });

  it("announces a rich element he is short of, with gravity, distance and what is aboard", () => {
    const n = createNoticesService({ filePath: null });
    expect(n.observe(scan(3, [{ Name: "polonium", Percent: 1.12 }, { Name: "germanium", Percent: 4.0 }]), ctx({ polonium: 4 }))).toBe(true);
    const [item] = n.list();
    expect(item).toMatchObject({ kind: "jumponium", title: "Jumponium: Po 1.12 %", body: "3" });
    expect(item!.text).toBe(`3 in ${SYS} — 0.21 g, 1,120 ls · aboard Po 4`);
  });

  it("stays quiet for what he has enough of, for a poor or unlandable body, and when off; always means always", () => {
    const n = createNoticesService({ filePath: null });
    const rich = [{ Name: "polonium", Percent: 1.12 }];
    expect(n.observe(scan(4, rich), ctx({ polonium: 30 }))).toBe(false);
    expect(n.observe(scan(5, [{ Name: "polonium", Percent: 0.3 }]), ctx({}))).toBe(false);
    expect(n.observe(scan(6, rich, { Landable: false }), ctx({}))).toBe(false);
    n.setPrefs({ jumponium: { mode: "off", target: 30 } });
    expect(n.observe(scan(7, rich), ctx({}))).toBe(false);
    n.setPrefs({ jumponium: { mode: "always", target: 30 } });
    expect(n.observe(scan(8, rich), ctx({ polonium: 150 }))).toBe(true);
    // Stock unknown (no login yet): everything counts as short.
    n.setPrefs({ jumponium: { mode: "short", target: 30 } });
    expect(n.observe(scan(9, rich), ctx(null))).toBe(true);
  });

  it("keeps the prefs in range", () => {
    expect(mergeNotifyPrefs(DEFAULT_NOTIFY_PREFS, { jumponium: { mode: "loud", target: 9999 } }).jumponium).toEqual({ mode: "short", target: 300 });
    expect(mergeNotifyPrefs(DEFAULT_NOTIFY_PREFS, {}).jumponium).toEqual({ mode: "short", target: 30 });
  });
});

describe("the galaxy map's filter", () => {
  const body = (pct: Record<string, number>, gravityG = 0.2, distLs = 500) => ({ pct, gravityG, distLs });
  it("any or all of the picked elements, at the chosen level, within gravity and distance", () => {
    const f = (q: Record<string, unknown>) => filterKeep(parseJumpFilter(q));
    const b = body({ polonium: 0.8, yttrium: 1.0 });
    expect(f({ els: "polonium|yttrium", level: "rich" })(b)).toBe(true); // Po is rich (≥ 0.64)
    expect(f({ els: "polonium|yttrium", level: "rich", all: "1" })(b)).toBe(false); // Y is not (< 1.35)
    expect(f({ els: "polonium", level: "top" })(b)).toBe(false); // top 1 % is ≥ 1.07
    expect(f({ els: "polonium,yttrium", level: "any", all: "1" })(b)).toBe(true);
    expect(f({ els: "polonium", maxG: "0.1" })(b)).toBe(false);
    expect(f({ els: "polonium", maxLs: "100" })(b)).toBe(false);
    // Nothing picked: any of the seven, carbon never.
    expect(f({ els: "carbon", level: "rich" })(body({ carbon: 30 }))).toBe(false);
    expect(f({})(b)).toBe(true);
  });
});

describe("the galaxy file", () => {
  it("reads back what docs/perf/build_jumponium.py writes: position, elements, names, nearest first", () => {
    const dir = mkdtempSync(join(tmpdir(), "jmp-"));
    const file = join(dir, "jumponium.bin");
    // One cell, two bodies; names stored (the addresses are not procedural ones in a known sector).
    const meta = Buffer.from(JSON.stringify({ bodies: 2, systems: 2 }));
    const strs: Buffer[] = [];
    let off = 0;
    const str = (s: string) => {
      const b = Buffer.from(s, "utf8");
      const at = off;
      strs.push(Buffer.from([b.length]), b);
      off += 1 + b.length;
      return at;
    };
    const rec = (rel: [number, number, number], bodyId: number, g: number, ls: number, el: number[], name: number, id64: bigint) => {
      const r = Buffer.alloc(32);
      r.writeUInt16LE(rel[0], 0);
      r.writeUInt16LE(rel[1], 2);
      r.writeUInt16LE(rel[2], 4);
      r[6] = bodyId;
      r[7] = 0;
      r.writeUInt16LE(g, 8);
      r.writeUInt16LE(ls, 10);
      el.forEach((v, j) => (r[12 + j] = v));
      r.writeUInt32LE(name, 20);
      r.writeBigUInt64LE(id64, 24);
      return r;
    };
    const nA = str("A 1"),
      nB = str("=Odd Body"),
      sA = str("Alpha"),
      sB = str("Beta");
    // Cell (39, 32, 18) holds Sol's neighbourhood: corner = origin + cell * 1280.
    const cx = -49985 + 39 * 1280,
      cy = -40985 + 32 * 1280,
      cz = -24105 + 18 * 1280;
    const r1 = rec([(10 - cx) * 32, (0 - cy) * 32, (0 - cz) * 32], 5, 210, 112, [0, 0, 0, 0, 0, 60, 56], nA, 1n);
    const r2 = rec([(50 - cx) * 32, (0 - cy) * 32, (0 - cz) * 32], 7, 900, 5, [200, 0, 0, 0, 0, 0, 0], nB, 2n);
    const cells = Buffer.alloc(4 + 14);
    cells.writeUInt32LE(1, 0);
    cells.writeUInt16LE(39, 4);
    cells.writeUInt16LE(32, 6);
    cells.writeUInt16LE(18, 8);
    cells.writeUInt32LE(0, 10);
    cells.writeUInt32LE(2, 14);
    const named = Buffer.alloc(4 + 16);
    named.writeUInt32LE(2, 0);
    named.writeUInt32LE(0, 4);
    named.writeUInt32LE(sA, 8);
    named.writeUInt32LE(1, 12);
    named.writeUInt32LE(sB, 16);
    const head = Buffer.alloc(16);
    head.write("EDEXOJMP", 0, "latin1");
    head.writeUInt32LE(1, 8);
    head.writeUInt32LE(meta.length, 12);
    writeFileSync(file, Buffer.concat([head, meta, cells, r1, r2, named, ...strs]));
    const ix = new JumponiumIndex(openSync(file, "r"), process.cwd());
    expect(ix.count).toBe(2);
    const got = ix.near({ x: 0, y: 0, z: 0 }, 100, () => true, 10);
    expect(got.map((b) => [b.system, b.body, Math.round(b.x)])).toEqual([
      ["Alpha", "Alpha A 1", 10],
      ["Beta", "Odd Body", 50],
    ]);
    expect(got[0]).toMatchObject({ gravityG: 0.21, distLs: 1120, pct: { yttrium: 1.2, polonium: 1.12 } });
    expect(got[1]!.pct).toEqual({ vanadium: 10 });
    expect(ix.near({ x: 0, y: 0, z: 0 }, 20, () => true, 10)).toHaveLength(1);
    ix.close();
  });
});

describe("the neutron planner's gap hint", () => {
  it("names the injections, one per normal jump, that take one jump off a stretch", () => {
    // 3 jumps for 110 ly at 50 ly: 2 jumps reach 100, 10 ly short — one Basic (+12.5 ly) does it.
    expect(injectionsToSaveJump(110, 3, 50)).toEqual([
      { tier: "basic", count: 1 },
      { tier: "standard", count: 1 },
      { tier: "premium", count: 1 },
    ]);
    // 145 ly: 45 short — Basic 4 (needs at most 2), Standard 2, Premium 1.
    expect(injectionsToSaveJump(145, 3, 50)).toEqual([
      { tier: "standard", count: 2 },
      { tier: "premium", count: 1 },
    ]);
    // A single jump, or jumps that already fit with one fewer: nothing to say.
    expect(injectionsToSaveJump(40, 1, 50)).toEqual([]);
    expect(injectionsToSaveJump(100, 3, 50)).toEqual([]);
  });

  it("on a route: after a supercharge only the normal jumps count", () => {
    const hop = (x: number, jumps: number, boosted: number) =>
      ({ name: "n", x, y: 0, z: 0, kind: "neutron", jumps, boosted, distanceLy: 0, refuel: false, scoopOnWay: false, scoopLs: null, jumpsLeft: 5, fsdHealth: null }) as const;
    // R 50, boost 4: 200 supercharged + 110 normal (3 jumps, one fewer with a Basic) = 4 jumps for 310 ly.
    const out = routeInjections([hop(0, 0, 0), hop(310, 4, 1), hop(350, 1, 1)], 50, 4);
    expect(out[0]).toEqual([]);
    expect(out[1]!.map((x) => x.tier)).toEqual(["basic", "standard", "premium"]);
    expect(out[2]).toEqual([]);
  });
});
