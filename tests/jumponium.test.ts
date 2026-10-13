import { mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNoticesService, type NoticesContext } from "../src/server/notices.js";
import { DEFAULT_NOTIFY_PREFS, mergeNotifyPrefs } from "../src/shared/notices.js";
import { JumponiumIndex, filterKeep } from "../src/server/jumponiumIndex.js";
import { parseJumpFilter } from "../src/server/routes/jumponiumRoutes.js";
import { applyJumponium, routeInjections } from "../src/server/neutronRoute.js";
import { createNeutronLive, parseLiveHops } from "../src/server/neutronLive.js";
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
      afmu: null,
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
  const scan = (
    bodyId: number,
    materials: { Name: string; Percent: number }[],
    extra: Record<string, unknown> = {},
  ) => ({
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

  const on = (n: ReturnType<typeof createNoticesService>, extra: Record<string, unknown> = {}) =>
    n.setPrefs({ jumponium: { on: true, ...extra } });

  it("is off until turned on", () => {
    const n = createNoticesService({ filePath: null });
    expect(n.observe(scan(2, [{ Name: "polonium", Percent: 1.12 }]), ctx({}))).toBe(false);
  });

  it("announces a rich element he is short of, with gravity, distance and what is aboard", () => {
    const n = createNoticesService({ filePath: null });
    on(n);
    expect(
      n.observe(
        scan(3, [
          { Name: "polonium", Percent: 1.12 },
          { Name: "germanium", Percent: 4.0 },
        ]),
        ctx({ polonium: 4 }),
      ),
    ).toBe(true);
    const [item] = n.list();
    expect(item).toMatchObject({ kind: "jumponium", title: "Jumponium (Premium): Po 1.12 %", body: "3" });
    expect(item!.text).toBe(`3 in ${SYS} — 0.21 g, 1,120 ls · aboard Po 4`);
  });

  it("stays quiet for what he has enough of, a poor or unlandable body, and an injection he does not gather for", () => {
    const n = createNoticesService({ filePath: null });
    on(n);
    const rich = [{ Name: "polonium", Percent: 1.12 }];
    expect(n.observe(scan(4, rich), ctx({ polonium: 30 }))).toBe(false);
    expect(n.observe(scan(5, [{ Name: "polonium", Percent: 0.3 }]), ctx({}))).toBe(false);
    expect(n.observe(scan(6, rich, { Landable: false }), ctx({}))).toBe(false);
    // Basic and standard only: polonium is premium's alone; germanium serves all three.
    on(n, { tiers: { basic: true, standard: true, premium: false } });
    expect(n.observe(scan(7, rich), ctx({}))).toBe(false);
    expect(n.observe(scan(8, [{ Name: "germanium", Percent: 6.1 }]), ctx({}))).toBe(true);
    expect(n.list()[0]!.title).toBe("Jumponium (Basic, Standard): Ge 6.10 %");
    // Every rich body, whatever is aboard; and with the stock unknown everything counts as short.
    on(n, { tiers: { premium: true }, onlyShort: false });
    expect(n.observe(scan(9, rich), ctx({ polonium: 150 }))).toBe(true);
    on(n, { onlyShort: true });
    expect(n.observe(scan(10, rich), ctx(null))).toBe(true);
  });

  it("never for carbon, and never for an element whose hold is full whatever the number set (review 1.2.16)", () => {
    const n = createNoticesService({ filePath: null });
    on(n, { target: 300 });
    expect(n.observe(scan(11, [{ Name: "carbon", Percent: 28 }]), ctx({}))).toBe(false);
    // Polonium caps at 150: a full hold is not short of it, even under a target of 300.
    expect(n.observe(scan(12, [{ Name: "polonium", Percent: 1.12 }]), ctx({ polonium: 150 }))).toBe(false);
    expect(n.observe(scan(13, [{ Name: "polonium", Percent: 1.12 }]), ctx({ polonium: 149 }))).toBe(true);
  });

  it("keeps the prefs in range, and does not carry a test build's shape over", () => {
    const d = DEFAULT_NOTIFY_PREFS.jumponium;
    expect(d.on).toBe(false);
    expect(
      mergeNotifyPrefs(DEFAULT_NOTIFY_PREFS, { jumponium: { on: "yes", target: 9999 } }).jumponium,
    ).toEqual({ ...d, target: 300 });
    const old = {
      ...DEFAULT_NOTIFY_PREFS,
      jumponium: { mode: "short", target: 30 },
    } as unknown as typeof DEFAULT_NOTIFY_PREFS;
    expect(mergeNotifyPrefs(old, {}).jumponium).toEqual(d);
    // An old shape sent as an update keeps nothing either, not even its target.
    expect(
      mergeNotifyPrefs(DEFAULT_NOTIFY_PREFS, { jumponium: { mode: "always", target: 99 } }).jumponium,
    ).toEqual(d);
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
  it("reads back what docs/perf/build_laboratory.py writes: position, elements, names, nearest first", () => {
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
    const rec = (
      rel: [number, number, number],
      bodyId: number,
      g: number,
      ls: number,
      el: number[],
      name: number,
      id64: bigint,
    ) => {
      const r = Buffer.alloc(40);
      r.writeUInt16LE(rel[0], 0);
      r.writeUInt16LE(rel[1], 2);
      r.writeUInt16LE(rel[2], 4);
      r[6] = bodyId;
      r[7] = 0;
      r.writeUInt16LE(g, 8);
      r.writeUInt16LE(ls, 10);
      el.forEach((v, j) => (r[12 + j] = v));
      r.writeUInt32LE(name, 28);
      r.writeBigUInt64LE(id64, 32);
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
    // V Ge As Cd Nb Y Po Zn Sn Mo Zr Te Ru.
    const r1 = rec(
      [(10 - cx) * 32, (0 - cy) * 32, (0 - cz) * 32],
      5,
      210,
      112,
      [0, 0, 0, 0, 0, 60, 56, 0, 0, 0, 0, 80, 0],
      nA,
      1n,
    );
    const r2 = rec(
      [(50 - cx) * 32, (0 - cy) * 32, (0 - cz) * 32],
      7,
      900,
      5,
      [200, 0, 0, 0, 0, 0, 0, 160, 0, 0, 0, 0, 0],
      nB,
      2n,
    );
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
    head.write("EDEXOLAB", 0, "latin1");
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
    expect(got[0]).toMatchObject({
      gravityG: 0.21,
      distLs: 1120,
      pct: { yttrium: 1.2, polonium: 1.12, tellurium: 1.6 },
    });
    expect(got[1]!.pct).toEqual({ vanadium: 10, zinc: 8 });
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
      ({
        name: "n",
        x,
        y: 0,
        z: 0,
        kind: "neutron",
        jumps,
        boosted,
        distanceLy: 0,
        refuel: false,
        scoopOnWay: false,
        scoopLs: null,
        jumpsLeft: 5,
        fsdHealth: null,
      }) as const;
    // R 50, boost 4: 200 supercharged + 110 normal (3 jumps, one fewer with a Basic) = 4 jumps for 310 ly.
    const out = routeInjections([hop(0, 0, 0), hop(310, 4, 1), hop(350, 1, 1)], 50, 4);
    expect(out[0]).toEqual([]);
    expect(out[1]!.map((x) => x.tier)).toEqual(["basic", "standard", "premium"]);
    expect(out[2]).toEqual([]);
  });
});

describe("Use Jumponium on a neutron route", () => {
  const hop = (x: number, jumps: number, boosted: number) =>
    ({
      name: `h${x}`,
      x,
      y: 0,
      z: 0,
      kind: "neutron",
      jumps,
      boosted,
      distanceLy: 0,
      refuel: false,
      scoopOnWay: false,
      scoopLs: null,
      jumpsLeft: 5,
      fsdHealth: null,
    }) as const;
  const route = (hops: ReturnType<typeof hop>[]) => ({
    hops: [...hops],
    jumps: hops.reduce((a, h) => a + h.jumps, 0),
    boosted: 0,
    distanceLy: 0,
    plainJumps: 0,
    refuels: 0,
    repairBefore: null,
    unsafeLegs: [],
  });
  it("takes the cheapest injection by material on each hop it shortens, and the jump off", () => {
    // R 50: 110 ly in 3 normal jumps (a Basic does it), then 145 ly in 3 (2 Standard = 22 or 1 Premium = 16: Premium).
    const r = route([hop(0, 0, 0), hop(110, 3, 0), hop(255, 3, 0), hop(275, 1, 0)]);
    const { route: out, plan } = applyJumponium(r, 50, 4);
    expect(out.jumps).toBe(r.jumps - 2);
    expect(out.hops.map((h) => h.inject)).toEqual([
      null,
      { tier: "basic", count: 1 },
      { tier: "premium", count: 1 },
      null,
    ]);
    expect(out.hops[1]!.jumps).toBe(2);
    expect(plan).toEqual({
      saved: 2,
      used: { basic: 1, standard: 0, premium: 1 },
      needs: { carbon: 2, vanadium: 1, germanium: 2, arsenic: 1, niobium: 1, yttrium: 1, polonium: 1 },
    });
  });

  it("the live route keeps each hop's injection, and the HUD's next stop says it", () => {
    const hops = parseLiveHops([
      { name: "A", x: 0, y: 0, z: 0, kind: "start", jumps: 0 },
      { name: "B", x: 110, y: 0, z: 0, kind: "waypoint", jumps: 2, inject: { tier: "basic", count: 1 } },
      { name: "C", x: 120, y: 0, z: 0, kind: "waypoint", jumps: 1, inject: { tier: "nope", count: 1 } },
    ])!;
    expect(hops.map((h) => h.inject)).toEqual([null, { tier: "basic", count: 1 }, null]);
    const live = createNeutronLive({ filePath: null, deliver: () => undefined });
    live.start(
      hops,
      { name: "A", pos: null },
      { targets: [{ name: "C", x: 120, y: 0, z: 0 }], rangeLy: 50, useJumponium: true },
    );
    expect(live.view({ name: "A", pos: null })?.nextInject).toEqual({ tier: "basic", count: 1 });
    expect(live.remaining()?.useJumponium).toBe(true);
  });
});

describe("the Laboratory's AFM refills (owner, 2026-10-14)", () => {
  it("counts refills by his recipes, learns a synthesis, and keeps the AFMU from the Loadout", () => {
    const st = newJumponium();
    jumponiumLine(
      st,
      login({
        nickel: 10,
        zinc: 5,
        chromium: 9,
        vanadium: 13,
        zirconium: 4,
        tellurium: 1,
        ruthenium: 2,
        tin: 1,
        manganese: 2,
        molybdenum: 1,
      }),
    );
    // Basic 2 Ni 2 Zn 2 Cr 3 V: zinc 5 → 2. Premium 2 Zn 4 Cr 6 V 2 Zr 1 Te 1 Ru: 1. Standard 1 Sn 2 Mn 6 V 1 Mo 1 Zr: 1.
    expect(craftable(st, "basic", "afm").count).toBe(2);
    expect(craftable(st, "standard", "afm").count).toBe(1);
    expect(craftable(st, "premium", "afm")).toEqual({ count: 1, short: { tellurium: 1 } });
    jumponiumLine(
      st,
      at("2026-10-14T10:00:00Z", {
        event: "Synthesis",
        Name: "AFM Refill Basic",
        Materials: [
          { Name: "nickel", Count: 2 },
          { Name: "zinc", Count: 2 },
          { Name: "chromium", Count: 2 },
          { Name: "vanadium", Count: 3 },
        ],
      }),
    );
    expect(st.raw).toMatchObject({ nickel: 8, zinc: 3, chromium: 7, vanadium: 10 });
    expect(st.made["afm:basic"]).toBe(1);
    expect(recipeFor(st, "basic", "afm")).toEqual({ nickel: 2, zinc: 2, chromium: 2, vanadium: 3 });
    // An FSD injection of the same tier is a different recipe.
    expect(recipeFor(st, "basic")).toEqual({ carbon: 1, vanadium: 1, germanium: 1 });
    jumponiumLine(
      st,
      at("2026-10-14T10:05:00Z", {
        event: "Loadout",
        Modules: [
          { Slot: "Slot04_Size1", Item: "int_repairer_size1_class4", Health: 0.99 },
          { Slot: "FrameShiftDrive", Item: "int_hyperdrive_overcharge_size5_class5", Health: 0.95 },
        ],
      }),
    );
    expect(st.afmu).toEqual([{ item: "int_repairer_size1_class4", size: 1, cls: 4, health: 0.99 }]);
    expect(hydrateJumponium(JSON.parse(JSON.stringify(st)))).toEqual(st);
  });

  it("a body's AFM refill tiers, and notices for AFM only when ticked (off for a setting from before them)", () => {
    expect(
      bodyJumponium([
        { Name: "tin", Percent: 1.6 },
        { Name: "manganese", Percent: 9 },
        { Name: "vanadium", Percent: 4 },
        { Name: "molybdenum", Percent: 1.2 },
        { Name: "zirconium", Percent: 2 },
      ])!.afmTiers,
    ).toEqual(["standard"]);
    const prior = {
      ...DEFAULT_NOTIFY_PREFS,
      jumponium: {
        on: true,
        tiers: { basic: true, standard: true, premium: true },
        onlyShort: true,
        target: 30,
      },
    } as unknown as typeof DEFAULT_NOTIFY_PREFS;
    expect(mergeNotifyPrefs(prior, {}).jumponium.afm).toEqual({
      basic: false,
      standard: false,
      premium: false,
    });
    expect(DEFAULT_NOTIFY_PREFS.jumponium.afm).toEqual({ basic: true, standard: true, premium: true });

    const n = createNoticesService({ filePath: null });
    const ctx = (stock: Record<string, number> | null): NoticesContext => ({
      isKnownBody: () => false,
      allScans: function* () {},
      currentSystem: () => ({ name: "Sys", address: 1 }),
      rawStock: () => stock,
    });
    const scan = (id: number, mats: { Name: string; Percent: number }[]) => ({
      timestamp: "2026-10-14T12:00:00Z",
      event: "Scan",
      ScanType: "Detailed",
      StarSystem: "Sys",
      SystemAddress: 1,
      BodyID: id,
      BodyName: `Sys ${id}`,
      PlanetClass: "Rocky body",
      Landable: true,
      Materials: mats,
    });
    n.setPrefs({
      jumponium: {
        on: true,
        tiers: { basic: false, standard: false, premium: false },
        afm: { basic: false, standard: false, premium: true },
      },
    });
    // Tellurium is the AFM premium's alone; chromium is common and never announced.
    expect(n.observe(scan(2, [{ Name: "chromium", Percent: 16 }]), ctx({}))).toBe(false);
    expect(n.observe(scan(3, [{ Name: "tellurium", Percent: 1.6 }]), ctx({}))).toBe(true);
    expect(n.list()[0]!.title).toBe("AFM refill (Premium): Te 1.60 %");
    n.setPrefs({ jumponium: { tiers: { premium: true } } });
    expect(
      n.observe(
        scan(4, [
          { Name: "zirconium", Percent: 3 },
          { Name: "polonium", Percent: 1 },
        ]),
        ctx({}),
      ),
    ).toBe(true);
    expect(n.list()[0]!.title).toBe("Laboratory (FSD Premium, AFM Premium): Po 1.00 %, Zr 3.00 %");
  });
});
