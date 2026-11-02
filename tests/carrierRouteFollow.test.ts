/**
 * A Spansh fleet carrier route flown with the commander's carrier (plan 1.3.6, owner 2026-11-02): the live route
 * moves on when the carrier arrives at a stop, aboard or not, and the next stop goes to the clipboard; the ship's jumps
 * leave it alone.
 */
import { describe, expect, it } from "vitest";
import { createNeutronLive, type LiveHop } from "../src/server/neutronLive.js";
import { carrierHereOf, createCarrierRouteFollow } from "../src/server/carrierRouteFollow.js";
import { newOwnAssets, ownAssetsLine } from "../src/shared/ownAssets.js";

const hop = (name: string, x: number): LiveHop => ({
  name,
  x,
  y: 0,
  z: 0,
  kind: "waypoint",
  jumps: 1,
  boosted: 0,
  refuel: false,
  scoopLs: null,
  scoopOnWay: false,
  inject: null,
});
const hops = [{ ...hop("Sol", 0), kind: "start" as const, jumps: 0 }, hop("Alpha Centauri", 400), hop("Wolf 359", 800)];

function setup() {
  const store = { ownAssets: newOwnAssets() };
  ownAssetsLine(store.ownAssets, { timestamp: "2026-11-02T18:00:00Z", event: "CarrierLocation", CarrierType: "FleetCarrier", StarSystem: "Sol", SystemAddress: 1 });
  const copied: string[] = [];
  const live = createNeutronLive({ filePath: null, deliver: (n) => copied.push(n), carrierHere: () => carrierHereOf(store, now) });
  let now = Date.parse("2026-11-02T18:00:30Z");
  let pushes = 0;
  const follow = createCarrierRouteFollow({ store, neutronLive: live, push: () => pushes++, now: () => now });
  follow.stop();
  return { store, live, copied, follow, at: (iso: string) => (now = Date.parse(iso)), pushes: () => pushes };
}

describe("a carrier route", () => {
  it("starts where the carrier is and copies the stop after it", () => {
    const { live, store, copied } = setup();
    expect(live.start(hops, carrierHereOf(store), null, "carrier")).toBe("Alpha Centauri");
    expect(live.follows()).toBe("carrier");
    expect(copied).toEqual(["Alpha Centauri"]);
    expect(live.view({ name: "Somewhere else", pos: null })).toMatchObject({ carrier: true, at: 0, next: "Alpha Centauri" });
  });

  it("moves on when a scheduled jump lands by the clock, without a journal line, and ends at the last stop", () => {
    const t = setup();
    t.live.start(hops, carrierHereOf(t.store), null, "carrier");
    t.follow.tick();
    ownAssetsLine(t.store.ownAssets, {
      timestamp: "2026-11-02T18:01:00Z",
      event: "CarrierJumpRequest",
      CarrierType: "FleetCarrier",
      SystemName: "Alpha Centauri",
      SystemAddress: 2,
      DepartureTime: "2026-11-02T18:16:10Z",
    });
    t.at("2026-11-02T18:10:00Z");
    t.follow.tick();
    expect(t.copied).toEqual(["Alpha Centauri"]);
    // Departure plus the minute the jump takes: there, though he was not aboard.
    t.at("2026-11-02T18:17:20Z");
    t.follow.tick();
    expect(t.copied).toEqual(["Alpha Centauri", "Wolf 359"]);
    expect(t.pushes()).toBeGreaterThan(0);
    ownAssetsLine(t.store.ownAssets, { timestamp: "2026-11-02T18:40:00Z", event: "CarrierLocation", CarrierType: "FleetCarrier", StarSystem: "Wolf 359", SystemAddress: 3 });
    t.follow.tick();
    expect(t.live.active()).toBe(false);
    expect(t.live.view({ name: null, pos: null })).toMatchObject({ done: true, carrier: true, destination: "Wolf 359" });
  });

  it("is left alone by a ship route, which keeps following the ship", () => {
    const t = setup();
    t.live.start(hops, { name: "Sol", pos: null });
    expect(t.live.follows()).toBe("ship");
    ownAssetsLine(t.store.ownAssets, { timestamp: "2026-11-02T18:40:00Z", event: "CarrierLocation", CarrierType: "FleetCarrier", StarSystem: "Alpha Centauri", SystemAddress: 2 });
    t.follow.tick();
    expect(t.copied).toEqual(["Alpha Centauri"]);
    expect(t.live.view({ name: "Sol", pos: null })).toMatchObject({ at: 0 });
  });
});
