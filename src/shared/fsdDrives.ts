/**
 * The frame shift drive's own law, from its module's constants (owner, 2026-10-30: "we need this to be more accurate";
 * a tester's Caspian, 2026-10-29, came up short on a planned supercharge).
 *
 *   longest jump at mass m:  R(m) = optMass / m · (maxFuel / mul) ^ (1 / pow), plus the Guardian booster's B
 *   a jump of d ly at mass m spends  mul · (d · m / (optMass · k(m))) ^ pow,  k(m) = (R(m) + B) / R(m)
 *   m = UnladenMass + the main tank's fuel + cargo (the reserve tank is not counted)
 *
 * A supercharge (neutron ×4, ×6 with the Mk II drive) multiplies the whole reach, booster included, and spends what a
 * jump of d / factor would. Measured on the owner's journals, 2026-10-30: 61 Loadouts' MaxJumpRange to 0.01 ly
 * (mass with min(maxFuel, tank) aboard), and 4,600 unboosted jumps' FuelUsed to a median of 0.04 % or better per drive
 * (class 5A, SCO 5A and 7A, with and without a booster); his Mandalay's 268.2 ly supercharge is past 4 R + B (253.5 ly).
 *
 * Constants as published in jixxed/ed-odyssey-materials-helper (MIT, FrameShiftDrive.java before 991a156b), the same
 * in EDCD's coriolis-data and EDSY but for two: SCO 5A's multiplier is 0.013 (coriolis: 0.012; the journals: 0.013) and
 * 4B's optimal mass 438 (coriolis: 437.5). Engineering's FSDOptimalMass and MaxFuelPerJump replace the module's.
 */

