/**
 * Fuel per jump, as the drive spends it (owner, 2026-10-08: "I am also not sure how the Route: thing
 * calculates fuel usage … we should look into it").
 *
 * The game's frame shift drive spends `fuel = k · (distance · mass)^p`: `p` the drive's power
 * constant (about 2.45 for class A drives), `mass` the ship as it jumps (hull and modules, fuel in the
 * tank, cargo). Fitted on the commander's own jumps — 300 of the owner's Mandalay jumps give
 * p = 2.449 and every jump within 1.2 % (median 0.2 %); the old rule, last jump × (leg / last jump)²
 * at a fixed mass, came up 31 % short (median) for a leg 1.4 times the last one or more.
 *
 * A boosted jump (`BoostUsed`: neutron or white dwarf supercharge, injection) spends by other rules
 * and is left out. The samples carry the mass they were flown with, so a refit that keeps the drive keeps them
 * (owner, 2026-10-28: jumps a tank stayed empty after a refit until a few jumps were made); another drive starts
 * over, and each ship's samples are kept while another ship is flown.
 */

import { driveFuelT, driveRangeLy, fsdDriveFromLoadout, fsdDriveOf, type FsdDrive } from "./fsdDrives.js";

/** Class A drives; used until the commander's own jumps pin `p` down. */
export const DEFAULT_POWER = 2.45;
const SAMPLES = 60;
/** Jumps, and the spread of their distances, needed to fit `p` rather than assume it. */
const FIT_MIN_SAMPLES = 8;
const FIT_MIN_SPREAD = 1.5;
/** A jump this short says more about rounding than about the drive. */
const MIN_SAMPLE_LY = 2;

export interface FsdFuelSample {
  ly: number;
  fuelT: number;
  massT: number;
}

export interface FsdFuelState {
  shipId: number | null;
  loadoutLy: number | null;
  /** `Loadout.UnladenMass`: hull and modules, no fuel, no cargo. */
  unladenT: number | null;
  /** The drive's most fuel per jump (`Loadout` FSD `MaxFuelPerJump` when engineered), when known. */
  maxFuelPerJumpT: number | null;
  /** The Guardian FSD Booster's bonus in the last `Loadout` (`guardianBoosterLy`); 0 or absent without one. */
  boosterLy?: number;
  /** The last `Loadout`'s drive by its module's constants (fsdDrives.ts), when they give back its range; else null. */
  drive?: FsdDrive | null;
  /** Engineered modules' mass (t) by slot, as the last `Loadout` or `EngineerCraft` gave it (fsdFuelEngineerCraft). */
  moduleMassT?: Record<string, number>;
  /**
   * What the ship carries (t), from the journal's last `Cargo` line; null until one is read, and again
   * after a ship change or a death. The journal writes one at every login and after every change to the
   * hold (owner's history, 2026-10-14: 1,013 of 1,013 MarketBuy followed by one), so a replayed jump gets
   * the cargo it was made with. Live Status.json's cargo was used before, for old jumps too: 0 t on a
   * first start (the poll starts after the replay) and today's load after a resync (code review).
   */
  cargoT: number | null;
  samples: FsdFuelSample[];
  /** The drive the samples are from: its module and engineering (`fsdKey`); null before a Loadout names one. */
  fsd?: string | null;
  /** The other ships' drives and samples, by "s" + `ShipID`, as they were when the commander left them. */
  others?: Record<string, { fsd: string | null; samples: FsdFuelSample[]; loadoutLy?: number | null }>;
}

export interface FsdFuelModel {
  k: number;
  p: number;
  /** Whether `p` came from the commander's own jumps. */
  fitted: boolean;
  unladenT: number;
  maxFuelPerJumpT: number | null;
  /** The Guardian booster's bonus (ly), and the mass the law was fitted around (the samples' median, t). */
  boosterLy: number;
  refMassT: number;
  /** The drive's own law, when its module is known (fsdDrives.ts): then `k` and `p` are not used. */
  drive?: FsdDrive | null;
}

export function emptyFsdFuel(): FsdFuelState {
  return {
    shipId: null,
    loadoutLy: null,
    unladenT: null,
    maxFuelPerJumpT: null,
    boosterLy: 0,
    drive: null,
    moduleMassT: {},
    cargoT: null,
    samples: [],
    fsd: null,
    others: {},
  };
}

