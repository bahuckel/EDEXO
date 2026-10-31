/**
 * The route being flown follows the fuel aboard (plan 1.3.4 S-9, server/neutronFuelWatch.ts): a guild mate scooped a
 * star between neutron jumps and the plan went on as if he had not. A jump onto a stop compares the jump's FuelLevel
 * with the plan's arrival fuel there; scooping, once settled, compares the tank with the stop's leaving fuel, or
 * between stops with the tank on the last jump. A jump's fuel or more either way re-plots, with the tank compared.
 */
import { describe, expect, it } from "vitest";
import { createNeutronLive, parseLiveHops, parseLivePlan, type LiveHop } from "../src/server/neutronLive.js";
import { createNeutronFuelWatch, fuelWhy } from "../src/server/neutronFuelWatch.js";

const PER_JUMP_T = 5;

const hop = (name: string, x: number, fuelArrive: number, fuelLeave: number, more: Partial<LiveHop> = {}): LiveHop => ({
  name,
  x,
  y: 0,
  z: 0,
  kind: "neutron",
  jumps: 1,
  boosted: 1,
  refuel: false,
  scoopLs: null,
  scoopOnWay: false,
  fuelArrive,
  fuelLeave,
  ...more,
});

// Tank 8 jumps (40 t). Sol → PSR A (arrive 6) → PSR B (arrive 4, scoop to full 8) → Colonia.
const ROUTE: LiveHop[] = [
  hop("Sol", 0, 7, 7, { kind: "start", jumps: 0, boosted: 0 }),
  hop("PSR A", 200, 6, 6),
  hop("PSR B", 400, 4, 8, { refuel: true, scoopLs: 300 }),
  hop("Colonia", 900, 5, 5, { kind: "waypoint" }),
];

function setup(route: LiveHop[] = ROUTE) {
  const live = createNeutronLive({ filePath: null, deliver: () => undefined });
  const here = { name: "Sol" as string | null, pos: { x: 0, y: 0, z: 0 } as { x: number; y: number; z: number } | null };
  live.start(route, here, null);
  const tank = { nowT: 35 as number | null };
  const replans: { why: string; fuelT: number }[] = [];
  const timers: (() => void)[] = [];
  const watch = createNeutronFuelWatch(
    {
      neutronLive: live,
      shipHere: () => here,
      fuel: () => ({ nowT: tank.nowT, perJumpT: PER_JUMP_T }),
      setTimer: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimer: (t) => {
        timers[(t as number) - 1] = () => undefined;
      },
    },
    (why, fuelT) => replans.push({ why, fuelT }),
  );
  /** A jump into `name` at `x` with `fuelT` aboard, as the bootstrap sends it: the route first, then the watch. */
  const jump = (name: string, x: number, fuelT: number) => {
    here.name = name;
    here.pos = { x, y: 0, z: 0 };
    tank.nowT = fuelT;
    live.onJump(here);
    watch.onLine({ event: "FSDJump", StarSystem: name, FuelLevel: fuelT });
  };
  const scoop = (totalT: number) => {
    tank.nowT = totalT;
    watch.onLine({ event: "FuelScoop", Total: totalT });
  };
  const settle = () => {
    const pending = timers.splice(0);
    for (const fn of pending) fn();
  };
  return { live, watch, jump, scoop, settle, replans, here };
}

