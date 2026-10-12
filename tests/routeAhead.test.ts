import { describe, expect, it } from "vitest";
import { analyzeNavRouteFuel, type NavRouteWaypointDTO } from "../src/server/navRouteFuel.js";
import type { StarRolesConfig } from "../src/server/systemMap.js";

const roles: StarRolesConfig = {
  fuelPrefixes: ["K", "G", "B", "F", "O", "A", "M"],
  neutronExact: ["N"],
  blackHoleExact: ["H"],
  whiteDwarfPrefix: "D",
};

/** Seven systems 10 ly apart in a line: A(K) B(T) C(M) D(K) E(T) F(N) G(K). */
function route(): NavRouteWaypointDTO[] {
  return routeOf(["K", "T", "M", "K", "T", "N", "K"]);
}
function routeOf(classes: string[]): NavRouteWaypointDTO[] {
  return classes.map((c, i) => ({
    systemAddress: i + 1,
    starSystem: String.fromCharCode(65 + i),
    starPos: [i * 10, 0, 0] as [number, number, number],
    starClass: c,
  }));
}

/** The last jump burned 1 t over 10 ly, so every leg here costs 1 t. */
function analyse(fuelTotalT: number | null, currentSystemAddress = 1, classes?: string[]) {
  return analyzeNavRouteFuel({
    route: classes ? routeOf(classes) : route(),
    currentSystemAddress,
    fuelTotalT,
    lastFsdFuelT: 1,
    lastFsdDistLy: 10,
    loadoutMaxJumpLy: 50,
    starRoles: roles,
  });
}

describe("route strip: the hops ahead and the refuel mark", () => {
  it("lists every remaining hop with its class and no pump when the tank lasts", () => {
    const a = analyse(20);
    expect(a?.ahead.map((h) => h.starClass)).toEqual(["T", "M", "K", "T", "N", "K"]);
    expect(a?.ahead.map((h) => h.scoopable)).toEqual([false, true, true, false, false, true]);
    expect(a?.ahead.every((h) => h.refuel === "none")).toBe(true);
    expect(a?.refuelInHops).toBeNull();
    expect(a?.refuelLevel).toBe("none");
  });

  it("puts the red pump on the last scoop the tank reaches and a yellow one on the nearest before it", () => {
    // budget 3 t → B, C, D reachable; scoops at C and D: D is the last chance (red), C the stop (yellow).
    const a = analyse(3.06);
    expect(a?.fuelCanFinishPlottedRoute).toBe(false);
    expect(a?.jumpsToLastScoopableOnRoute).toBe(3);
    expect(a?.refuelInHops).toBe(3);
    expect(a?.refuelLevel).toBe("red");
    expect(a?.ahead[2]).toMatchObject({ starClass: "K", refuel: "red" });
    expect(a?.ahead[1]).toMatchObject({ starClass: "M", refuel: "yellow" });
    expect(a?.ahead.filter((h) => h.refuel !== "none")).toHaveLength(2);
  });

  it("no threshold: red on the last reachable scoop even when another follows right after", () => {
    // budget 2 t → B (no scoop) and C (scoop) reachable; D (K) right after is out of reach: C is red.
    const a = analyse(2.06);
    expect(a?.refuelInHops).toBe(2);
    expect(a?.refuelLevel).toBe("red");
    expect(a?.ahead[1]?.refuel).toBe("red");
    expect(a?.ahead.filter((h) => h.refuel === "yellow")).toHaveLength(0);
  });

  it("goes red on the star the ship is at when it is the last scoop the tank reaches", () => {
    // At A (K) with 1 t: B (a brown dwarf) is the only hop in reach, so A is the last scoop. It used
    // to read "no scoopable star within reach", drawn at the end of the strip (owner, 2026-10-12).
    const a = analyse(1.06);
    expect(a?.refuelInHops).toBe(0);
    expect(a?.refuelLevel).toBe("red");
    expect(a?.routeRefuelAlert).toBe("red");
    expect(a?.ahead.every((h) => h.refuel === "none")).toBe(true);
  });

  it("goes red with no scoop within reach, here included", () => {
    // At B (T) with 0.5 t: not even C is in reach, and B cannot be scooped.
    const a = analyse(0.56, 2);
    expect(a?.refuelInHops).toBeNull();
    expect(a?.refuelLevel).toBe("red");
    expect(a?.ahead.every((h) => h.refuel === "none")).toBe(true);
  });

  it("is empty off the plot", () => {
    const a = analyse(20, 999);
    expect(a?.onPlot).toBe(false);
    expect(a?.ahead).toEqual([]);
  });

  it("stops at the destination", () => {
    const a = analyse(20, 7);
    expect(a?.ahead).toEqual([]);
    expect(a?.refuelLevel).toBe("none");
  });
});
