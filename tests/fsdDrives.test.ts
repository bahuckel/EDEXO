/**
 * The drive's own law from its module's constants (owner, 2026-10-30: "we need this to be more accurate"): the
 * Loadout's MaxJumpRange given back to the hundredth, the range and fuel at any tank without a jump flown. Ships from a
 * tester's EDSY export (Caspian, Mk II SCO drive, size 5 Guardian booster) and the owner's Mandalay Loadout.
 */
import { describe, expect, it } from "vitest";
import { driveFuelT, driveRangeLy, fsdDriveFromLoadout, fsdDriveOf } from "../src/shared/fsdDrives.js";
import {
  emptyFsdFuel,
  fsdFuelEngineerCraft,
  fsdFuelLoadout,
  fsdFuelModel,
  fuelForJump,
  maxJumpLy,
} from "../src/shared/fsdFuel.js";
import { GameStateStore } from "../src/server/gameState.js";
import { lawFor, neutronShip } from "../src/server/neutronShip.js";
import { refuelWindow } from "../src/server/neutronFuelWindow.js";
import { planNeutronRoute } from "../src/server/neutronRoute.js";
import type { NeutronStar } from "../src/server/neutronIndex.js";
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
    // The planner gets the law for this ship's range (as the drawer sends it, to a tenth), not for one typed in.
    expect(lawFor(s, 85.5)!.rangeLy(64)).toBeCloseTo(89.342, 2);
    expect(lawFor(s, 60)).toBeNull();
  });
});

describe("an engineer's roll before the next Loadout", () => {
  // The Mandalay before its Deep Charge roll: the module's 5.2 t a jump, its range as the game would give it.
  const fsd = { Slot: "FrameShiftDrive", Item: "int_hyperdrive_overcharge_size5_class5" };
  const before = [{ Label: "Mass", Value: 26, OriginalValue: 20 }, { Label: "FSDOptimalMass", Value: 1997.5, OriginalValue: 1175 }];
  const loadout = () => {
    const mods = { ...fsd, Engineering: { Modifiers: before } };
    const d = fsdDriveOf(fsd.Item, before, 7.75)!;
    return { ...mandalay, MaxJumpRange: driveRangeLy(d, 5.2, 329.299988 + 5.2), Modules: [mods, mandalay.Modules[1]!] };
  };
  const craft = (slot: string, module: string, modifiers: object[]) => ({ event: "EngineerCraft", Slot: slot, Module: module, Modifiers: modifiers });

  it("takes the drive's new fuel per jump and optimal mass at once", () => {
    const st = emptyFsdFuel();
    fsdFuelLoadout(st, loadout());
    expect(st.drive!.maxFuelT).toBe(5.2);
    st.samples = [{ ly: 40, fuelT: 2, massT: 360 }];
    fsdFuelEngineerCraft(st, craft("FrameShiftDrive", fsd.Item, [...before, { Label: "MaxFuelPerJump", Value: 5.72, OriginalValue: 5.2 }]));
    expect(st.drive).toMatchObject({ optMassT: 1997.5, maxFuelT: 5.72, boosterLy: 7.75 });
    expect(st.maxFuelPerJumpT).toBe(5.72);
    // The drive's mass did not change; its samples are another drive's.
    expect(st.unladenT).toBeCloseTo(329.299988, 6);
    expect(st.samples).toEqual([]);
    expect(maxJumpLy(fsdFuelModel(st)!, 5.72)).toBeCloseTo(79.261566, 2);
  });

  it("moves the ship's mass by the module's, from its engineered mass or else the craft's base", () => {
    const st = emptyFsdFuel();
    fsdFuelLoadout(st, loadout());
    // Heavy duty armour on a module the Loadout did not list as engineered: from its base 20 t to 30 t.
    fsdFuelEngineerCraft(st, craft("Armour", "mandalay_armour_grade1", [{ Label: "Mass", Value: 30, OriginalValue: 20 }]));
    expect(st.unladenT).toBeCloseTo(339.299988, 6);
    // Rolled again: from the 30 t it now has.
    fsdFuelEngineerCraft(st, craft("Armour", "mandalay_armour_grade1", [{ Label: "Mass", Value: 28, OriginalValue: 20 }]));
    expect(st.unladenT).toBeCloseTo(337.299988, 6);
    // The drive's 26 t was in the Loadout: a lighter roll takes 2 t off.
    fsdFuelEngineerCraft(st, craft("FrameShiftDrive", fsd.Item, [{ Label: "Mass", Value: 24, OriginalValue: 20 }, before[1]!]));
    expect(st.unladenT).toBeCloseTo(335.299988, 6);
  });

  it("is read from the journal", () => {
    const s = new GameStateStore();
    s.apply({ ...loadout(), timestamp: "2026-10-30T08:00:00Z" } as never);
    s.apply({
      timestamp: "2026-10-30T08:05:00Z",
      ...craft("FrameShiftDrive", fsd.Item, [...before, { Label: "MaxFuelPerJump", Value: 5.72 }]),
    } as never);
    expect(s.fsdFuel.drive!.maxFuelT).toBe(5.72);
  });

  it("leaves an unproven drive to the fitted law", () => {
    const st = emptyFsdFuel();
    fsdFuelLoadout(st, { ...loadout(), MaxJumpRange: 70 });
    expect(st.drive).toBeNull();
    fsdFuelEngineerCraft(st, craft("FrameShiftDrive", fsd.Item, [...before, { Label: "MaxFuelPerJump", Value: 5.72 }]));
    expect(st.drive).toBeNull();
    expect(st.maxFuelPerJumpT).toBe(5.72);
  });
});

