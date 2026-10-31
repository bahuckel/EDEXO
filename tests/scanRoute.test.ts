/**
 * The scan route (plan 1.3.3 R-4): bodies placed by their orbits through the Parents chain, the shortest open route
 * from the arrival star, and the view's targets (mapped value at least the minimum, biology left) and missing bodies.
 */
import { describe, expect, it } from "vitest";
import type { ExplorationScanRecord } from "../src/shared/types.js";
import { distLs, METRES_PER_LS, orbitOffset, systemPositions, type Vec3 } from "../src/shared/orbitPositions.js";
import { EXACT_MAX, shortestScanRoute } from "../src/shared/scanRoute.js";
import { buildScanRoute } from "../src/server/scanRouteView.js";

const EPOCH = Date.parse("2026-10-30T00:00:00Z");
const DAY = 86_400;
const rec = (bodyId: number, extra: Partial<ExplorationScanRecord>): ExplorationScanRecord => ({
  systemAddress: 42,
  bodyId,
  bodyName: `Test ${bodyId}`,
  starSystem: "Test",
  updatedAt: "2026-10-30T00:00:00Z",
  ...extra,
});
/** A circular orbit of `ls` light-seconds, at mean anomaly `m` degrees at EPOCH. */
const orbit = (ls: number, m = 0, extra: Partial<ExplorationScanRecord> = {}): Partial<ExplorationScanRecord> => ({
  semiMajorAxis: ls * METRES_PER_LS,
  eccentricity: 0,
  orbitalInclination: 0,
  periapsis: 0,
  ascendingNode: 0,
  orbitalPeriod: 4 * DAY,
  meanAnomaly: m,
  orbitEpochMs: EPOCH,
  ...extra,
});
const close = (a: Vec3, b: Vec3) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.z).toBeCloseTo(b.z, 6);
};

describe("orbit positions", () => {
  it("moves a body round its orbit from where the scan saw it", () => {
    const r = rec(1, orbit(1));
    close(orbitOffset(r, EPOCH, 1)!, { x: 1, y: 0, z: 0 });
    // A quarter of its period later: a quarter turn.
    close(orbitOffset(r, EPOCH + DAY * 1000, 1)!, { x: 0, y: 1, z: 0 });
    // Tilted 90°: out of the plane.
    close(orbitOffset(rec(1, orbit(1, 90, { orbitalInclination: 90 })), EPOCH, 1)!, { x: 0, y: 0, z: 1 });
  });

  it("adds the parents' places, a barycentre's too, and stands a missing parent at the next one up", () => {
    const star = rec(0, { starType: "K", distanceFromArrivalLs: 0 });
    const bary = rec(-1001, { isBarycentreJournal: true, journalBarycentreNullId: 1, ...orbit(10) });
    const planet = rec(2, { planetClass: "Icy body", parents: [{ Null: 1 }, { Star: 0 }], ...orbit(1) });
    const moon = rec(3, { planetClass: "Icy body", parents: [{ Planet: 2 }, { Null: 1 }, { Star: 0 }], ...orbit(0.5, 90) });
    const p = systemPositions([star, bary, planet, moon], EPOCH);
    close(p.get(2)!, { x: 11, y: 0, z: 0 });
    close(p.get(3)!, { x: 11, y: 0.5, z: 0 });
    // Without the barycentre's record the planet orbits the star.
    close(systemPositions([star, planet], EPOCH).get(2)!, { x: 1, y: 0, z: 0 });
  });

  it("puts a body without its phase at its own distance from the parent", () => {
    const star = rec(0, { starType: "K" });
    const planet = rec(5, { planetClass: "Icy body", parents: [{ Star: 0 }], semiMajorAxis: 7 * METRES_PER_LS });
    expect(distLs(systemPositions([star, planet], EPOCH).get(5)!, { x: 0, y: 0, z: 0 })).toBeCloseTo(7, 6);
  });
});

