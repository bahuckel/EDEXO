/**
 * Re-plotting a neutron route from where the ship is (server/neutronReplan.ts). Audit 2026-10-22: with no neutron
 * index (or an unreadable one) the re-plot returned after setting its busy flag and before the try that clears it,
 * so no off-route jump ever re-plotted again until a restart, even after the index was downloaded.
 */
import { describe, expect, it, vi } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { createNeutronLive, type LiveHop } from "../src/server/neutronLive.js";
import { createNeutronReplanner } from "../src/server/neutronReplan.js";
import type { NeutronRoute } from "../src/server/neutronRoute.js";

const hop = (name: string, x: number, kind: LiveHop["kind"] = "neutron"): LiveHop => ({
  name,
  x,
  y: 0,
  z: 0,
  kind,
  jumps: kind === "start" ? 0 : 1,
  boosted: kind === "neutron" ? 1 : 0,
  refuel: false,
  scoopLs: null,
  scoopOnWay: false,
});

const ROUTE: LiveHop[] = [hop("Sol", 0, "start"), hop("PSR A", 200), hop("Colonia", 900, "waypoint")];
const PLAN = { targets: [{ name: "Colonia", x: 900, y: 0, z: 0 }], rangeLy: 50 };

const planned = (from: string, x: number): NeutronRoute => ({
  hops: [
    { ...hop(from, x, "start"), distanceLy: 0, jumpsLeft: 4, fsdHealth: null },
    { ...hop("PSR B", 600), distanceLy: 100, jumpsLeft: 3, fsdHealth: null },
    { ...hop("Colonia", 900, "waypoint"), distanceLy: 300, jumpsLeft: 2, fsdHealth: null },
  ],
  jumps: 2,
  boosted: 1,
  distanceLy: 400,
  plainJumps: 10,
  refuels: 0,
  repairBefore: null,
  unsafeLegs: [],
});

function setup(loadIndex: () => { within: never; nameOf: never } | null) {
  const store = new GameStateStore();
  const copied: string[] = [];
  const live = createNeutronLive({ filePath: null, deliver: (n) => copied.push(n) });
  live.start(ROUTE, { name: "Sol", pos: { x: 0, y: 0, z: 0 } }, PLAN);
  // Off the route, far from the segment Sol → PSR A.
  const here = { name: "Somewhere", pos: { x: 300, y: 400, z: 0 } };
  const planRoute = vi.fn(async () => planned(here.name, here.pos.x));
  const push = vi.fn();
  const replanner = createNeutronReplanner({
    store,
    neutronLive: live,
    push,
    shipHere: () => here,
    loadIndex,
    planRoute,
  });
  return { live, copied, planRoute, push, replanner, store };
}

const INDEX = { within: undefined as never, nameOf: undefined as never };