describe("the planner with the drive's law", () => {
  const st = emptyFsdFuel();
  fsdFuelLoadout(st, caspian);
  const m = fsdFuelModel(st)!;
  const law = {
    tankT: 128,
    perJumpT: 6.8,
    fuelT: (ly: number, t: number) => fuelForJump(m, ly, t),
    rangeLy: (t: number) => maxJumpLy(m, t) ?? 0,
  };
  const table = Array.from({ length: 21 }, (_, i) => maxJumpLy(m, Math.max(6.8, (128 * i) / 20))! / maxJumpLy(m, 128)!);
  // Neutron stars every 300 ly (a full tank's ×6 is 513 ly: none can be skipped), then one 530 ly on, no scooping.
  const stars: NeutronStar[] = [...Array.from({ length: 9 }, (_, i) => i * 300), 2930].map((x, i) => ({ i, x, y: 0, z: 0, scoopLs: null }));
  const idx = {
    within: (p: { x: number; y: number; z: number }, r: number) => stars.filter((s) => Math.abs(s.x - p.x) <= r && p.y === 0),
    nameOf: (i: number) => `N${i}`,
  };
  const ship = { rangeLy: maxJumpLy(m, 128)!, rangeByFuel: table, boost: 6, jumpsPerTank: 18, jumpsNow: 18 };
  const plan = (withLaw: boolean) =>
    planNeutronRoute(idx, [{ name: "A", x: 0, y: 0, z: 0 }, { name: "B", x: 2930, y: 0, z: 0 }], {
      ...ship,
      ...(withLaw ? { law, fuelNowT: 128 } : {}),
    });

  it("counts each short supercharge at its own fuel, so the long one is planned on the range the ship has", async () => {
    // Eight 300 ly supercharges spend about 1.7 t each: 114 t left, a reach of 517 ly, short of 530.
    let fuel = 128;
    for (let k = 0; k < 8; k++) fuel -= fuelForJump(m, 50, fuel);
    expect(6 * maxJumpLy(m, fuel)!).toBeLessThan(530);
    // Counted at 6.8 t a jump the tank looked 71 t full, the ship lighter, and the 530 ly hop one supercharge.
    expect((await plan(false)).hops.at(-1)!.jumps).toBe(1);
    // By the law: the supercharge and a jump.
    const last = (await plan(true)).hops.at(-1)!;
    expect(last).toMatchObject({ jumps: 2, boosted: 1 });
    expect(last.rangeLy!).toBeCloseTo(maxJumpLy(m, fuel)!, 1);
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