/** Other ships remembered; the ones left longest ago go first. */
const OTHER_SHIPS = 12;
/** A ship's key in `others`: not the bare ShipID, which objects list in numeric order (see jumpRange.ts). */
const shipKey = (id: number | string) => `s${id}`;

const goodSample = (s: unknown): s is FsdFuelSample => {
  const v = s as FsdFuelSample | null;
  return !!v && v.ly > 0 && v.fuelT > 0 && v.massT > 0;
};

/** `others` from a saved cache: only well-formed entries. */
export function hydrateFsdFuelOthers(raw: unknown): NonNullable<FsdFuelState["others"]> {
  const out: NonNullable<FsdFuelState["others"]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const samples = Array.isArray(e.samples) ? e.samples.filter(goodSample) : [];
    if (!samples.length) continue;
    out[k.startsWith("s") ? k : shipKey(k)] = {
      fsd: typeof e.fsd === "string" ? e.fsd : null,
      samples,
      loadoutLy: typeof e.loadoutLy === "number" && e.loadoutLy > 0 ? e.loadoutLy : null,
    };
  }
  return out;
}

/** `moduleMassT` from a saved cache: only positive masses. */
export function hydrateModuleMass(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

/** The Guardian FSD Booster's bonus (ly) by module size 1-5; it cannot be engineered. */
const GUARDIAN_BOOSTER_LY = [0, 4, 6, 7.75, 9.25, 10.5];

/**
 * The Guardian FSD Booster's bonus from a `Loadout`'s modules (`int_guardianfsdbooster_size5`), 0 without one or with
 * it switched off. A flat bonus: the longest jump is the drive's own reach, which goes as 1 / mass, plus the bonus,
 * which does not grow as the ship gets lighter; a supercharge multiplies both (a tester, 2026-10-29: a Caspian with
 * the size 5 one reaches 532.75 ly, 6 × 88.79, and a planner that scaled the bonus with the lighter tank too planned
 * a 534 ly hop it could not make).
 */
export function guardianBoosterLy(modules: unknown): number {
  if (!Array.isArray(modules)) return 0;
  for (const m of modules as Record<string, unknown>[]) {
    const size = /^int_guardianfsdbooster_size(\d)/i.exec(typeof m?.Item === "string" ? m.Item : "")?.[1];
    if (size) return m.On === false ? 0 : (GUARDIAN_BOOSTER_LY[Number(size)] ?? 0);
  }
  return 0;
}

type Modifier = { Label?: string; Value?: number; OriginalValue?: number };

const modifiersOf = (module: Record<string, unknown> | undefined): Modifier[] =>
  (module?.Engineering as { Modifiers?: Modifier[] } | undefined)?.Modifiers ?? [];

/** The drive as its fuel law sees it: the module, and its engineering's values (optimal mass, fuel per jump, ...). */
function fsdKey(item: unknown, mods: Modifier[]): string | null {
  if (typeof item !== "string") return null;
  return [item.toLowerCase(), ...mods.map((m) => `${m.Label}=${m.Value}`).sort()].join("|");
}

/** A modifier's value when it is a positive number. */
function modValue(mods: Modifier[], label: string, key: "Value" | "OriginalValue" = "Value"): number | null {
  const v = mods.find((m) => m.Label === label)?.[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * A `Loadout`: the ship's mass and drive. Another ship: this one's samples are put by and that one's taken back,
 * if it was flown before. Another drive (module or engineering) starts the samples over; a refit that keeps the
 * drive keeps them, as each sample has its own mass.
 */
export function fsdFuelLoadout(st: FsdFuelState, line: Record<string, unknown>): void {
  const shipId = typeof line.ShipID === "number" ? line.ShipID : null;
  const mjr = typeof line.MaxJumpRange === "number" && line.MaxJumpRange > 0 ? line.MaxJumpRange : null;
  const modules = Array.isArray(line.Modules) ? (line.Modules as Record<string, unknown>[]) : [];
  const fsd = modules.find((m) => m.Slot === "FrameShiftDrive");
  const key = fsdKey(fsd?.Item, modifiersOf(fsd));
  if (shipId != null && shipId !== st.shipId) {
    const others = (st.others ??= {});
    if (st.shipId != null && st.samples.length) {
      delete others[shipKey(st.shipId)];
      others[shipKey(st.shipId)] = { fsd: st.fsd ?? null, samples: st.samples, loadoutLy: st.loadoutLy };
      const keys = Object.keys(others);
      for (const k of keys.slice(0, Math.max(0, keys.length - OTHER_SHIPS))) delete others[k];
    }
    const back = others[shipKey(shipId)];
    delete others[shipKey(shipId)];
    st.samples = back?.samples ?? [];
    st.fsd = back?.fsd ?? null;
    // Its own range, for the refit test below: the last ship's would make a stash from before drive keys look refitted.
    st.loadoutLy = back?.loadoutLy ?? null;
    st.shipId = shipId;
  }
  // Another drive: its law is another. A state from before drives were told apart: a refit moving the range.
  const refit = st.loadoutLy != null && mjr != null && Math.abs(mjr - st.loadoutLy) > 0.02 * st.loadoutLy;
  if (st.fsd != null ? key !== st.fsd : refit) st.samples = [];
  st.fsd = key;
  if (mjr != null) st.loadoutLy = mjr;
  if (typeof line.UnladenMass === "number" && line.UnladenMass > 0) st.unladenT = line.UnladenMass;
  st.boosterLy = guardianBoosterLy(modules);
  st.drive = fsdDriveFromLoadout(line, st.boosterLy);
  st.maxFuelPerJumpT = modValue(modifiersOf(fsd), "MaxFuelPerJump") ?? st.drive?.maxFuelT ?? null;
  st.moduleMassT = {};
  for (const m of modules) {
    const mass = modValue(modifiersOf(m), "Mass");
    if (typeof m.Slot === "string" && mass != null) st.moduleMassT[m.Slot] = mass;
  }
}

/**
 * An `EngineerCraft`: the module's new values at once. The game writes no `Loadout` after one until the next login or
 * outfitting, and the drive and the mass of the last one were wrong until then (the owner's journals, 2026-10-30: a
 * Deep Charge roll took the Mandalay's fuel per jump from 5.2 t to 5.72 t, an increased-range roll the Panther's
 * optimal mass from 3,000 t to 3,450 t, and each ship's next jumps spent up to 30 % off the law for hours).
 * The ship's mass moves by the module's: from its last engineered mass (else the craft's base) to the new one. A
 * drive crafted anew starts its samples over, as another drive would.
 */
export function fsdFuelEngineerCraft(st: FsdFuelState, line: Record<string, unknown>): void {
  const slot = line.Slot;
  if (typeof slot !== "string") return;
  const mods = Array.isArray(line.Modifiers) ? (line.Modifiers as Modifier[]) : [];
  const mass = modValue(mods, "Mass");
  if (mass != null) {
    const masses = (st.moduleMassT ??= {});
    const before = masses[slot] ?? modValue(mods, "Mass", "OriginalValue");
    if (before != null && st.unladenT != null) st.unladenT += mass - before;
    masses[slot] = mass;
  }
  if (slot !== "FrameShiftDrive") return;
  // Only a drive the last Loadout proved (its range given back) is trusted with the table's values for the rest.
  if (st.drive) st.drive = fsdDriveOf(line.Module, mods, st.drive.boosterLy);
  st.maxFuelPerJumpT = modValue(mods, "MaxFuelPerJump") ?? st.drive?.maxFuelT ?? null;
  const key = fsdKey(line.Module, mods);
  if (key !== st.fsd) st.samples = [];
  st.fsd = key;
}

/** A `Cargo` line: the ship's hold in tonnes (the SRV's has its own lines, and is not the ship's mass). */
export function fsdFuelCargo(st: FsdFuelState, line: Record<string, unknown>): void {
  if ((line.Vessel ?? "Ship") !== "Ship") return;
  if (typeof line.Count === "number" && Number.isFinite(line.Count) && line.Count >= 0) st.cargoT = line.Count;
}

/**
 * An `FSDJump`: distance, fuel used and the tank after it. `cargoT` null (not known for this jump) leaves
 * the jump out: its mass would be a guess, and a guess of 0 t for a laden ship moved `k` by ×1.7.
 */
export function fsdFuelJump(st: FsdFuelState, line: Record<string, unknown>, cargoT: number | null = 0): void {
  const ly = line.JumpDist;
  const used = line.FuelUsed;
  const level = line.FuelLevel;
  if (typeof ly !== "number" || typeof used !== "number" || typeof level !== "number") return;
  if (!(ly >= MIN_SAMPLE_LY) || !(used > 0) || st.unladenT == null) return;
  if (typeof line.BoostUsed === "number" && line.BoostUsed > 0) return;
  if (cargoT == null) return;
  st.samples.push({ ly, fuelT: used, massT: st.unladenT + level + used + Math.max(0, cargoT) });
  if (st.samples.length > SAMPLES) st.samples.splice(0, st.samples.length - SAMPLES);
}

/**
 * The drive's law: its module's own when known (no jump needed), else `k` and `p` from the samples; null without a ship
 * mass, or without either.
 */
export function fsdFuelModel(st: FsdFuelState): FsdFuelModel | null {
  if (st.unladenT == null) return null;
  const d = st.drive;
  if (d) {
    const k = d.mul / d.optMassT ** d.pow;
    return { k, p: d.pow, fitted: true, unladenT: st.unladenT, maxFuelPerJumpT: d.maxFuelT, boosterLy: d.boosterLy, refMassT: st.unladenT, drive: d };
  }
  if (!st.samples.length) return null;
  let p = DEFAULT_POWER;
  let fitted = false;
  const ds = st.samples.map((s) => s.ly);
  if (st.samples.length >= FIT_MIN_SAMPLES && Math.max(...ds) / Math.min(...ds) >= FIT_MIN_SPREAD) {
    // log fuel = log k + p · log(distance · mass), least squares.
    const xs = st.samples.map((s) => Math.log(s.ly * s.massT));
    const ys = st.samples.map((s) => Math.log(s.fuelT));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i]! - mx) * (ys[i]! - my);
      sxx += (xs[i]! - mx) ** 2;
    }
    const fit = sxx > 0 ? sxy / sxx : NaN;
    // Drive power constants run about 2 to 2.6; anything else is noise (fuel rounding on short hops).
    if (fit >= 1.8 && fit <= 3) {
      p = fit;
      fitted = true;
    }
  }
  const ks = st.samples.map((s) => s.fuelT / (s.ly * s.massT) ** p).sort((a, b) => a - b);
  const k = ks[Math.floor(ks.length / 2)]!;
  const masses = st.samples.map((s) => s.massT).sort((a, b) => a - b);
  const refMassT = masses[Math.floor(masses.length / 2)]!;
  const boosterLy = st.boosterLy ?? 0;
  let maxFuel = st.maxFuelPerJumpT;
  if (maxFuel == null && st.loadoutLy != null) {
    // The loadout's range is the jump that spends the most fuel per jump with only that much aboard.
    maxFuel = 1;
    for (let i = 0; i < 20; i++) {
      const mass: number = st.unladenT + maxFuel;
      maxFuel = k * ((st.loadoutLy - boosterShift(boosterLy, refMassT, mass)) * mass) ** p;
    }
    if (!Number.isFinite(maxFuel) || maxFuel <= 0) maxFuel = null;
  }
  return { k, p, fitted, unladenT: st.unladenT, maxFuelPerJumpT: maxFuel, boosterLy, refMassT };
}