describe("re-plotting a neutron route", () => {
  it("runs again after a re-plot found no neutron index", async () => {
    const loadIndex = vi.fn().mockReturnValueOnce(null).mockReturnValue(INDEX);
    const t = setup(loadIndex);
    await t.replanner.replan();
    expect(t.planRoute).not.toHaveBeenCalled();
    // The index is there now (downloaded): the next off-route jump re-plots.
    await t.replanner.replan();
    expect(t.planRoute).toHaveBeenCalledTimes(1);
    expect(t.live.hops()?.map((h) => h.name)).toEqual(["Somewhere", "PSR B", "Colonia"]);
    expect(t.copied.at(-1)).toBe("PSR B");
  });

  it("re-plots in flight with a short search: the next stop within a second, not the drawer's three", async () => {
    const t = setup(() => INDEX);
    await t.replanner.replan();
    const budget = (t.planRoute.mock.calls[0] as unknown[])[3];
    expect(budget).toBeTypeOf("number");
    expect(budget as number).toBeLessThan(1000);
  });

  it("runs again after the neutron index could not be read", async () => {
    const loadIndex = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("truncated neutrons.bin");
      })
      .mockReturnValue(INDEX);
    const t = setup(loadIndex);
    await t.replanner.replan();
    await t.replanner.replan();
    expect(t.planRoute).toHaveBeenCalledTimes(1);
  });

  it("runs one re-plot at a time, and the HUD's re-plotting flag goes when it ends", async () => {
    const t = setup(() => INDEX);
    const first = t.replanner.replan();
    expect(t.live.view({ name: "Somewhere", pos: null })?.replanning).toBe(true);
    // A second off-route jump while the first still plans: ignored.
    await t.replanner.replan();
    await first;
    expect(t.planRoute).toHaveBeenCalledTimes(1);
    // The re-plot landed (a new version): the HUD shows the new next stop, not "re-plotting" (audit 2026-10-22).
    expect(t.live.view({ name: "Somewhere", pos: null })?.replanning).toBe(false);
    // Not re-plotting any more: a ship off the new route is seen as off it again.
    expect(t.live.offRoute({ name: "Far", pos: { x: 0, y: 5000, z: 0 } })).toBe(true);
    await t.replanner.replan();
    expect(t.planRoute).toHaveBeenCalledTimes(2);
  });

  it("frees itself after a re-plot that failed", async () => {
    const t = setup(() => INDEX);
    t.planRoute.mockRejectedValueOnce(new Error("no route"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await t.replanner.replan();
    warn.mockRestore();
    expect(t.live.view({ name: "Somewhere", pos: null })?.replanning).toBe(false);
    await t.replanner.replan();
    expect(t.planRoute).toHaveBeenCalledTimes(2);
  });

  it("re-plots for the fuel from the tank it was told, and the HUD says why meanwhile (plan 1.3.4 S-9)", async () => {
    const t = setup(() => INDEX);
    // A 40 t tank at 5 t a jump; Status.json still says 20 t from before the jump.
    t.store.loadoutFuelMainCapacityT = 40;
    t.store.fsdFuel.maxFuelPerJumpT = 5;
    t.store.lastFuelMainT = 20;
    const run = t.replanner.replan({ why: "8 t more fuel than planned", fuelT: 38 });
    expect(t.live.view({ name: "Somewhere", pos: null })).toMatchObject({
      replanning: true,
      replanWhy: "8 t more fuel than planned",
    });
    await run;
    const ship = (t.planRoute.mock.calls[0] as unknown[])[2] as { fuelNowT: number; jumpsNow: number };
    expect(ship).toMatchObject({ fuelNowT: 38, jumpsNow: 7 });
    expect(t.live.view({ name: "Somewhere", pos: null })?.replanWhy).toBeUndefined();
  });

  it("keeps the stops when no fuel-safe neutron way is left, and says to scoop (a refuel missed, 2026-11-08)", async () => {
    const t = setup(() => INDEX);
    const copiedBefore = [...t.copied];
    // The planner's answer with too little fuel: the game's plot straight to the destination.
    t.planRoute.mockResolvedValueOnce({
      ...planned("Somewhere", 300),
      hops: [planned("Somewhere", 300).hops[0]!, { ...planned("Somewhere", 300).hops[2]!, boosted: 0, jumps: 12, scoopOnWay: true }],
      unsafeLegs: [1],
    });
    await t.replanner.replan({ why: "9 t less fuel than planned", fuelT: 2 });
    expect(t.live.hops()?.map((h) => h.name)).toEqual(["Sol", "PSR A", "Colonia"]);
    expect(t.copied).toEqual(copiedBefore);
    const here = { name: "Somewhere", pos: null };
    expect(t.live.view(here)).toMatchObject({ next: "PSR A", replanning: false, noFuelWay: true });
    // Scooped: the next re-plot finds a neutron way and the note goes.
    await t.replanner.replan({ why: "30 t more fuel than planned", fuelT: 32 });
    expect(t.live.hops()?.map((h) => h.name)).toEqual(["Somewhere", "PSR B", "Colonia"]);
    expect(t.live.view(here)?.noFuelWay).toBeUndefined();
  });

  it("keeps the route's own stops on a later leg the re-plot found no neutron way for", async () => {
    const t = setup(() => INDEX);
    const two = { ...PLAN, targets: [{ name: "Mid", x: 500, y: 0, z: 0 }, ...PLAN.targets] };
    t.live.start(
      [hop("Sol", 0, "start"), hop("PSR A", 200), hop("Mid", 500, "waypoint"), hop("PSR C", 700), hop("Colonia", 900, "waypoint")],
      { name: "Sol", pos: { x: 0, y: 0, z: 0 } },
      two,
    );
    // The first leg re-plotted through PSR B; the second, from Mid with less fuel, only by the game's plot.
    const p = planned("Somewhere", 300);
    t.planRoute.mockResolvedValueOnce({
      ...p,
      hops: [p.hops[0]!, p.hops[1]!, { ...p.hops[2]!, name: "Mid", x: 500 }, { ...p.hops[2]!, boosted: 0, jumps: 8 }],
      unsafeLegs: [2],
    });
    await t.replanner.replan();
    expect(t.live.hops()?.map((h) => h.name)).toEqual(["Somewhere", "PSR B", "Mid", "PSR C", "Colonia"]);
    expect(t.copied.at(-1)).toBe("PSR B");
    expect(t.live.view({ name: "Somewhere", pos: null })?.noFuelWay).toBeUndefined();
  });

  it("takes the game's plot when the route had no neutron star ahead anyway", async () => {
    const t = setup(() => INDEX);
    t.live.start([hop("Sol", 0, "start"), hop("Colonia", 900, "waypoint")], { name: "Sol", pos: { x: 0, y: 0, z: 0 } }, PLAN);
    t.planRoute.mockResolvedValueOnce({
      ...planned("Somewhere", 300),
      hops: [planned("Somewhere", 300).hops[0]!, planned("Somewhere", 300).hops[2]!],
      unsafeLegs: [1],
    });
    await t.replanner.replan();
    expect(t.live.hops()?.map((h) => h.name)).toEqual(["Somewhere", "Colonia"]);
    expect(t.live.view({ name: "Somewhere", pos: null })?.noFuelWay).toBeUndefined();
  });

  it("leaves a route started meanwhile alone", async () => {
    const t = setup(() => INDEX);
    const first = t.replanner.replan();
    // The commander starts another route while the re-plot still searches.
    t.live.start(ROUTE, { name: "Sol", pos: { x: 0, y: 0, z: 0 } }, PLAN);
    await first;
    expect(t.live.hops()?.map((h) => h.name)).toEqual(["Sol", "PSR A", "Colonia"]);
  });
});
