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
  /** The other ships' drives and samples, by `ShipID`, as they were when the commander left them. */
  others?: Record<string, { fsd: string | null; samples: FsdFuelSample[] }>;
}

export interface FsdFuelModel {
  k: number;
  p: number;
  /** Whether `p` came from the commander's own jumps. */
  fitted: boolean;
  unladenT: number;
  maxFuelPerJumpT: number | null;
}

export function emptyFsdFuel(): FsdFuelState {
  return {
    shipId: null,
    loadoutLy: null,
    unladenT: null,
    maxFuelPerJumpT: null,
    cargoT: null,
    samples: [],
    fsd: null,
    others: {},
  };
}

/** Other ships remembered; the ones left longest ago go first. */
const OTHER_SHIPS = 12;

/** The drive as its fuel law sees it: the module, and its engineering's values (optimal mass, fuel per jump, ...). */
function fsdKey(fsd: Record<string, unknown> | undefined): string | null {
  if (!fsd || typeof fsd.Item !== "string") return null;
  const mods = (fsd.Engineering as { Modifiers?: { Label?: string; Value?: number }[] } | undefined)?.Modifiers ?? [];
  return [fsd.Item.toLowerCase(), ...mods.map((m) => `${m.Label}=${m.Value}`).sort()].join("|");
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
  const key = fsdKey(fsd);
  if (shipId != null && shipId !== st.shipId) {
    const others = (st.others ??= {});
    if (st.shipId != null && st.samples.length) {
      delete others[st.shipId];
      others[st.shipId] = { fsd: st.fsd ?? null, samples: st.samples };
      const keys = Object.keys(others);
      for (const k of keys.slice(0, Math.max(0, keys.length - OTHER_SHIPS))) delete others[k];
    }
    const back = others[shipId];
    delete others[shipId];
    st.samples = back?.samples ?? [];
    st.fsd = back?.fsd ?? null;
    st.shipId = shipId;
  }
  // Another drive: its law is another. A state from before drives were told apart: a refit moving the range.
  const refit = st.loadoutLy != null && mjr != null && Math.abs(mjr - st.loadoutLy) > 0.02 * st.loadoutLy;
  if (st.fsd != null ? key !== st.fsd : refit) st.samples = [];
  st.fsd = key;
  if (mjr != null) st.loadoutLy = mjr;
  if (typeof line.UnladenMass === "number" && line.UnladenMass > 0) st.unladenT = line.UnladenMass;
  st.maxFuelPerJumpT = null;
  const mods = (fsd?.Engineering as { Modifiers?: { Label?: string; Value?: number }[] } | undefined)
    ?.Modifiers;
  const mf = mods?.find((m) => m.Label === "MaxFuelPerJump")?.Value;
  if (typeof mf === "number" && mf > 0) st.maxFuelPerJumpT = mf;
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

/** `k` and `p` from the samples; null without a ship mass or a single usable jump. */
export function fsdFuelModel(st: FsdFuelState): FsdFuelModel | null {
  if (st.unladenT == null || !st.samples.length) return null;
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
  let maxFuel = st.maxFuelPerJumpT;
  if (maxFuel == null && st.loadoutLy != null) {
    // The loadout's range is the jump that spends the most fuel per jump with only that much aboard.
    maxFuel = 1;
    for (let i = 0; i < 20; i++) maxFuel = k * (st.loadoutLy * (st.unladenT + maxFuel)) ** p;
    if (!Number.isFinite(maxFuel) || maxFuel <= 0) maxFuel = null;
  }
  return { k, p, fitted, unladenT: st.unladenT, maxFuelPerJumpT: maxFuel };
}

/** Fuel (t) for a jump of `ly` with `fuelT` in the tank and `cargoT` aboard. */
export function fuelForJump(m: FsdFuelModel, ly: number, fuelT: number, cargoT = 0): number {
  return m.k * (ly * (m.unladenT + fuelT + cargoT)) ** m.p;
}

/** The longest jump (ly) on this tank: the drive's most fuel per jump, or what is left. */
export function maxJumpLy(m: FsdFuelModel, fuelT: number, cargoT = 0): number | null {
  if (m.maxFuelPerJumpT == null) return null;
  const f = Math.min(m.maxFuelPerJumpT, fuelT);
  if (!(f > 0)) return 0;
  return (f / m.k) ** (1 / m.p) / (m.unladenT + fuelT + cargoT);
}
