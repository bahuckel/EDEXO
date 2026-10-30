/**
 * The drive's own law from its module's constants (owner, 2026-10-30: "we need this to be more accurate"): the
 * Loadout's MaxJumpRange given back to the hundredth, the range and fuel at any tank without a jump flown. Ships from a
 * tester's EDSY export (Caspian, Mk II SCO drive, size 5 Guardian booster) and the owner's Mandalay Loadout.
 */
import { describe, expect, it } from "vitest";
import { driveFuelT, driveRangeLy, fsdDriveFromLoadout } from "../src/shared/fsdDrives.js";
import { emptyFsdFuel, fsdFuelLoadout, fsdFuelModel, fuelForJump, maxJumpLy } from "../src/shared/fsdFuel.js";
import { GameStateStore } from "../src/server/gameState.js";
import { neutronShip } from "../src/server/neutronShip.js";
import { refuelWindow } from "../src/server/neutronFuelWindow.js";
import type { LiveHop } from "../src/server/neutronLive.js";

const caspian = {
  timestamp: "2026-10-30T08:00:00Z",
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
      Engineering: { Modifiers: [{ Label: "Mass", Value: 208 }, { Label: "FSDOptimalMass", Value: 7528.04 }] },
    },
    { Slot: "Slot05_Size5", Item: "int_guardianfsdbooster_size5", On: true },
  ],
};

const mandalay = {
  event: "Loadout",
  Ship: "mandalay",
  ShipID: 3,
  UnladenMass: 329.299988,
  MaxJumpRange: 79.261566,
  FuelCapacity: { Main: 32, Reserve: 0.5 },
  Modules: [
    {
      Slot: "FrameShiftDrive",
      Item: "int_hyperdrive_overcharge_size5_class5",
      Engineering: {
        Modifiers: [
          { Label: "FSDOptimalMass", Value: 1997.5 },
          { Label: "MaxFuelPerJump", Value: 5.72 },
        ],
      },
    },
    { Slot: "Slot04_Size3", Item: "int_guardianfsdbooster_size3", On: true },
  ],
};

describe("the drive from a Loadout", () => {
  it("gives back the Loadout's range: the Caspian's 93.14 ly (module's own fuel per jump) and the Mandalay's 79.26 ly", () => {
    const c = fsdDriveFromLoadout(caspian, 10.5)!;
    expect(c).toMatchObject({ optMassT: 7528.04, maxFuelT: 6.8, mul: 0.011, pow: 2.5025, boosterLy: 10.5 });
    expect(driveRangeLy(c, 6.8, 1181.245 + 6.8)).toBeCloseTo(93.138074, 4);
    const m = fsdDriveFromLoadout(mandalay, 7.75)!;
    expect(driveRangeLy(m, 5.72, 329.299988 + 5.72)).toBeCloseTo(79.261566, 4);
  });

  it("is null for an unknown module, and when the Loadout's range says the constants are not this drive's", () => {
    const odd = { ...caspian, Modules: [{ Slot: "FrameShiftDrive", Item: "int_hyperdrive_size9_class5" }] };
    expect(fsdDriveFromLoadout(odd, 0)).toBeNull();
    expect(fsdDriveFromLoadout({ ...caspian, MaxJumpRange: 93.5 }, 10.5)).toBeNull();
    // Without the booster the range is 10.5 ly short of the Loadout's: not this ship.
    expect(fsdDriveFromLoadout(caspian, 0)).toBeNull();
  });
});

describe("the drive's law", () => {
  const c = fsdDriveFromLoadout(caspian, 10.5)!;

  it("adds the booster's bonus whole to the longest jump at any mass, and stretches shorter ones in proportion", () => {
    // Full 128 t tank: 85.49 ly; the bonus does not grow as the ship gets lighter.
    expect(driveRangeLy(c, 6.8, 1181.245 + 128)).toBeCloseTo(85.488, 2);
    expect(driveRangeLy(c, 6.8, 1181.245 + 64)).toBeCloseTo(89.342, 2);
    // Half the drive's fuel per jump: the drive's reach for it, times (R + B) / R.
    expect(driveRangeLy(c, 3.4, 1181.245 + 128)).toBeCloseTo(64.806, 2);
  });

  it("spends, for a jump, the fuel whose range it is", () => {
    for (const f of [1, 3.4, 6.8]) {
      const mass = 1181.245 + 40;
      expect(driveFuelT(c, driveRangeLy(c, f, mass), mass)).toBeCloseTo(f, 6);
    }
  });
});

