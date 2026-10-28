/**
 * A neutron route being flown (server/neutronLive.ts, plan 8.5): the next stop on the clipboard after each jump onto
 * a stop, what to do where the ship is, the end of the route, and one owner of the clipboard with the boxel run.
 */
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNeutronLive, parseLiveHops, type LiveHop } from "../src/server/neutronLive.js";
import { createSavedBoxels } from "../src/server/savedBoxels.js";

const hop = (name: string, x: number, o: Partial<LiveHop> = {}): LiveHop => ({
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
  ...o,
});

// Start, a neutron star with a scoopable companion, one without, a stretch of normal jumps, the destination.
const ROUTE: LiveHop[] = [
  hop("Sol", 0, { kind: "start", jumps: 0, boosted: 0 }),
  hop("PSR A", 200, { refuel: true, scoopLs: 1234 }),
  hop("PSR B", 440),
  hop("Colonia", 900, { kind: "waypoint", jumps: 9, boosted: 1, scoopOnWay: true }),
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(filePath: string | null = null) {
  const copied: string[] = [];
  const live = createNeutronLive({ filePath, deliver: (n) => copied.push(n) });
  const at = (name: string | null, x?: number) => ({ name, pos: x == null ? null : { x, y: 0, z: 0 } });
  return { live, copied, at };
}

describe("flying a neutron route", () => {
  it("copies the next stop on start and after each jump onto a stop, and nothing between stops", () => {
    const t = setup();
    expect(t.live.start(ROUTE, t.at("Sol", 0))).toBe("PSR A");
    expect(t.live.onJump(t.at("PSR A", 200))).toBe("PSR B");
    expect(t.live.onJump(t.at("PSR B", 440))).toBe("Colonia");
    // The game's own plot between PSR B and Colonia: no stop, the clipboard keeps Colonia.
    expect(t.live.onJump(t.at("Some System", 600))).toBeNull();
    expect(t.copied).toEqual(["PSR A", "PSR B", "Colonia"]);
    expect(t.live.copyNext()).toBe("Colonia");
  });

  it("says scoop then supercharge at a refuel stop, supercharge at one without, scoop on the way before a long stretch", () => {
    const t = setup();
    t.live.start(ROUTE, t.at("Sol", 0));
    t.live.onJump(t.at("PSR A", 200));
    expect(t.live.view(t.at("PSR A", 200))).toMatchObject({
      at: 1,
      total: 3,
      next: "PSR B",
      onStop: true,
      refuelHere: true,
      refuelHalf: false,
      scoopLs: 1234,
      superchargeHere: true,
    });
    t.live.onJump(t.at("PSR B", 440));
    expect(t.live.view(t.at("PSR B", 440))).toMatchObject({
      refuelHere: false,
      superchargeHere: true,
      next: "Colonia",
      nextJumps: 9,
      scoopOnWay: true,
    });
    // Between the stops: nothing to do here, the stop ahead still shown.
    expect(t.live.view(t.at("Some System", 600))).toMatchObject({
      onStop: false,
      superchargeHere: false,
      next: "Colonia",
    });
  });

  it("knows a stop by its position when the name differs, and a stop the plot passed over still counts", () => {
    const t = setup();
    t.live.start(ROUTE, t.at("Sol", 0));
    // PSR A skipped (a longer plot); PSR B arrived at under another spelling.
    expect(t.live.onJump(t.at("psr-b (alt)", 440.02))).toBe("Colonia");
    expect(t.live.view(t.at(null, 440))?.at).toBe(2);
  });

  it("ends at the last stop: done until the next jump, then gone", () => {
    const t = setup();
    t.live.start(ROUTE, t.at("PSR B", 440));
    expect(t.copied).toEqual(["Colonia"]);
    expect(t.live.onJump(t.at("Colonia", 900))).toBeNull();
    expect(t.live.active()).toBe(false);
    expect(t.live.view(t.at("Colonia", 900))).toMatchObject({ done: true, destination: "Colonia" });
    t.live.onJump(t.at("Elsewhere", 950));
    expect(t.live.view(t.at("Elsewhere", 950))).toBeNull();
  });

  it("survives a restart, and Stop removes the file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "neutron-live-"));
    dirs.push(dir);
    const file = path.join(dir, "edexo-neutron-live.json");
    const a = setup(file);
    a.live.start(ROUTE, a.at("Sol", 0));
    a.live.onJump(a.at("PSR A", 200));
    const b = setup(file);
    expect(b.live.active()).toBe(true);
    expect(b.live.copyNext()).toBe("PSR B");
    b.live.stop();
    expect(existsSync(file)).toBe(false);
  });

  it("refuses what is not a route", () => {
    expect(parseLiveHops(null)).toBeNull();
    expect(parseLiveHops([hop("Sol", 0)])).toBeNull();
    expect(parseLiveHops([hop("Sol", 0), { name: "x", x: "1", y: 0, z: 0 }])).toBeNull();
    expect(parseLiveHops(ROUTE)).toHaveLength(4);
  });

  it("shares the clipboard with the boxel run: starting either ends the other", () => {
    const saved = createSavedBoxels({ filePath: null, onRun: (id) => id && live.stop() });
    const live = createNeutronLive({
      filePath: null,
      deliver: () => undefined,
      onStart: () => {
        if (saved.runId()) saved.setRun(null);
      },
    });
    const b = saved.add("Eol Prou AB-C d1-3")!;
    saved.setRun(b.id);
    live.start(ROUTE, { name: "Sol", pos: null });
    expect(saved.runId()).toBeNull();
    saved.setRun(b.id);
    expect(live.active()).toBe(false);
  });

  it("knows when the ship is off the route, and plans again from there to the stops not reached", () => {
    const t = setup();
    // Two destinations: PSR B ends the first leg (a waypoint), Colonia the second.
    const route: LiveHop[] = [ROUTE[0]!, ROUTE[1]!, { ...ROUTE[2]!, kind: "waypoint" }, ROUTE[3]!];
    const targets = [
      { name: "PSR B", x: 440, y: 0, z: 0 },
      { name: "Colonia", x: 900, y: 0, z: 0 },
    ];
    t.live.start(route, t.at("Sol", 0), { targets, rangeLy: 50 });
    expect(t.live.remaining()?.targets.map((x) => x.name)).toEqual(["PSR B", "Colonia"]);
    // Near the way to PSR A (60 ly aside of the line, range 50: within 100): on the route.
    expect(t.live.offRoute({ name: "Near", pos: { x: 100, y: 60, z: 0 } })).toBe(false);
    expect(t.live.offRoute({ name: "Far", pos: { x: 100, y: 300, z: 0 } })).toBe(true);
    t.live.onJump(t.at("PSR A", 200));
    t.live.onJump(t.at("PSR B", 440));
    // PSR B reached: only Colonia is left.
    expect(t.live.remaining()?.targets.map((x) => x.name)).toEqual(["Colonia"]);
    const v = t.live.version();
    // Planned again from where the ship went: the new route's next stop is copied, the version moves on.
    const fresh: LiveHop[] = [
      hop("Here", 500, { kind: "start", jumps: 0, boosted: 0 }),
      hop("PSR C", 700),
      hop("Colonia", 900, { kind: "waypoint" }),
    ];
    expect(t.live.replace(fresh, [targets[1]!])).toBe("PSR C");
    expect(t.live.version()).toBeGreaterThan(v);
    expect(t.live.view(t.at("Here", 500))).toMatchObject({ at: 0, next: "PSR C", destination: "Colonia" });
    t.live.setReplanning(true);
    expect(t.live.view(t.at("Here", 500))?.replanning).toBe(true);
    // While a re-plot runs it is not asked for again.
    expect(t.live.offRoute({ name: "Far", pos: { x: 600, y: 500, z: 0 } })).toBe(false);
  });

  it("arriving at the last stop moves the version on (the map clears) and says so (review 1.2.16)", () => {
    let doneCalls = 0;
    const live = createNeutronLive({ filePath: null, deliver: () => undefined, onDone: () => doneCalls++ });
    live.start(ROUTE, { name: "PSR B", pos: null });
    const v = live.version();
    live.onJump({ name: "Colonia", pos: null });
    expect(live.version()).toBeGreaterThan(v);
    expect(doneCalls).toBe(1);
  });

  it("a new route clears the re-plotting mark of the one before", () => {
    const t = setup();
    t.live.start(ROUTE, t.at("Sol", 0));
    t.live.setReplanning(true);
    t.live.start(ROUTE, t.at("Sol", 0));
    expect(t.live.view(t.at("Sol", 0))?.replanning).toBe(false);
  });

  it("stops completely: nothing left to show, a new version for the map to clear", () => {
    const t = setup();
    t.live.start(ROUTE, t.at("Sol", 0));
    const v = t.live.version();
    t.live.stop();
    expect(t.live.active()).toBe(false);
    expect(t.live.view(t.at("Sol", 0))).toBeNull();
    expect(t.live.version()).toBeGreaterThan(v);
    expect(t.live.remaining()).toBeNull();
  });
});
