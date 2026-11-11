/**
 * Review 2026-11-10 B12: "Fly this route" placed the ship at the last stop it is in, so a route that comes back through
 * its start (out and back) began at the end and skipped every destination before it.
 */
import { describe, expect, it } from "vitest";
import { createNeutronLive, type LiveHop } from "../src/server/neutronLive.js";

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

describe("flying a route", () => {
  it("starts at the first stop the ship is in, on a route that passes its start again", () => {
    const copied: string[] = [];
    const live = createNeutronLive({ filePath: null, deliver: (n) => copied.push(n) });
    const hops = [{ ...hop("Sol", 0), kind: "start" as const, jumps: 0 }, hop("Alpha Centauri", 4), hop("Sol", 0), hop("Wolf 359", 8)];
    expect(live.start(hops, { name: "Sol", pos: null })).toBe("Alpha Centauri");
  });
});
