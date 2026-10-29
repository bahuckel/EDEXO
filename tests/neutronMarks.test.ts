/**
 * The neutron route on the galaxy map (client/galaxy3d/neutronMarks.ts; owner, 2026-10-28: the line only showed in
 * the route's own drawer, and "route points for stop, refuel and so on should be shown"): a dot on every stop after
 * the start, coloured by what it is, and the line the hover card says.
 */
import { describe, expect, it } from "vitest";
import {
  keepNeutronMarks,
  keptNeutronMarks,
  neutronMarkers,
  neutronStopLine,
  type NeutronMark,
} from "../src/client/galaxy3d/neutronMarks.js";

const at = (name: string, x: number, extra: Partial<NeutronMark> = {}): NeutronMark => ({
  name,
  x,
  y: 0,
  z: 0,
  kind: "neutron",
  jumps: 1,
  boosted: 1,
  ...extra,
});
const ROUTE: NeutronMark[] = [
  at("Sol", 0, { kind: "start", jumps: 0, boosted: 0 }),
  at("PSR A", 50, { boosted: 0 }),
  at("PSR B", 250, { refuel: true, refuelHalf: true }),
  at("Stop", 450, { kind: "waypoint" }),
  at("PSR C", 650),
  at("Colonia", 700, { kind: "waypoint", boosted: 0 }),
];

describe("neutron route marks", () => {
  it("puts a dot on every stop after the start: neutron stars, refuel stops and your own stops apart", () => {
    const dots = neutronMarkers(ROUTE);
    expect(dots.map((d) => d.id)).toEqual(["1", "2", "3", "4", "5"]);
    const [psrA, refuel, stop] = dots;
    expect(refuel!.color).not.toEqual(psrA!.color);
    expect(stop!.color).not.toEqual(psrA!.color);
    expect(stop!.size).toBeGreaterThan(psrA!.size);
  });

  it("says what to do at each stop", () => {
    expect(neutronStopLine(ROUTE, 1)).toBe("Neutron star: supercharge · stop 1 of 5");
    expect(neutronStopLine(ROUTE, 2)).toBe("Refuel stop: scoop to half a tank, then supercharge · stop 2 of 5");
    expect(neutronStopLine(ROUTE, 3)).toBe("Your stop: supercharge · stop 3 of 5");
    expect(neutronStopLine(ROUTE, 5)).toBe("Destination · stop 5 of 5");
  });

  it("keeps the route for the map when the drawer is closed", () => {
    keepNeutronMarks(ROUTE);
    expect(keptNeutronMarks()).toBe(ROUTE);
    keepNeutronMarks([]);
    expect(keptNeutronMarks()).toEqual([]);
  });
});