/**
 * What the law's 1 / mass gets wrong with a Guardian booster: the law holds around the mass it was fitted at, but
 * the booster's part of the range does not scale, so at another mass the true longest jump is the law's plus this.
 */
function boosterShift(boosterLy: number, refMassT: number, massT: number): number {
  return boosterLy * (1 - refMassT / massT);
}

/** Fuel (t) for a jump of `ly` with `fuelT` in the tank and `cargoT` aboard. */
export function fuelForJump(m: FsdFuelModel, ly: number, fuelT: number, cargoT = 0): number {
  const mass = m.unladenT + fuelT + cargoT;
  if (m.drive) return driveFuelT(m.drive, ly, mass);
  return m.k * (ly * mass) ** m.p;
}

/** The longest jump (ly) on this tank: the drive's most fuel per jump, or what is left. */
export function maxJumpLy(m: FsdFuelModel, fuelT: number, cargoT = 0): number | null {
  if (m.maxFuelPerJumpT == null) return null;
  const f = Math.min(m.maxFuelPerJumpT, fuelT);
  if (!(f > 0)) return 0;
  const mass = m.unladenT + fuelT + cargoT;
  if (m.drive) return driveRangeLy(m.drive, f, mass);
  return (f / m.k) ** (1 / m.p) / mass + boosterShift(m.boosterLy, m.refMassT, mass);
}