/** [optimal mass t, most fuel per jump t, fuel multiplier, fuel power] by FSD module (`Loadout` Item, lower case). */
const FSD: Readonly<Record<string, readonly [number, number, number, number]>> = {
  int_hyperdrive_size2_class1: [48, 0.6, 0.011, 2],
  int_hyperdrive_size2_class2: [54, 0.6, 0.01, 2],
  int_hyperdrive_size2_class3: [60, 0.6, 0.008, 2],
  int_hyperdrive_size2_class4: [75, 0.8, 0.01, 2],
  int_hyperdrive_size2_class5: [90, 0.9, 0.012, 2],
  int_hyperdrive_size3_class1: [80, 1.2, 0.011, 2.15],
  int_hyperdrive_size3_class2: [90, 1.2, 0.01, 2.15],
  int_hyperdrive_size3_class3: [100, 1.2, 0.008, 2.15],
  int_hyperdrive_size3_class4: [125, 1.5, 0.01, 2.15],
  int_hyperdrive_size3_class5: [150, 1.8, 0.012, 2.15],
  int_hyperdrive_size4_class1: [280, 2, 0.011, 2.3],
  int_hyperdrive_size4_class2: [315, 2, 0.01, 2.3],
  int_hyperdrive_size4_class3: [350, 2, 0.008, 2.3],
  int_hyperdrive_size4_class4: [438, 2.5, 0.01, 2.3],
  int_hyperdrive_size4_class5: [525, 3, 0.012, 2.3],
  int_hyperdrive_size5_class1: [560, 3.3, 0.011, 2.45],
  int_hyperdrive_size5_class2: [630, 3.3, 0.01, 2.45],
  int_hyperdrive_size5_class3: [700, 3.3, 0.008, 2.45],
  int_hyperdrive_size5_class4: [875, 4.1, 0.01, 2.45],
  int_hyperdrive_size5_class5: [1050, 5, 0.012, 2.45],
  int_hyperdrive_size6_class1: [960, 5.3, 0.011, 2.6],
  int_hyperdrive_size6_class2: [1080, 5.3, 0.01, 2.6],
  int_hyperdrive_size6_class3: [1200, 5.3, 0.008, 2.6],
  int_hyperdrive_size6_class4: [1500, 6.6, 0.01, 2.6],
  int_hyperdrive_size6_class5: [1800, 8, 0.012, 2.6],
  int_hyperdrive_size7_class1: [1440, 8.5, 0.011, 2.75],
  int_hyperdrive_size7_class2: [1620, 8.5, 0.01, 2.75],
  int_hyperdrive_size7_class3: [1800, 8.5, 0.008, 2.75],
  int_hyperdrive_size7_class4: [2250, 10.6, 0.01, 2.75],
  int_hyperdrive_size7_class5: [2700, 12.8, 0.012, 2.75],
  int_hyperdrive_size2_class1_free: [48, 0.6, 0.011, 2],
  int_hyperdrive_overcharge_size2_class1: [60, 0.6, 0.008, 2],
  int_hyperdrive_overcharge_size2_class2: [90, 0.9, 0.012, 2],
  int_hyperdrive_overcharge_size2_class3: [90, 0.9, 0.012, 2],
  int_hyperdrive_overcharge_size2_class4: [90, 0.9, 0.012, 2],
  int_hyperdrive_overcharge_size2_class5: [100, 1, 0.013, 2],
  int_hyperdrive_overcharge_size3_class1: [100, 1.2, 0.008, 2.15],
  int_hyperdrive_overcharge_size3_class2: [150, 1.8, 0.012, 2.15],
  int_hyperdrive_overcharge_size3_class3: [150, 1.8, 0.012, 2.15],
  int_hyperdrive_overcharge_size3_class4: [150, 1.8, 0.012, 2.15],
  int_hyperdrive_overcharge_size3_class5: [167, 1.9, 0.013, 2.15],
  int_hyperdrive_overcharge_size4_class1: [350, 2, 0.008, 2.3],
  int_hyperdrive_overcharge_size4_class2: [525, 3, 0.012, 2.3],
  int_hyperdrive_overcharge_size4_class3: [525, 3, 0.012, 2.3],
  int_hyperdrive_overcharge_size4_class4: [525, 3, 0.012, 2.3],
  int_hyperdrive_overcharge_size4_class5: [585, 3.2, 0.013, 2.3],
  int_hyperdrive_overcharge_size5_class1: [700, 3.3, 0.008, 2.45],
  int_hyperdrive_overcharge_size5_class2: [1050, 5, 0.012, 2.45],
  int_hyperdrive_overcharge_size5_class3: [1050, 5, 0.012, 2.45],
  int_hyperdrive_overcharge_size5_class4: [1050, 5, 0.012, 2.45],
  int_hyperdrive_overcharge_size5_class5: [1175, 5.2, 0.013, 2.45],
  int_hyperdrive_overcharge_size6_class1: [1200, 5.3, 0.008, 2.6],
  int_hyperdrive_overcharge_size6_class2: [1800, 8, 0.012, 2.6],
  int_hyperdrive_overcharge_size6_class3: [1800, 8, 0.012, 2.6],
  int_hyperdrive_overcharge_size6_class4: [1800, 8, 0.012, 2.6],
  int_hyperdrive_overcharge_size6_class5: [2000, 8.3, 0.013, 2.6],
  int_hyperdrive_overcharge_size7_class1: [1800, 8.5, 0.008, 2.75],
  int_hyperdrive_overcharge_size7_class2: [2700, 12.8, 0.012, 2.75],
  int_hyperdrive_overcharge_size7_class3: [2700, 12.8, 0.012, 2.75],
  int_hyperdrive_overcharge_size7_class4: [2700, 12.8, 0.012, 2.75],
  int_hyperdrive_overcharge_size7_class5: [3000, 13.1, 0.013, 2.75],
  int_hyperdrive_overcharge_size8_class1: [2800, 13.6, 0.008, 2.9],
  int_hyperdrive_overcharge_size8_class2: [4200, 20.4, 0.012, 2.9],
  int_hyperdrive_overcharge_size8_class3: [4200, 20.4, 0.012, 2.9],
  int_hyperdrive_overcharge_size8_class4: [4200, 20.4, 0.012, 2.9],
  int_hyperdrive_overcharge_size8_class5: [4670, 20.7, 0.013, 2.9],
  int_hyperdrive_overcharge_size8_class5_overchargebooster_mkii: [4670, 6.8, 0.011, 2.5025],
};

