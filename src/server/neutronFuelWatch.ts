/**
 * The route being flown follows the fuel aboard (plan 1.3.4 S-9, owner 2026-10-31: "If the person plots the route,
 * refuels more or less than required, it should automatically determine the best course of action from that point";
 * a guild mate: "The planned route assumes I did not refuel on a star that was a fuel star between neutron jumps").
 *
 * The plan carries its fuel at each stop, on arrival and on leaving (neutronRoute.ts `fuelArrive` / `fuelLeave`, in
 * jumps of the drive's most fuel per jump). Two moments compare the tank with it, and a jump's fuel or more either way
 * re-plots from where the ship is (neutronReplan.ts), which plans from the fuel aboard:
 * - a jump onto a stop: the jump's own `FuelLevel` against the stop's arrival fuel (Status.json can still hold the
 *   tank from before the jump);
 * - scooping or a refuel settled (no FuelScoop / RefuelAll / RefuelPartial line for `settleMs`): on a stop, the tank
 *   against the stop's leaving fuel (scooped to more or less than planned, or where no scoop was planned); between
 *   stops, against the tank on the last jump, unless the plan scoops on the way there anyway.
 * Not while scooping: FuelScoop lines come every few seconds, and the HUD would change its mind with each.
 */
import type { GameStateStore } from "./gameState.js";
import type { Here, NeutronLive } from "./neutronLive.js";
import { neutronShip } from "./neutronShip.js";

/** Scooping counts as done once no fuel line came for this long (ms). */
export const FUEL_SETTLE_MS = 8000;

/** The tank now and the drive's most fuel per jump, as the planner reads them (neutronShip.ts). */
export function storeFuel(store: GameStateStore): { nowT: number | null; perJumpT: number | null } {
  const s = neutronShip(store);
  return { nowT: s.fuelNowT, perJumpT: s.fuelPerJumpT };
}

export interface NeutronFuelWatch {
  /** Every live journal line, after the store applied it and the route saw an FSDJump (neutronLive.onJump). */
  onLine(line: Record<string, unknown>): void;
  dispose(): void;
}

const FUEL_EVENTS = new Set(["FuelScoop", "RefuelAll", "RefuelPartial"]);

/** "12 t more fuel than planned", "3.4 t less …": whole tonnes from 10 t. */
export function fuelWhy(deltaT: number): string {
  const a = Math.abs(deltaT);
  return `${a >= 10 ? Math.round(a) : Math.round(a * 10) / 10} t ${deltaT > 0 ? "more" : "less"} fuel than planned`;
}

export function createNeutronFuelWatch(
  deps: {
    neutronLive: Pick<NeutronLive, "position">;
    shipHere: () => Here;
    /** The tank now (t) and the drive's most fuel per jump (t); either null when unknown. */
    fuel: () => { nowT: number | null; perJumpT: number | null };
    settleMs?: number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (t: unknown) => void;
  },
  /** Re-plot from here with this tank (t), the one compared: Status.json can lag the journal line. */
  replan: (why: string, fuelT: number) => void,
): NeutronFuelWatch {
  const settleMs = deps.settleMs ?? FUEL_SETTLE_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  /** The tank on the last jump (t), for scooping between stops. */
  let atJumpT: number | null = null;

  const cancel = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
  };
  /** Re-plots when the tank is a jump's fuel or more from `expectedJ` (jumps); true when it did. */
  const check = (nowT: number | null, expectedJ: number | undefined, perJumpT: number | null): boolean => {
    if (nowT == null || expectedJ == null || !perJumpT || !(perJumpT > 0)) return false;
    const deltaT = nowT - expectedJ * perJumpT;
    if (Math.abs(deltaT) < perJumpT - 1e-6) return false;
    replan(fuelWhy(deltaT), nowT);
    return true;
  };

  const settled = () => {
    timer = null;
    const pos = deps.neutronLive.position(deps.shipHere());
    if (!pos) return;
    const { nowT, perJumpT } = deps.fuel();
    if (pos.onStop) {
      check(nowT, pos.hop.fuelLeave, perJumpT);
      return;
    }
    // Between stops the plan has no fuel for this system; it does know whether it scoops on the way.
    if (pos.next?.scoopOnWay || atJumpT == null || !perJumpT) return;
    check(nowT, atJumpT / perJumpT, perJumpT);
  };

  return {
    onLine(line) {
      const event = typeof line.event === "string" ? line.event : "";
      if (event === "FSDJump") {
        cancel();
        const level = typeof line.FuelLevel === "number" && Number.isFinite(line.FuelLevel) ? line.FuelLevel : null;
        atJumpT = level;
        const pos = deps.neutronLive.position(deps.shipHere());
        if (pos?.onStop) check(level, pos.hop.fuelArrive, deps.fuel().perJumpT);
        return;
      }
      if (!FUEL_EVENTS.has(event) || !deps.neutronLive.position(deps.shipHere())) return;
      cancel();
      timer = setTimer(settled, settleMs);
    },
    dispose: cancel,
  };
}
