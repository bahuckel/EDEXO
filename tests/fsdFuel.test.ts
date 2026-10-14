/**
 * Fuel per jump by the drive's own law, fitted on the commander's jumps (shared/fsdFuel.ts; owner,
 * 2026-10-08), and the route's fuel with it (server/navRouteFuel.ts).
 */
import { describe, expect, it, vi } from "vitest";
import {
  emptyFsdFuel,
  fsdFuelCargo,
  fsdFuelJump,
  fsdFuelLoadout,
  fsdFuelModel,
  fuelForJump,
  maxJumpLy,
} from "../src/shared/fsdFuel.js";
import { analyzeNavRouteFuel } from "../src/server/navRouteFuel.js";

// The owner's Mandalay: 369.3 t unladen, a 5A SCO drive with 5.72 t most per jump, 32 t tank.
const loadout = {
  event: "Loadout",
  ShipID: 12,
  UnladenMass: 369.3,
  MaxJumpRange: 71.634071,
  Modules: [
    { Slot: "FrameShiftDrive", Engineering: { Modifiers: [{ Label: "MaxFuelPerJump", Value: 5.72 }] } },
  ],
};
// The law his 300 jumps fit: fuel = k · (distance · mass)^2.449.
const P = 2.449;
const K = 5.72 / (67.38 * 401.3) ** P;
function flown(n: number) {
  const st = emptyFsdFuel();
  fsdFuelLoadout(st, loadout);
  let tank = 32;
  for (let i = 0; i < n; i++) {
    const d = 30 + ((i * 7) % 38); // 30 … 67 ly
    const used = K * (d * (369.3 + tank)) ** P;
    tank -= used;
    fsdFuelJump(st, { event: "FSDJump", JumpDist: d, FuelUsed: used, FuelLevel: tank });
    if (tank < 10) tank = 32;
  }
  return st;
}

describe("fuel per jump", () => {
  it("fits the drive's power and constant from the jumps", () => {
    const m = fsdFuelModel(flown(30))!;
    expect(m.fitted).toBe(true);
    expect(m.p).toBeCloseTo(P, 3);
    expect(fuelForJump(m, 60, 25)).toBeCloseTo(K * (60 * 394.3) ** P, 4);
  });

  it("gives the longest jump on this tank: about 67.4 ly full, 72 ly nearly empty", () => {
    const m = fsdFuelModel(flown(30))!;
    expect(maxJumpLy(m, 32)).toBeCloseTo(67.38, 1);
    expect(maxJumpLy(m, 5.72)!).toBeGreaterThan(71.5);
    expect(maxJumpLy(m, 2)!).toBeLessThan(maxJumpLy(m, 5.72)!); // less fuel than one full jump needs
  });

  it("leaves out boosted jumps, and starts over for another ship", () => {
    const st = flown(10);
    const n = st.samples.length;
    fsdFuelJump(st, { event: "FSDJump", JumpDist: 260, FuelUsed: 5.72, FuelLevel: 20, BoostUsed: 4 });
    expect(st.samples).toHaveLength(n);
    fsdFuelLoadout(st, { ...loadout, ShipID: 99 });
    expect(st.samples).toEqual([]);
  });

  it("assumes the class A power until the jumps are varied enough to fit it", () => {
    const st = emptyFsdFuel();
    fsdFuelLoadout(st, loadout);
    fsdFuelJump(st, { event: "FSDJump", JumpDist: 40, FuelUsed: 1.5, FuelLevel: 30 });
    const m = fsdFuelModel(st)!;
    expect(m.fitted).toBe(false);
    expect(m.p).toBe(2.45);
  });
});

describe("the route's fuel with the drive's law", () => {
  const roles = {
    fuelPrefixes: ["K", "G"],
    neutronExact: ["N"],
    blackHoleExact: ["H"],
    whiteDwarfPrefix: "D",
  };
  // Three 66 ly legs after a 30 ly jump, 13 t in the tank: the old rule says 3 × 3.5 t, the law 3 × 4.8 t.
  const route = [0, 66, 132, 198].map((x, i) => ({
    systemAddress: i + 1,
    starSystem: `S${i}`,
    starPos: [x, 0, 0] as [number, number, number],
    starClass: "M",
  }));
  const base = {
    route,
    currentSystemAddress: 1,
    fuelTotalT: 13,
    lastFsdFuelT: K * (30 * 386) ** P,
    lastFsdDistLy: 30,
    loadoutMaxJumpLy: 71.63,
    starRoles: roles,
  };

  it("the old rule (last jump × distance²) said the tank lasts; the drive's law says two legs", () => {
    expect(analyzeNavRouteFuel(base)!.fuelCanFinishPlottedRoute).toBe(true);
    const a = analyzeNavRouteFuel({ ...base, fuelModel: fsdFuelModel(flown(30)) })!;
    expect(a.fuelCanFinishPlottedRoute).toBe(false);
    expect(a.fuelJumpsReachableOnPlottedRoute).toBe(2);
  });

  /*
    It used to stop there: the law's longest jump with ~25 t aboard is under 69.5 ly. But the game plotted the leg,
    and on the owner's history 41 of 677 full-tank jumps went further than the law's longest jump (up to 17.5 %), so
    the pump blinked red on a full tank (2026-10-15). The fuel decides, a leg costing at most the drive's most fuel.
  */
  it("counts a plotted leg the law calls out of reach: the game plotted it", () => {
    const far = [
      ...route.slice(0, 2),
      { ...route[2]!, starPos: [66 + 69.5, 0, 0] as [number, number, number] },
    ];
    const model = fsdFuelModel(flown(30))!;
    const a = analyzeNavRouteFuel({ ...base, route: far, fuelTotalT: 30, fuelModel: model })!;
    expect(a.fuelJumpsReachableOnPlottedRoute).toBe(2);
    expect(a.fuelCanFinishPlottedRoute).toBe(true);
    // Each leg costs no more than the drive can spend on one jump: two of them out of 30 t leave fuel over.
    expect(2 * model.maxFuelPerJumpT!).toBeLessThan(30);
  });
});