describe("the shortest scan route", () => {
  const at = (x: number, y = 0): Vec3 => ({ x, y, z: 0 });

  it("goes along a line in order, wherever the stops were listed", () => {
    const r = shortestScanRoute(at(0), [3, 1, 2].map((x) => ({ item: x, pos: at(x) })));
    expect(r.order.map((s) => s.item)).toEqual([1, 2, 3]);
    expect(r.totalLs).toBeCloseTo(3, 9);
  });

  it("is the best order (every order tried) up to the exact limit", () => {
    // A seeded spread of 7 stops.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 1000;
    const stops = Array.from({ length: 7 }, (_, i) => ({ item: i, pos: at(rnd(), rnd()) }));
    const best = { len: Infinity };
    const perm = (left: number[], from: Vec3, len: number) => {
      if (!left.length) best.len = Math.min(best.len, len);
      for (const k of left) perm(left.filter((x) => x !== k), stops[k]!.pos, len + distLs(from, stops[k]!.pos));
    };
    perm(stops.map((s) => s.item), at(0), 0);
    expect(shortestScanRoute(at(0), stops).totalLs).toBeCloseTo(best.len, 6);
  });

  it("past the exact limit, improves on going to the nearest each time", () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 1000;
    const stops = Array.from({ length: EXACT_MAX + 8 }, (_, i) => ({ item: i, pos: at(rnd(), rnd()) }));
    let nn = 0;
    const left = [...stops];
    for (let from = at(0); left.length; ) {
      left.sort((a, b) => distLs(from, a.pos) - distLs(from, b.pos));
      const s = left.shift()!;
      nn += distLs(from, s.pos);
      from = s.pos;
    }
    const r = shortestScanRoute(at(0), stops);
    expect(new Set(r.order.map((s) => s.item)).size).toBe(stops.length);
    expect(r.totalLs).toBeLessThanOrEqual(nn + 1e-9);
  });
});

describe("the scan view", () => {
  const star = rec(0, { starType: "K", stellarMass: 0.8, distanceFromArrivalLs: 0 });
  const elw = rec(1, { planetClass: "Earthlike body", massEM: 1, parents: [{ Star: 0 }], ...orbit(500) });
  const icy = rec(2, { planetClass: "Icy body", massEM: 0.01, parents: [{ Star: 0 }], ...orbit(100, 180) });
  const hmc = rec(3, { planetClass: "High metal content body", massEM: 0.1, parents: [{ Star: 0 }], ...orbit(50, 90) });
  const input = {
    addr: 42,
    name: "Test",
    records: [star, elw, icy, hmc],
    source: "journal" as const,
    bio: new Map([[3, { signals: 2, cr: 9_000_000, left: true, codexNew: 0, codexFirst: 0 }]]),
    totalBodies: 6,
    minDssCr: 300_000,
    atMs: EPOCH,
  };

  it("routes the planets worth mapping and the bodies with biology, from the arrival star", () => {
    const v = buildScanRoute(input);
    expect(v.startId).toBe(0);
    expect(v.bodies.find((b) => b.id === 1)!.target).toBe("dss");
    expect(v.bodies.find((b) => b.id === 2)!.target).toBeNull();
    expect(v.bodies.find((b) => b.id === 3)!.target).toBe("bio");
    // The near one first: 50 ls out, then 500 ls.
    expect(v.route.order).toEqual([3, 1]);
    expect(v.routeBioCr).toBe(9_000_000);
    expect(v.routeDssCr).toBe(v.bodies.find((b) => b.id === 1)!.dssCr);
    // The honk counted 6: two not scanned.
    expect(v.bodyCount).toEqual({ known: 4, total: 6, missing: 2 });
  });

  it("leaves out a planet already mapped and a body sampled out", () => {
    const v = buildScanRoute({
      ...input,
      mapped: (k) => k.endsWith(":1"),
      bio: new Map([[3, { signals: 2, cr: 9_000_000, left: false, codexNew: 0, codexFirst: 0 }]]),
    });
    expect(v.route.order).toEqual([]);
  });

  it("keeps a bio body under the bio minimum out, unless the codex switch lets its CODEX entries in", () => {
    const cheap = new Map([[3, { signals: 2, cr: 1_500_000, left: true, codexNew: 2, codexFirst: 1 }]]);
    const off = buildScanRoute({ ...input, bio: cheap, bioMinCr: 5_000_000 });
    expect(off.bodies.find((b) => b.id === 3)!.target).toBeNull();
    const on = buildScanRoute({ ...input, bio: cheap, bioMinCr: 5_000_000, codexOn: true });
    expect(on.bodies.find((b) => b.id === 3)).toMatchObject({ target: "codex", codexNew: 2, codexFirst: 1 });
    expect(on.route.order).toEqual([3, 1]);
    expect(on.totals.codexNew).toBe(2);
  });

  it("totals the system as the system map does: every body scanned, every planet mapped, the honk with both", () => {
    const v = buildScanRoute({ ...input, others: new Set([2]), currentCr: 12_345 });
    const fss = v.bodies.reduce((a, b) => a + b.fssCr, 0);
    const mapped = v.bodies.reduce((a, b) => a + (b.dssCr ?? b.fssCr), 0);
    expect(v.totals.scanCr).toBeGreaterThan(fss);
    expect(v.totals.mappedCr - mapped).toBe(v.totals.scanCr - fss);
    expect(v.totals.currentCr).toBe(12_345);
    expect(v.bodies.find((b) => b.id === 2)!.others).toBe(true);
    expect(v.bodies.find((b) => b.id === 1)!.others).toBe(false);
  });
});

