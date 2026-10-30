/**
 * The ship as the journals know it, for the neutron planner (plan 8): range, jumps a full tank and the fuel aboard
 * allow, the FSD's health and wear, its supercharge factor, where it is. Used by `/api/neutron/*` and by the route
 * being flown when it plans again from where the ship is (server/neutronLive.ts).
 */
import { fullJumpRange } from "../shared/jumpRange.js";
import { fsdFuelModel, fuelForJump, maxJumpLy, type FsdFuelModel } from "../shared/fsdFuel.js";
import type { DriveLaw } from "./neutronRoute.js";
import { fsdWearEstimate, FSD_WARN } from "../shared/fsdWear.js";
import type { GameStateStore } from "./gameState.js";

/**
 * The unboosted range with a full tank and the hold as it is, for a ship without jumps to go by (a new ship, a first
 * start). The Loadout's `MaxJumpRange` is the empty ship's, with only one jump's fuel aboard: planned with it, a
 * supercharge fell short of the next neutron star (a tester, 2026-10-28: "it seems to be using the unladen vs
 * current jump range"). From the drive's law (its module's, or fitted), else the Loadout's range for the mass it was
 * given with.
 */
export function ladenRangeLy(store: GameStateStore, model: FsdFuelModel | null): number | null {
  const tank = store.loadoutFuelMainCapacityT;
  const cargo = store.liveStatusCargoT ?? store.fsdFuel.cargoT ?? 0;
  if (model && tank) {
    const r = maxJumpLy(model, tank, cargo);
    if (r) return r;
  }
  const mjr = store.loadoutMaxJumpRangeLy;
  const unladen = store.fsdFuel.unladenT;
  if (mjr == null || unladen == null || tank == null) return mjr ?? null;
  // The drive's reach goes as 1 / mass for the same fuel: the Loadout's mass carries one jump's fuel (unknown: none).
  // The Guardian booster's bonus is flat: it stays out of the scaling.
  const oneJump = model?.maxFuelPerJumpT ?? store.fsdFuel.maxFuelPerJumpT ?? 0;
  const bonus = Math.min(store.fsdFuel.boosterLy ?? 0, mjr);
  return ((mjr - bonus) * (unladen + oneJump)) / (unladen + tank + cargo) + bonus;
}

/**
 * The drive's own law with the hold as it is (fsdDrives.ts), for the planner and the refuel window: null when the
 * drive's module is not known, or the tank or its fuel per jump.
 */
export function driveLaw(store: GameStateStore): DriveLaw | null {
  const model = fsdFuelModel(store.fsdFuel);
  const tankT = store.loadoutFuelMainCapacityT;
  if (!model?.drive || !tankT || !model.maxFuelPerJumpT) return null;
  const cargo = store.liveStatusCargoT ?? store.fsdFuel.cargoT ?? 0;
  return {
    tankT,
    perJumpT: model.maxFuelPerJumpT,
    fuelT: (ly, t) => fuelForJump(model, ly, t, cargo),
    rangeLy: (t) => maxJumpLy(model, t, cargo) ?? 0,
  };
}

/**
 * The law for a plan with `rangeLy`: only when it is this ship's (within 0.1 ly). A range typed in for another ship
 * goes by jumps of fuel, as before.
 */
export function lawFor(store: GameStateStore | null, rangeLy: number | null | undefined): DriveLaw | null {
  if (!store || rangeLy == null) return null;
  const own = ladenRangeLy(store, fsdFuelModel(store.fsdFuel));
  return own != null && Math.abs(own - rangeLy) <= 0.1 ? driveLaw(store) : null;
}

/** Entries in `rangeByFuel`: the tank in twentieths. */
const FUEL_STEPS = 20;

/**
 * The range by the fuel aboard, as multiples of the full tank's `rangeLy` (neutronRoute.ts `rangeByFuel`). With at
 * least one jump's fuel aboard the drive spends the same on its longest jump, so its reach goes as 1 / mass: the ship,
 * the hold and the fuel. The Guardian booster's bonus does not: it is the same on any tank, so only the rest grows.
 * Below one jump's fuel the entries stay at one jump's (the planner never jumps on less).
 */