export interface FsdDrive {
  optMassT: number;
  maxFuelT: number;
  mul: number;
  pow: number;
  /** The Guardian FSD Booster's bonus (ly), 0 without one. */
  boosterLy: number;
}

/** A Loadout's range may differ from the law's by this much (ly) before the law is taken as not this drive's. */
const LOADOUT_TOLERANCE_LY = 0.02;

/**
 * The drive of a `Loadout` (its `FrameShiftDrive` module, engineering applied) when its module is known and the law
 * gives back the Loadout's own `MaxJumpRange`; null otherwise (an unknown module, a changed constant), and the fitted
 * law (fsdFuel.ts) stands in.
 */
export function fsdDriveFromLoadout(line: Record<string, unknown>, boosterLy: number): FsdDrive | null {
  const modules = Array.isArray(line.Modules) ? (line.Modules as Record<string, unknown>[]) : [];
  const fsd = modules.find((m) => m.Slot === "FrameShiftDrive");
  const row = typeof fsd?.Item === "string" ? FSD[fsd.Item.toLowerCase()] : undefined;
  if (!row) return null;
  const mods = (fsd!.Engineering as { Modifiers?: { Label?: string; Value?: number }[] } | undefined)?.Modifiers ?? [];
  const value = (label: string) => {
    const v = mods.find((m) => m.Label === label)?.Value;
    return typeof v === "number" && v > 0 ? v : null;
  };
  const drive: FsdDrive = {
    optMassT: value("FSDOptimalMass") ?? row[0],
    maxFuelT: value("MaxFuelPerJump") ?? row[1],
    mul: row[2],
    pow: row[3],
    boosterLy,
  };
  const unladen = line.UnladenMass;
  const mjr = line.MaxJumpRange;
  const tank = (line.FuelCapacity as { Main?: unknown } | undefined)?.Main;
  if (typeof unladen !== "number" || !(unladen > 0) || typeof mjr !== "number" || !(mjr > 0)) return null;
  // The Loadout's range is the empty ship's with one jump's fuel aboard (or the tank, when it holds less).
  const fuel = typeof tank === "number" && tank > 0 ? Math.min(drive.maxFuelT, tank) : drive.maxFuelT;
  return Math.abs(driveRangeLy(drive, fuel, unladen + fuel) - mjr) <= LOADOUT_TOLERANCE_LY ? drive : null;
}

/** The drive's own longest jump at this mass, booster left out. */
function reach(d: FsdDrive, massT: number): number {
  return (d.optMassT / massT) * (d.maxFuelT / d.mul) ** (1 / d.pow);
}

/** How far the booster stretches every jump at this mass: the longest one by B, the others in proportion. */
function boosterStretch(d: FsdDrive, massT: number): number {
  const r = reach(d, massT);
  return r > 0 ? (r + d.boosterLy) / r : 1;
}

/** The longest unboosted jump (ly) spending `fuelT` (capped at the drive's most per jump) at `massT`. */
export function driveRangeLy(d: FsdDrive, fuelT: number, massT: number): number {
  const f = Math.min(d.maxFuelT, fuelT);
  if (!(f > 0) || !(massT > 0)) return 0;
  return (d.optMassT / massT) * (f / d.mul) ** (1 / d.pow) * boosterStretch(d, massT);
}

/** Fuel (t) an unboosted jump of `ly` spends at `massT`; past the drive's reach it is more than `maxFuelT`. */
export function driveFuelT(d: FsdDrive, ly: number, massT: number): number {
  if (!(ly > 0)) return 0;
  return d.mul * ((ly * massT) / (d.optMassT * boosterStretch(d, massT))) ** d.pow;
}

/** A saved drive, when well-formed. */
export function hydrateFsdDrive(raw: unknown): FsdDrive | null {
  const d = raw as Partial<FsdDrive> | null;
  if (!d || typeof d !== "object") return null;
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!ok(d.optMassT) || !ok(d.maxFuelT) || !ok(d.mul) || !ok(d.pow)) return null;
  const b = typeof d.boosterLy === "number" && d.boosterLy > 0 ? d.boosterLy : 0;
  return { optMassT: d.optMassT, maxFuelT: d.maxFuelT, mul: d.mul, pow: d.pow, boosterLy: b };
}
