/**
 * What the system map now says beyond the bodies themselves (Discord batch O-E2): where the ship is,
 * the star's belt, and a body's biological signal count — read from the journal, drawn by both the
 * System map window and the System card.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { buildSnapshot, loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { JournalLine, SystemMapNodeDTO } from "../src/shared/types.js";

const SYS = "Flyai Flyuae UO-Z b0";
const ADDR = 911737315337;
const j = (o: Record<string, unknown>) =>
  ({ timestamp: "2026-09-25T21:40:00Z", ...o }) as unknown as JournalLine;

function store(): GameStateStore {
  const s = new GameStateStore();
  s.apply(
    j({
      event: "FSDJump",
      StarSystem: SYS,
      SystemAddress: ADDR,
      StarPos: [17936.1, -1175.8, 37355.9],
      Body: `${SYS} A`,
      BodyID: 1,
      BodyType: "Star",
      Population: 0,
    }),
  );
  s.apply(
    j({
      event: "Scan",
      ScanType: "AutoScan",
      BodyName: `${SYS} A`,
      BodyID: 1,
      Parents: [{ Null: 0 }],
      StarSystem: SYS,
      SystemAddress: ADDR,
      DistanceFromArrivalLS: 0,
      StarType: "M",
      Subclass: 9,
      StellarMass: 0.3,
      WasDiscovered: true,
    }),
  );
  s.apply(
    j({
      event: "Scan",
      ScanType: "Detailed",
      BodyName: `${SYS} A A Belt Cluster 1`,
      BodyID: 4,
      Parents: [{ Ring: 3 }, { Star: 1 }, { Null: 0 }],
      StarSystem: SYS,
      SystemAddress: ADDR,
      DistanceFromArrivalLS: 12,
      WasDiscovered: true,
    }),
  );
  s.apply(
    j({
      event: "Scan",
      ScanType: "Detailed",
      BodyName: `${SYS} A 8`,
      BodyID: 17,
      Parents: [{ Star: 1 }, { Null: 0 }],
      StarSystem: SYS,
      SystemAddress: ADDR,
      PlanetClass: "Icy body",
      AtmosphereType: "Argon",
      Atmosphere: "thin argon atmosphere",
      SurfaceGravity: 0.9,
      SurfaceTemperature: 60,
      SurfacePressure: 300,
      Landable: true,
      DistanceFromArrivalLS: 800,
      WasDiscovered: true,
      WasMapped: false,
      WasFootfalled: false,
    }),
  );
  s.apply(
    j({
      event: "FSSBodySignals",
      BodyName: `${SYS} A 8`,
      BodyID: 17,
      SystemAddress: ADDR,
      Signals: [{ Type: "$SAA_SignalType_Biological;", Count: 1 }],
    }),
  );
  return s;
}

function nodes(tree: SystemMapNodeDTO[]): SystemMapNodeDTO[] {
  return tree.flatMap((n) => [n, ...nodes(n.children)]);
}

describe("system map marks", () => {
  loadSpeciesDatabase();

  it("puts the ship at the arrival body after a jump, then at whatever it drops out at", () => {
    const s = store();
    expect(s.currentBodyKey).toBe(`${ADDR}:1`);
    let all = nodes(buildSnapshot(s, null, "", "127.0.0.1", 0, [], 1).systemMap!.tree);
    expect(all.find((n) => n.youAreHere)?.bodyId).toBe(1);

    s.apply(
      j({
        event: "SupercruiseExit",
        StarSystem: SYS,
        SystemAddress: ADDR,
        Body: `${SYS} A 8`,
        BodyID: 17,
        BodyType: "Planet",
      }),
    );
    all = nodes(buildSnapshot(s, null, "", "127.0.0.1", 0, [], 1).systemMap!.tree);
    expect(all.find((n) => n.youAreHere)?.bodyId).toBe(17);
  });

  it("counts the star's belt clusters and a body's biological signals", () => {
    const all = nodes(buildSnapshot(store(), null, "", "127.0.0.1", 0, [], 1).systemMap!.tree);
    expect(all.find((n) => n.bodyId === 1)?.beltClusters).toBe(1);
    expect(all.find((n) => n.bodyId === 17)?.bioSignals).toBe(1);
  });
});

describe("star cards", () => {
  it("marks a black hole apart from other unscoopable stars", async () => {
    const { buildPrimaryStarsHeader, loadStarRolesConfig } = await import("../src/server/systemMap.js");
    const { getProjectRoot } = await import("../src/server/paths.js");
    const cfg = loadStarRolesConfig(getProjectRoot());
    const rec = (bodyId: number, starType: string, dist: number) =>
      ({
        systemAddress: ADDR,
        bodyId,
        bodyName: `${SYS} ${String.fromCharCode(64 + bodyId)}`,
        starSystem: SYS,
        updatedAt: "2026-09-26T00:00:00Z",
        bodyType: "Star",
        starType,
        distanceFromArrivalLs: dist,
        parents: [{ Null: 0 }],
      }) as never;
    const h = buildPrimaryStarsHeader([rec(1, "H", 0), rec(2, "Y", 100), rec(3, "K", 200)], cfg)!;
    expect(h.stars.map((s) => [s.starRole, s.blackHole ?? false])).toEqual([
      ["useless", true],
      ["useless", false],
      ["fuel", false],
    ]);
  });
});

describe("ringed planets", () => {
  loadSpeciesDatabase();

  it("carries the planet's rings to the map, and never a star's belt", async () => {
    const { planetRingCount } = await import("../src/server/orbitUtils.js");
    expect(planetRingCount([{ Name: "X 2 A Ring" }, { Name: "X 2 B Ring" }])).toBe(2);
    expect(planetRingCount([{ Name: "X A Belt" }])).toBe(0);
    expect(planetRingCount(undefined)).toBeUndefined();

    const s = store();
    s.apply(
      j({
        event: "Scan",
        ScanType: "Detailed",
        BodyName: `${SYS} A 11`,
        BodyID: 30,
        Parents: [{ Star: 1 }, { Null: 0 }],
        StarSystem: SYS,
        SystemAddress: ADDR,
        PlanetClass: "Sudarsky class I gas giant",
        DistanceFromArrivalLS: 2400,
        Rings: [
          { Name: `${SYS} A 11 A Ring`, RingClass: "eRingClass_Icy" },
          { Name: `${SYS} A 11 B Ring`, RingClass: "eRingClass_Rocky" },
        ],
        WasDiscovered: true,
      }),
    );
    const all = nodes(buildSnapshot(s, null, "", "127.0.0.1", 0, [], 1).systemMap!.tree);
    expect(all.find((n) => n.bodyId === 30)?.rings).toBe(2);
    expect(all.find((n) => n.bodyId === 17)?.rings).toBeUndefined();
    expect(all.find((n) => n.bodyId === 1)?.rings).toBeUndefined();
  });
});

/*
  The map takes the body tab's pipeline run from the same snapshot instead of running the chain again (plan 1.2.17
  Part 3, 2026-10-15; the two agreed on all 589 bodies of the owner's history, docs/perf/map-vs-tab.mts).
*/
describe("the map's species come from the tab's run", () => {
  loadSpeciesDatabase();

  it("lists the tab's shown species for the body", () => {
    const snap = buildSnapshot(store(), null, "", "127.0.0.1", 0, [], 1);
    const tab = snap.bodies.find((b) => b.state.bodyId === 17)!;
    const shown = tab.matches.filter((m) => !m.unlikely).map((m) => m.entry.id);
    expect(shown.length).toBeGreaterThan(0);
    expect(snap.systemMap!.detailsByBodyId["17"]!.exoMatchSummaries.map((m) => m.id)).toEqual(shown.slice(0, 48));
  });

  it("uses a run it is handed, and runs its own without one", async () => {
    const { buildSystemMapSnapshot, loadStarRolesConfig } = await import("../src/server/systemMap.js");
    const { loadPriceList } = await import("../src/server/priceList.js");
    const { getProjectRoot } = await import("../src/server/paths.js");
    const s = store();
    const db = loadSpeciesDatabase();
    const cfg = loadStarRolesConfig(getProjectRoot());
    const prices = loadPriceList(getProjectRoot());
    const own = buildSystemMapSnapshot(s, ADDR, db, cfg, prices, null)!;
    expect(own.detailsByBodyId["17"]!.exoMatchSummaries.length).toBeGreaterThan(0);

    const exo = s.bioBodyState(`${ADDR}:17`)!;
    const one = { entry: { id: "x_handed", displayName: "Handed in" }, reasons: [] } as never;
    const handed = buildSystemMapSnapshot(s, ADDR, db, cfg, prices, null, new Map([
      [`${ADDR}:17`, { exo, scan: exo.scan!, matches: [one], shown: [one], approximateMatchingUsed: false }],
    ]))!;
    expect(handed.detailsByBodyId["17"]!.exoMatchSummaries).toEqual([{ displayName: "Handed in", id: "x_handed" }]);
  });
});