describe("the fuel model with a known drive", () => {
  it("needs no jump flown: the Caspian's longest jump on a full and a half tank", () => {
    const st = emptyFsdFuel();
    fsdFuelLoadout(st, caspian);
    const m = fsdFuelModel(st)!;
    expect(m.drive).toBeTruthy();
    expect(m.maxFuelPerJumpT).toBe(6.8);
    expect(maxJumpLy(m, 128)).toBeCloseTo(85.488, 2);
    expect(maxJumpLy(m, 64)).toBeCloseTo(89.342, 2);
    // 20 t of cargo: heavier, shorter.
    expect(maxJumpLy(m, 128, 20)!).toBeLessThan(85.488 - 1);
    expect(fuelForJump(m, 85.488, 128)).toBeCloseTo(6.8, 3);
  });

  it("plans the neutron route on the full tank's exact range, longer on a lighter tank", () => {
    const s = new GameStateStore();
    s.apply(caspian as never);
    const ship = neutronShip(s);
    expect(ship.rangeLy).toBeCloseTo(85.488, 2);
    expect(ship.boostFactor).toBe(6);
    // The table's last entry is the full tank; an emptier one jumps further.
    expect(ship.rangeByFuel!.at(-1)).toBeCloseTo(1, 6);
    expect(ship.rangeByFuel![10]! * ship.rangeLy!).toBeCloseTo(89.342, 2);
  });
});

describe("the refuel window with the drive's law", () => {
  const hop = (name: string, x: number, extra: Partial<LiveHop> = {}): LiveHop => ({
    name, x, y: 0, z: 0, kind: "neutron", jumps: 1, boosted: 1, refuel: false, scoopLs: null, scoopOnWay: false, ...extra,
  });
  const st = emptyFsdFuel();
  fsdFuelLoadout(st, caspian);
  const m = fsdFuelModel(st)!;
  const law = { fuelT: (ly: number, t: number) => fuelForJump(m, ly, t), rangeLy: (t: number) => maxJumpLy(m, t) ?? 0 };
  const ship = { rangeLy: 85.488, rangeByFuel: null, boost: 6, fuelPerJumpT: 6.8, tankT: 128, law };

  it("counts a short supercharge at its own fuel, not the drive's most", () => {
    // Two 300 ly supercharges (50 ly a jump's worth each) to the next refuel.
    const route = [hop("A", 0, { refuel: true, scoopLs: 10 }), hop("B", 300), hop("C", 600, { refuel: true })];
    const exact = refuelWindow(route, 0, ship, 20)!;
    const fixed = refuelWindow(route, 0, { ...ship, law: null }, 20)!;
    // At the most per jump: 6.8 t for B and 6.8 t for C (or a jump to spare at B) = 13.6 t; by the law B costs less.
    expect(fixed.minT).toBeCloseTo(13.6, 6);
    expect(exact.minT).toBeLessThan(10);
    expect(exact.minT).toBeGreaterThan(6.8);
    expect(exact.maxT).toBe(128);
  });

  it("caps the tank where a long supercharge stops reaching", () => {
    // 530 ly: 88.33 ly a jump, which the Caspian makes on about 70 t or less.
    const route = [hop("A", 0, { refuel: true, scoopLs: 10 }), hop("B", 530, { refuel: true })];
    const w = refuelWindow(route, 0, ship, 100)!;
    expect(w.maxT).toBeGreaterThan(60);
    expect(w.maxT).toBeLessThan(81);
    expect(6 * law.rangeLy(w.maxT)).toBeGreaterThanOrEqual(530 - 1e-6);
    // To the tenth of a tonne: 0.2 t more and it falls short.
    expect(6 * law.rangeLy(w.maxT + 0.2)).toBeLessThan(530);
  });
});
