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
  return { live, copied, planRoute, push, replanner };
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

  it("leaves a route started meanwhile alone", async () => {
    const t = setup(() => INDEX);
    const first = t.replanner.replan();
    // The commander starts another route while the re-plot still searches.
    t.live.start(ROUTE, { name: "Sol", pos: { x: 0, y: 0, z: 0 } }, PLAN);
    await first;
    expect(t.live.hops()?.map((h) => h.name)).toEqual(["Sol", "PSR A", "Colonia"]);
  });
});
