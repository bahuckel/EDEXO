/**
 * The ship the neutron planner plans for (server/neutronShip.ts): before any jump is flown in it, its range is the
 * laden one with a full tank, not the Loadout's empty-ship `MaxJumpRange` (a tester, 2026-10-28: a supercharge fell
 * short), and an engineered drive gives jumps a tank at once (owner, 2026-10-28: only after some jumps).
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { neutronShip } from "../src/server/neutronShip.js";

const ts = "2026-10-28T03:00:00Z";
const loadout = (extra: Record<string, unknown> = {}) => ({
  timestamp: ts,
  event: "Loadout",
  Ship: "mandalay",
  ShipID: 12,
  UnladenMass: 369.3,
  MaxJumpRange: 71.63,
  FuelCapacity: { Main: 32, Reserve: 0.5 },
  Modules: [
    {
      Slot: "FrameShiftDrive",
      Item: "int_hyperdrive_overcharge_size5_class5",
      Engineering: { Modifiers: [{ Label: "MaxFuelPerJump", Value: 5.72 }] },
    },
  ],
  ...extra,
});

describe("the neutron planner's ship before a jump is flown", () => {
  it("plans with the laden range on a full tank, below the Loadout's empty-ship range", () => {
    const s = new GameStateStore();
    s.apply(loadout() as never);
    const ship = neutronShip(s);
    // 71.63 ly at 369.3 + 5.72 t; a full 32 t tank: 71.63 × 375.02 / 401.3.
    expect(ship.rangeLy).toBeCloseTo((71.63 * 375.02) / 401.3, 6);
    expect(ship.rangeLy!).toBeLessThan(71.63);
  });

  it("never plans past the full tank's range, however long the jumps flown on a near-empty tank", () => {
    const s = new GameStateStore();
    s.apply(loadout() as never);
    s.apply({ timestamp: ts, event: "Cargo", Vessel: "Ship", Count: 0 } as never);
    for (const d of [71, 71.2, 71.4])
      s.apply({ timestamp: ts, event: "FSDJump", StarSystem: "A", JumpDist: d, FuelUsed: 5.6, FuelLevel: 1 } as never);
    expect(neutronShip(s).rangeLy!).toBeLessThan(71);
  });

  it("counts the hold too", () => {
    const s = new GameStateStore();
    s.apply(loadout() as never);
    s.apply({ timestamp: ts, event: "Cargo", Vessel: "Ship", Count: 100 } as never);
    expect(neutronShip(s).rangeLy).toBeCloseTo((71.63 * 375.02) / 501.3, 6);
  });

  it("gives jumps a tank from the engineered drive's fuel per jump, with no jump flown", () => {
    const s = new GameStateStore();
    s.apply(loadout() as never);
    expect(neutronShip(s).jumpsPerTank).toBe(Math.floor(32 / 5.72));
  });

  it("keeps jumps a tank through a refit that keeps the drive", () => {
    const s = new GameStateStore();
    s.apply(loadout({ Modules: [{ Slot: "FrameShiftDrive", Item: "int_hyperdrive_size5_class5" }] }) as never);
    s.apply({ timestamp: ts, event: "Cargo", Vessel: "Ship", Count: 0 } as never);
    s.apply({ timestamp: ts, event: "FSDJump", StarSystem: "A", JumpDist: 60, FuelUsed: 4, FuelLevel: 28 } as never);
    expect(neutronShip(s).jumpsPerTank).not.toBeNull();
    s.apply(
      loadout({
        UnladenMass: 400,
        MaxJumpRange: 66,
        Modules: [{ Slot: "FrameShiftDrive", Item: "int_hyperdrive_size5_class5" }],
      }) as never,
    );
    expect(neutronShip(s).jumpsPerTank).not.toBeNull();
  });

  it("gives the range by the fuel aboard: an emptier tank, a lighter ship, further", () => {
    const s = new GameStateStore();
    s.apply(loadout() as never);
    s.apply({ timestamp: ts, event: "Cargo", Vessel: "Ship", Count: 0 } as never);
    const t = neutronShip(s).rangeByFuel!;
    expect(t).toHaveLength(21);
    expect(t[20]).toBe(1);
    // Half a tank: 369.3 + 32 against 369.3 + 16.
    expect(t[10]).toBeCloseTo(401.3 / 385.3, 6);
    // Under one jump's fuel (5.72 t): never more than one jump's fuel allows.
    expect(t[0]).toBeCloseTo(401.3 / 375.02, 6);
    expect(t[1]).toBe(t[0]);
  });
});
