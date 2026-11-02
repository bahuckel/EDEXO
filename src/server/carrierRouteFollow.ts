/**
 * A Spansh fleet carrier route being flown (plan 1.3.6, owner 2026-11-02: "do the carrier routes"): the live route
 * (neutronLive.ts) moves on when the commander's own carrier arrives at one of its stops, and the next stop goes to the
 * clipboard for the carrier's galaxy map.
 *
 * The carrier's arrival is not always a journal line: `CarrierJump` is written only when the commander is aboard. The
 * carrier's place therefore comes from shared/ownAssets.ts (`ownCarrierNow`), which lands a scheduled jump by the
 * clock as well; it is looked at after every live journal line and every 15 s while a carrier route is flown.
 */
import { ownCarrierNow } from "../shared/ownAssets.js";
import type { GameStateStore } from "./gameState.js";
import type { Here, NeutronLive } from "./neutronLive.js";

const TICK_MS = 15_000;

/** Where the commander's carrier is (no coordinates: stops are matched by name). */
export function carrierHereOf(store: Pick<GameStateStore, "ownAssets">, nowMs = Date.now()): Here {
  return { name: ownCarrierNow(store.ownAssets, nowMs)?.name ?? null, pos: null };
}

export function createCarrierRouteFollow(deps: {
  store: Pick<GameStateStore, "ownAssets">;
  neutronLive: NeutronLive;
  push: () => void;
  now?: () => number;
}): { tick(): void; stop(): void } {
  const now = deps.now ?? Date.now;
  let seen: string | null = null;
  const tick = (): void => {
    if (deps.neutronLive.follows() !== "carrier") {
      seen = null;
      return;
    }
    const here = carrierHereOf(deps.store, now());
    if (!here.name || here.name === seen) return;
    seen = here.name;
    const before = deps.neutronLive.version();
    const copied = deps.neutronLive.onJump(here);
    if (copied != null || deps.neutronLive.version() !== before || !deps.neutronLive.active()) deps.push();
  };
  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
