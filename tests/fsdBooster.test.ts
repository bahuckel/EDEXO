/**
 * The Guardian FSD Booster's bonus is flat (a tester, 2026-10-29: a Caspian with the size 5 one reaches 532.75 ly
 * supercharged and could not make the 534 ly hop the neutron planner gave it, which scaled the bonus with the lighter
 * tank). And a planet round a barycentre of stars orbits a star (fresh EDDN, 2026-10-29: Concha labiata demoted as a
 * wide moon on "Pleia Aoc JH-T c17-0 BC 2").
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { neutronShip } from "../src/server/neutronShip.js";
import { orbitsAStar } from "../src/server/orbitUtils.js";
import {
  emptyFsdFuel,
  fsdFuelJump,
  fsdFuelLoadout,
  fsdFuelModel,
  guardianBoosterLy,
  maxJumpLy,
} from "../src/shared/fsdFuel.js";

const ts = "2026-10-29T12:00:00Z";
const booster = (size: number, on = true) => ({ Slot: "Slot05_Size5", Item: `int_guardianfsdbooster_size${size}`, On: on });
const drive = {
  Slot: "FrameShiftDrive",
  Item: "int_hyperdrive_overcharge_size5_class5",
  Engineering: { Modifiers: [{ Label: "MaxFuelPerJump", Value: 5 }] },
};

describe("the Guardian FSD Booster's bonus", () => {
  it("is read by size from the Loadout, and is 0 when switched off or missing", () => {
    expect([1, 2, 3, 4, 5].map((s) => guardianBoosterLy([booster(s)]))).toEqual([4, 6, 7.75, 9.25, 10.5]);
    expect(guardianBoosterLy([booster(5, false)])).toBe(0);
    expect(guardianBoosterLy([drive])).toBe(0);
    expect(guardianBoosterLy(undefined)).toBe(0);
  });

  it("stays flat in the longest jump the fitted law gives at another mass", () => {
    // A ship whose longest jump is C / mass + 10.5 ly; jumps flown at 400-430 t on part of its 5 t per jump.
    const C = 25000;
    const b = 10.5;
    const truth = (mass: number) => C / mass + b;
    const st = emptyFsdFuel();
    fsdFuelLoadout(st, { event: "Loadout", ShipID: 1, UnladenMass: 380, MaxJumpRange: truth(385), Modules: [drive, booster(5)] });
    for (let i = 0; i < 24; i++) {
      const fuel = 1 + (i % 5);
      const mass = 400 + i * 1.25;
      const ly = truth(mass) * (fuel / 5) ** (1 / 2.45);
      fsdFuelJump(st, { JumpDist: ly, FuelUsed: fuel, FuelLevel: mass - 380 - fuel });
    }
    const m = fsdFuelModel(st)!;
    // A full 64 t tank (444 t) and a near-empty 6 t one (386 t), heavier and lighter than any jump flown.
    expect(Math.abs(maxJumpLy(m, 64)! - truth(444))).toBeLessThan(0.15);
    expect(Math.abs(maxJumpLy(m, 6)! - truth(386))).toBeLessThan(0.15);
    // Scaling the bonus with the mass too promised the lighter ship more than it has.
    const plain = fsdFuelModel({ ...st, boosterLy: 0 })!;
    expect(maxJumpLy(plain, 6)!).toBeGreaterThan(truth(386) + 0.5);
  });
});

describe("the neutron planner with a Guardian booster", () => {
  const loadout = {
    timestamp: ts,
    event: "Loadout",
    Ship: "explorer_nx",
    ShipID: 7,
    UnladenMass: 1181.245,
    MaxJumpRange: 93.138074,
    FuelCapacity: { Main: 128, Reserve: 1.14 },
    Modules: [
      {
        Slot: "FrameShiftDrive",
        Item: "int_hyperdrive_overcharge_size8_class5_overchargebooster_mkii",
        Engineering: { Modifiers: [{ Label: "MaxFuelPerJump", Value: 13.6 }] },
      },
      { Slot: "Slot05_Size5", Item: "int_guardianfsdbooster_size5", On: true },
    ],
  };

  it("scales only the drive's part of the range with the mass", () => {
    const s = new GameStateStore();
    s.apply(loadout as never);
    s.apply({ timestamp: ts, event: "Cargo", Vessel: "Ship", Count: 0 } as never);
    const ship = neutronShip(s);
    // Full tank: the drive's 82.638 ly at 1,194.845 t carried to 1,309.245 t, plus the flat 10.5.
    const full = (82.638074 * 1194.845) / 1309.245 + 10.5;
    expect(ship.rangeLy).toBeCloseTo(full, 6);
    // Half a tank: only the drive's part grows.
    const half = (82.638074 * 1194.845) / 1245.245 + 10.5;
    expect(ship.rangeLy! * ship.rangeByFuel![10]!).toBeCloseTo(half, 6);
    // The old way, the whole range scaled, was ~0.6 ly (3.4 ly supercharged) further.
    expect(ship.rangeLy! * (1309.245 / 1245.245) - half).toBeGreaterThan(0.5);
  });
});

describe("orbitsAStar", () => {
  it("is true round a star, a barycentre of stars, or a chain of barycentres; false round a planet", () => {
    expect(orbitsAStar([{ Star: 0 }])).toBe(true);
    expect(orbitsAStar([{ Null: 2 }, { Star: 0 }])).toBe(true);
    expect(orbitsAStar([{ Null: 2 }, { Null: 0 }])).toBe(true);
    expect(orbitsAStar([{ Planet: 37 }, { Null: 2 }, { Null: 0 }])).toBe(false);
    expect(orbitsAStar([{ Null: 9 }, { Planet: 4 }, { Star: 0 }])).toBe(false);
    expect(orbitsAStar([])).toBe(false);
    expect(orbitsAStar(undefined)).toBe(false);
  });
});