describe("the likely species' CODEX entries", () => {
  it("counts each genus' likeliest candidate only, and the firsts among them", async () => {
    const { likelyCodex } = await import("../src/shared/codexCount.js");
    const m = (genus: string, pct: number, codexNew: boolean, codexFirst = false) =>
      ({ entry: { genus, displayName: `${genus} ${pct}` }, presenceProbabilityPercent: pct, codexNew, codexFirst, priceCredits: 1 }) as never;
    expect(
      likelyCodex([
        m("Bacterium", 80, true, true),
        m("Bacterium", 20, false),
        // The likeliest Stratum is logged: its new runner-up does not count.
        m("Stratum", 70, false),
        m("Stratum", 30, true),
        m("Tussock", 55, true),
      ]),
    ).toEqual({ codexNew: 2, codexFirst: 1 });
  });
});

describe("times as EDSM and Spansh write them", () => {
  it("reads Spansh's hour-only offset and EDSM's zone-less UTC", async () => {
    const { parseSourceTime } = await import("../src/server/edsmSystemHydration.js");
    const utc = Date.parse("2026-09-04T22:55:03Z");
    expect(parseSourceTime("2026-09-04 22:55:03+00")).toBe(utc);
    expect(parseSourceTime("2026-09-04 22:55:03")).toBe(utc);
    expect(parseSourceTime("2026-09-04T22:55:03Z")).toBe(utc);
    expect(parseSourceTime("2026-09-05 00:55:03+02")).toBe(utc);
    expect(parseSourceTime(undefined)).toBeNaN();
  });
});

describe("a system half scanned", () => {
  it("fills in the bodies others discovered, marks them, and leaves only the unknown ones missing", async () => {
    const { GameStateStore } = await import("../src/server/gameState.js");
    const { journalScanRoute } = await import("../src/server/scanRouteView.js");
    const s = new GameStateStore();
    const T = "2026-10-31T10:00:00Z";
    const base = { timestamp: T, StarSystem: "Half", SystemAddress: 4242, ScanType: "Detailed" };
    s.apply({ timestamp: T, event: "FSSDiscoveryScan", SystemAddress: 4242, SystemName: "Half", BodyCount: 4, Progress: 0.5 } as never);
    s.apply({ ...base, event: "Scan", BodyName: "Half A", BodyID: 0, StarType: "K", StellarMass: 0.8, DistanceFromArrivalLS: 0 } as never);
    s.apply({ ...base, event: "Scan", BodyName: "Half 1", BodyID: 1, PlanetClass: "Icy body", MassEM: 0.1, DistanceFromArrivalLS: 100, Parents: [{ Star: 0 }], SemiMajorAxis: 100 * METRES_PER_LS } as never);
    const spansh = {
      systemAddress: 4242,
      starSystem: "Half",
      coords: null,
      fetchedAt: T,
      sourceUpdatedAt: null,
      bio: [],
      bodyCount: 4,
      records: [
        rec(1, { systemAddress: 4242, bodyName: "Half 1", planetClass: "Rocky body", edsmHydrated: true }),
        rec(2, { systemAddress: 4242, bodyName: "Half 2", planetClass: "Earthlike body", massEM: 1, edsmHydrated: true, parents: [{ Star: 0 }], ...orbit(400) }),
      ],
    };
    const v = journalScanRoute(s, 4242, "Half", { minDssCr: 300_000, bioMinCr: 0, codexOn: false }, EPOCH, spansh as never)!;
    // His Half 1 wins over Spansh's; Half 2 comes from Spansh, marked, worth mapping.
    expect(v.bodies.map((b) => [b.id, b.others])).toEqual([[0, false], [1, false], [2, true]]);
    expect(v.bodies.find((b) => b.id === 1)!.cls).toBe("Icy body");
    expect(v.bodies.find((b) => b.id === 2)!.target).toBe("dss");
    expect(v.bodyCount).toEqual({ known: 3, total: 4, missing: 1 });
  });
});