/*
  Code review, 2026-10-14: every jump, replayed or live, was sampled with live Status.json's cargo (0 t before the
  first poll, today's load after a resync). The journal's own Cargo lines say what was aboard at each jump.
*/
describe("the cargo a jump was made with", () => {
  const CARGO = 100;
  /** Eight jumps of a ship carrying 100 t, by the drive's law, as journal lines. */
  function ladenJumps(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    let tank = 32;
    for (const d of [20, 24, 28, 32, 36, 40, 44, 47]) {
      const used = K * (d * (369.3 + CARGO + tank)) ** P;
      tank -= used;
      out.push({ event: "FSDJump", JumpDist: d, FuelUsed: used, FuelLevel: tank });
      tank = 32;
    }
    return out;
  }

  it("is the journal's Cargo count, the SRV's left out", () => {
    const st = emptyFsdFuel();
    fsdFuelLoadout(st, loadout);
    fsdFuelCargo(st, { event: "Cargo", Vessel: "Ship", Count: CARGO });
    fsdFuelCargo(st, { event: "Cargo", Vessel: "SRV", Count: 2 });
    for (const j of ladenJumps()) fsdFuelJump(st, j, st.cargoT);
    const m = fsdFuelModel(st)!;
    expect(m.k).toBeCloseTo(K, 12);
    expect(fuelForJump(m, 45, 32, CARGO)).toBeCloseTo(K * (45 * (369.3 + CARGO + 32)) ** P, 6);
  });

  it("leaves a jump out when it is not known, rather than taking 0 t", () => {
    const st = emptyFsdFuel();
    fsdFuelLoadout(st, loadout);
    for (const j of ladenJumps()) fsdFuelJump(st, j, null);
    expect(st.samples).toEqual([]);
  });

  it("through the store: a replay before any Status.json poll learns the drive as flown", async () => {
    const { GameStateStore } = await import("../src/server/gameState.js");
    const s = new GameStateStore();
    let t = Date.parse("2026-10-01T10:00:00Z");
    const at = (o: Record<string, unknown>) => ({ timestamp: new Date((t += 60_000)).toISOString(), ...o });
    s.apply(at(loadout));
    s.apply(at({ event: "Cargo", Vessel: "Ship", Count: CARGO, Inventory: [] }));
    for (const j of ladenJumps()) s.apply(at({ StarSystem: "Test", SystemAddress: 1, StarPos: [0, 0, 0], ...j }));
    expect(s.liveStatusCargoT).toBeNull(); // as on a first start: the poll begins after the replay
    expect(fsdFuelModel(s.fsdFuel)!.k).toBeCloseTo(K, 12);
    // Another ship: its hold is unknown until its own Cargo line (the game writes none after a swap).
    s.apply(at({ event: "ShipyardSwap", ShipType: "anaconda", ShipID: 13 }));
    expect(s.fsdFuel.cargoT).toBeNull();
    const [jump] = ladenJumps();
    const n = s.fsdFuel.samples.length;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Live: Status.json read as the jump is made, so its cargo is that jump's.
      vi.setSystemTime(t + 60_000);
      s.applyLiveShipFuel(20, 0.5, CARGO);
      s.apply(at({ StarSystem: "Test", SystemAddress: 1, StarPos: [0, 0, 0], ...jump }));
      expect(s.fsdFuel.samples).toHaveLength(n + 1);
      // A replayed jump from a month before gets nothing from today's Status.json.
      s.apply({ timestamp: "2026-09-01T10:00:00Z", StarSystem: "Test", SystemAddress: 1, StarPos: [0, 0, 0], ...jump });
      expect(s.fsdFuel.samples).toHaveLength(n + 1);
      // (Old lines are read: with the journal's own cargo the same old jump is a sample.)
      s.apply({ timestamp: "2026-09-01T10:01:00Z", event: "Cargo", Vessel: "Ship", Count: CARGO });
      s.apply({ timestamp: "2026-09-01T10:02:00Z", StarSystem: "Test", SystemAddress: 1, StarPos: [0, 0, 0], ...jump });
      expect(s.fsdFuel.samples).toHaveLength(n + 2);
    } finally {
      vi.useRealTimers();
    }
  });
});