export function rangeByFuel(store: GameStateStore, model: FsdFuelModel | null, rangeLy: number | null): number[] | null {
  const tank = store.loadoutFuelMainCapacityT;
  const unladen = store.fsdFuel.unladenT;
  if (!tank || unladen == null) return null;
  const cargo = store.liveStatusCargoT ?? store.fsdFuel.cargoT ?? 0;
  const oneJump = Math.min(tank, model?.maxFuelPerJumpT ?? store.fsdFuel.maxFuelPerJumpT ?? tank / FUEL_STEPS);
  if (model?.drive && rangeLy && rangeLy > 0) {
    // The drive's own law: each entry is the longest jump on that tank.
    return Array.from({ length: FUEL_STEPS + 1 }, (_, i) => {
      const r = maxJumpLy(model, Math.max(oneJump, (tank * i) / FUEL_STEPS), cargo);
      return r ? r / rangeLy : 1;
    });
  }
  const full = unladen + tank + cargo;
  // The bonus as a share of the full tank's range; unknown range: none (the whole range scales).
  const flat = rangeLy && rangeLy > 0 ? Math.min(1, (store.fsdFuel.boosterLy ?? 0) / rangeLy) : 0;
  return Array.from({ length: FUEL_STEPS + 1 }, (_, i) => {
    const drive = full / (unladen + Math.max(oneJump, (tank * i) / FUEL_STEPS) + cargo);
    return (1 - flat) * drive + flat;
  });
}

/**
 * The range a plan goes by: as flown, but never past the full tank's. The jumps flown include ones on a nearly empty
 * tank, and a supercharge multiplies any excess by four or six (the Caspian's drive): a planned neutron jump out of
 * the ship's reach fails at the first neutron star.
 */
function plannedRange(flown: number | null, fullTank: number | null): number | null {
  if (flown == null) return fullTank;
  return fullTank == null ? flown : Math.min(flown, fullTank);
}

export function neutronShip(
  store: GameStateStore,
  fallbackPosition?: { x: number; y: number; z: number } | null,
) {
  const model = fsdFuelModel(store.fsdFuel);
  // An engineered drive names its fuel per jump in the Loadout: jumps a tank without a jump flown yet.
  const perJump = model?.maxFuelPerJumpT ?? store.fsdFuel.maxFuelPerJumpT ?? null;
  const tank = store.loadoutFuelMainCapacityT;
  // Live while the game runs; else the last the journals or Status.json said (not a full tank assumed).
  // A closed game leaves its last Status.json behind: that tank is the last known, not live.
  const live = store.gameRunning === false ? null : store.liveStatusFuelMainT;
  const now = live ?? store.lastFuelMainT;
  const wear = fsdWearEstimate(store.fsdWear);
  // A known drive's law is exact (fsdDrives.ts): the jumps flown only stand in for it.
  const rangeLy = model?.drive ? ladenRangeLy(store, model) : plannedRange(fullJumpRange(store.jumpRange), ladenRangeLy(store, model));
  return {
    rangeLy,
    rangeByFuel: rangeByFuel(store, model, rangeLy),
    fuelPerJumpT: perJump,
    jumpsPerTank: perJump && tank ? Math.floor(tank / perJump) : null,
    jumpsNow: perJump && now != null ? Math.floor(now / perJump) : null,
    fuelNowT: now ?? null,
    fuelNowFrom: live != null ? ("live" as const) : now != null ? ("last" as const) : null,
    fuelNowAt: live != null ? null : store.lastFuelAt,
    fsdHealth: wear.health,
    wearPerBoost: wear.wearPerBoost,
    wearIsDefault: wear.wearIsDefault,
    wearFrom: wear.wearFrom,
    boostFactor: wear.boostFactor,
    shipKnown: wear.shipKnown,
    shipType: wear.ship,
    boostsSinceLoadout: wear.boostsSince,
    fsdWarn: FSD_WARN,
    position: store.commanderPos ?? fallbackPosition ?? null,
    system: store.currentSystem ?? null,
  };
}
