/**
 * The ship as the journals know it, for the neutron planner (plan 8): range, jumps a full tank and the fuel aboard
 * allow, the FSD's health and wear, its supercharge factor, where it is. Used by `/api/neutron/*` and by the route
 * being flown when it plans again from where the ship is (server/neutronLive.ts).
 */
import { fullJumpRange } from "../shared/jumpRange.js";
import { fsdFuelModel, maxJumpLy, type FsdFuelModel } from "../shared/fsdFuel.js";
import { fsdWearEstimate, FSD_WARN } from "../shared/fsdWear.js";
import type { GameStateStore } from "./gameState.js";

/**
 * The unboosted range with a full tank and the hold as it is, for a ship without jumps to go by (a new ship, a first
 * start). The Loadout's `MaxJumpRange` is the empty ship's, with only one jump's fuel aboard: planned with it, a
 * supercharge fell short of the next neutron star (a tester, 2026-10-28: "it seems to be using the unladen vs
 * current jump range"). From the drive's law when fitted, else the Loadout's range for the mass it was given with.
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
  // A jump's reach goes as 1 / mass for the same fuel: the Loadout's mass carries one jump's fuel (unknown: none).
  const oneJump = model?.maxFuelPerJumpT ?? store.fsdFuel.maxFuelPerJumpT ?? 0;
  return (mjr * (unladen + oneJump)) / (unladen + tank + cargo);
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
  const now = store.liveStatusFuelMainT;
  const wear = fsdWearEstimate(store.fsdWear);
  return {
    rangeLy: plannedRange(fullJumpRange(store.jumpRange), ladenRangeLy(store, model)),
    fuelPerJumpT: perJump,
    jumpsPerTank: perJump && tank ? Math.floor(tank / perJump) : null,
    jumpsNow: perJump && now != null ? Math.floor(now / perJump) : null,
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
