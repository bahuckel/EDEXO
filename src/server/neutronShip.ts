/**
 * The ship as the journals know it, for the neutron planner (plan 8): range, jumps a full tank and the fuel aboard
 * allow, the FSD's health and wear, its supercharge factor, where it is. Used by `/api/neutron/*` and by the route
 * being flown when it plans again from where the ship is (server/neutronLive.ts).
 */
import { fullJumpRange } from "../shared/jumpRange.js";
import { fsdFuelModel } from "../shared/fsdFuel.js";
import { fsdWearEstimate, FSD_WARN } from "../shared/fsdWear.js";
import type { GameStateStore } from "./gameState.js";

export function neutronShip(
  store: GameStateStore,
  fallbackPosition?: { x: number; y: number; z: number } | null,
) {
  const model = fsdFuelModel(store.fsdFuel);
  const perJump = model?.maxFuelPerJumpT ?? null;
  const tank = store.loadoutFuelMainCapacityT;
  const now = store.liveStatusFuelMainT;
  const wear = fsdWearEstimate(store.fsdWear);
  return {
    rangeLy: fullJumpRange(store.jumpRange) ?? store.loadoutMaxJumpRangeLy ?? null,
    fuelPerJumpT: perJump,
    jumpsPerTank: perJump && tank ? Math.floor(tank / perJump) : null,
    jumpsNow: perJump && now != null ? Math.floor(now / perJump) : null,
    fsdHealth: wear.health,
    wearPerBoost: wear.wearPerBoost,
    wearIsDefault: wear.wearIsDefault,
    wearFrom: wear.wearFrom,
    boostFactor: wear.boostFactor,
    shipType: wear.ship,
    boostsSinceLoadout: wear.boostsSince,
    fsdWarn: FSD_WARN,
    position: store.commanderPos ?? fallbackPosition ?? null,
    system: store.currentSystem ?? null,
  };
}

export type NeutronShipInfo = ReturnType<typeof neutronShip>;