describe("the neutron route follows the fuel aboard", () => {
  it("leaves the plan alone when the tank is within a jump's fuel of it", () => {
    const t = setup();
    // Planned 6 jumps (30 t) at PSR A: 27 t is under a jump (5 t) less.
    t.jump("PSR A", 200, 27);
    expect(t.replans).toEqual([]);
  });

  it("re-plots on a stop reached with a jump's fuel more than planned, from the jump's own fuel level", () => {
    const t = setup();
    t.jump("PSR A", 200, 38);
    expect(t.replans).toEqual([{ why: "8 t more fuel than planned", fuelT: 38 }]);
  });

  it("re-plots on a stop reached with a jump's fuel less than planned", () => {
    const t = setup();
    t.jump("PSR A", 200, 22.5);
    expect(t.replans).toEqual([{ why: "7.5 t less fuel than planned", fuelT: 22.5 }]);
  });

  it("re-plots after a scoop between neutron jumps the plan did not count on (the guild mate's report)", () => {
    const t = setup();
    t.jump("PSR A", 200, 30);
    // A K star on the way to PSR B: he scoops 12 t.
    t.jump("Some K star", 260, 25);
    t.scoop(31);
    t.scoop(37);
    // Not while scooping: only once the lines stop.
    expect(t.replans).toEqual([]);
    t.settle();
    expect(t.replans).toEqual([{ why: "12 t more fuel than planned", fuelT: 37 }]);
  });

  it("does not re-plot a scoop on the way where the plan scoops on the way anyway", () => {
    const route = ROUTE.map((h) => (h.name === "PSR B" ? { ...h, scoopOnWay: true } : h));
    const t = setup(route);
    t.jump("PSR A", 200, 30);
    t.jump("Some K star", 260, 25);
    t.scoop(40);
    t.settle();
    expect(t.replans).toEqual([]);
  });

  it("checks a refuel stop's scoop against what the plan scoops to: short re-plots, as planned does not", () => {
    const t = setup();
    t.jump("PSR A", 200, 30);
    t.jump("PSR B", 400, 20);
    expect(t.replans).toEqual([]);
    // Planned: to full (8 jumps, 40 t). Stopped at 30 t.
    t.scoop(30);
    t.settle();
    expect(t.replans).toEqual([{ why: "10 t less fuel than planned", fuelT: 30 }]);
    const u = setup();
    u.jump("PSR A", 200, 30);
    u.jump("PSR B", 400, 20);
    u.scoop(40);
    u.settle();
    expect(u.replans).toEqual([]);
  });

  it("a jump cancels a scoop not yet settled: the jump's own check decides", () => {
    const t = setup();
    t.jump("PSR A", 200, 30);
    t.scoop(32);
    t.jump("PSR B", 400, 22);
    t.settle();
    expect(t.replans).toEqual([]);
  });

  it("an older route without the plan's fuel keeps the off-route re-plot only", () => {
    const old = ROUTE.map(({ fuelArrive: _a, fuelLeave: _l, ...h }) => h);
    const t = setup(old);
    t.jump("PSR A", 200, 40);
    t.scoop(40);
    t.settle();
    expect(t.replans).toEqual([]);
  });

  it("says the difference in tonnes, whole from 10 t", () => {
    expect(fuelWhy(12.4)).toBe("12 t more fuel than planned");
    expect(fuelWhy(-3.44)).toBe("3.4 t less fuel than planned");
  });
});

describe("the live route keeps the plan's fuel, and a re-plot keeps the clipboard when its next stop is the same", () => {
  it("parses the fuel a plan sent, and drops a broken one", () => {
    const hops = parseLiveHops([
      { ...ROUTE[0] },
      { ...ROUTE[1], fuelArrive: "6", fuelLeave: 6 },
      { ...ROUTE[2] },
    ])!;
    expect(hops[0]).toMatchObject({ fuelArrive: 7, fuelLeave: 7 });
    expect(hops[1]!.fuelArrive).toBeUndefined();
    expect(hops[2]).toMatchObject({ fuelArrive: 4, fuelLeave: 8 });
  });

  it("copies the next stop again only when the re-plot changed it", () => {
    const copied: string[] = [];
    const live = createNeutronLive({ filePath: null, deliver: (n) => copied.push(n) });
    live.start(ROUTE, { name: "Sol", pos: { x: 0, y: 0, z: 0 } }, null);
    expect(copied).toEqual(["PSR A"]);
    live.replace([hop("Here", 10, 7, 7, { kind: "start" }), ...ROUTE.slice(1)], []);
    expect(copied).toEqual(["PSR A"]);
    live.replace([hop("Here", 10, 7, 7, { kind: "start" }), ...ROUTE.slice(2)], []);
    expect(copied).toEqual(["PSR A", "PSR B"]);
  });

  it("keeps the reserve with the route, for the re-plots (plan 1.3.4 S-7)", () => {
    const live = createNeutronLive({ filePath: null, deliver: () => undefined });
    const plan = parseLivePlan({ targets: [{ name: "Colonia", x: 900, y: 0, z: 0 }], rangeLy: 50, reserve: 0.25 });
    expect(plan?.reserve).toBe(0.25);
    expect(parseLivePlan({ targets: [{ name: "C", x: 1, y: 0, z: 0 }], rangeLy: 50, reserve: 2 })?.reserve).toBeUndefined();
    live.start(ROUTE, { name: "Sol", pos: { x: 0, y: 0, z: 0 } }, plan);
    expect(live.remaining()?.reserve).toBe(0.25);
  });

  it("the HUD's re-plotting line says why when it is the fuel", () => {
    const live = createNeutronLive({ filePath: null, deliver: () => undefined });
    const here = { name: "Sol", pos: { x: 0, y: 0, z: 0 } };
    live.start(ROUTE, here, null);
    live.setReplanning(true, "8 t more fuel than planned");
    expect(live.view(here)).toMatchObject({ replanning: true, replanWhy: "8 t more fuel than planned" });
    live.setReplanning(false);
    expect(live.view(here)?.replanWhy).toBeUndefined();
  });
});
