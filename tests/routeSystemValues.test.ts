/**
 * What a discovered system on the route is worth (plan 1.3.3 R-1 / R-3): the FSS and DSS of the whole system from
 * Spansh's bodies, the notable planets mapped, and the fetches one at a time without touching the store's systems.
 */
import { describe, expect, it } from "vitest";
import type { ExplorationScanRecord, RemoteSystemRecord } from "../src/shared/types.js";
import { createRouteSystemValues, routeSystemValues, systemScanValues } from "../src/server/routeSystemValues.js";
import { bodyScanValueCredits, starScanValueCredits, systemHonkCredits } from "../src/server/explorationValue.js";
import { GameStateStore } from "../src/server/gameState.js";

const rec = (bodyId: number, extra: Partial<ExplorationScanRecord>): ExplorationScanRecord => ({
  systemAddress: 42,
  bodyId,
  bodyName: `Test ${bodyId}`,
  starSystem: "Test",
  updatedAt: "2026-10-30T00:00:00Z",
  ...extra,
});
const star = rec(0, { bodyName: "Test A", starType: "K", stellarMass: 0.8, distanceFromArrivalLs: 0 });
const elw = rec(1, { bodyName: "Test 1", planetClass: "Earthlike body", massEM: 1.2, distanceFromArrivalLs: 500 });
const icy = rec(2, { bodyName: "Test 2", planetClass: "Icy body", massEM: 0.05, distanceFromArrivalLs: 900 });
const belt = rec(3, { bodyName: "Test A Belt Cluster 1", bodyType: "AsteroidCluster" });

const system = (records: ExplorationScanRecord[]): RemoteSystemRecord => ({
  systemAddress: 42,
  starSystem: "Test",
  coords: { x: 0, y: 0, z: 0 },
  fetchedAt: "2026-10-30T00:00:00Z",
  sourceUpdatedAt: null,
  records,
  bio: [],
  signalBodyCount: 0,
});

describe("the system's FSS and DSS", () => {
  it("scans every body (the honk too), maps the notable planets in place of their scan, and skips belts", () => {
    const v = systemScanValues([star, elw, icy, belt]);
    const s = starScanValueCredits(0.8, "K", false).value;
    const e = bodyScanValueCredits("Earthlike body", false, 1.2, false, false);
    const i = bodyScanValueCredits("Icy body", false, 0.05, false, false);
    const honk = systemHonkCredits(
      [
        { kind: "planet", planetClass: "Earthlike body", terraformable: false, massEM: 1.2 },
        { kind: "planet", planetClass: "Icy body", terraformable: false, massEM: 0.05 },
      ],
      false,
    );
    expect(v.fssCr).toBe(Math.round(s + e.fss + i.fss + honk));
    expect(v.dssCr).toBe(e.dssMapped);
    expect(v.dssBodies).toBe(1);
    expect(v.totalCr).toBe(v.fssCr - e.fss + e.dssMapped);
    expect(v.bodies.get(1)!.tag).toBe("Earth-like");
    expect(v.bodies.has(3)).toBe(false);
  });

  it("lists the notable planet, and leaves the store's looked-up systems as they were", () => {
    const store = new GameStateStore();
    const d = routeSystemValues(store, system([star, elw, icy]));
    expect(d.state).toBe("ok");
    expect(d.bodies.map((b) => b.name)).toEqual(["Test 1"]);
    expect(store.remoteSystems.size).toBe(0);
  });
});

describe("the fetches", () => {
  it("asks Spansh once per system, one at a time, and says when it has no bodies", async () => {
    const store = new GameStateStore();
    let running = 0;
    let most = 0;
    const asked: number[] = [];
    const fetchSystem = async (addr: number) => {
      asked.push(addr);
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return addr === 7
        ? { ok: false as const, error: "Spansh has no record of this system." }
        : { ok: true as const, system: { ...system([star, elw]), systemAddress: addr } };
    };
    const v = createRouteSystemValues(() => store, fetchSystem);
    const [a, b, c] = await Promise.all([v.values(5, "A"), v.values(6, "B"), v.values(7, "C")]);
    expect(most).toBe(1);
    expect(a.state).toBe("ok");
    expect(b.dssBodies).toBe(1);
    expect(c.state).toBe("none");
    await v.values(5, "A");
    expect(asked).toEqual([5, 6, 7]);
  });
});
