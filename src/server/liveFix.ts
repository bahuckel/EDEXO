/**
 * A Status.json read, applied (null: off the surface): the foot odometer's sample, the nose's pitch from the flight
 * path, and the radar's fix. Status.json has no pitch; scanLocate.ts estimates it from the climb over the ground
 * covered, for composition scans placed ahead of the ship and the screen marker (owner, 2026-11-04).
 */
import type { FootTravelFix } from "./footTravelStatus.js";
import type { GameStateStore } from "./gameState.js";
import { FlightPathPitch } from "../shared/scanLocate.js";

const pitchByStore = new WeakMap<GameStateStore, FlightPathPitch>();

export function applyLiveFix(store: GameStateStore, fix: FootTravelFix | null, nowMs = Date.now()): void {
  let pitch = pitchByStore.get(store);
  if (!pitch) pitchByStore.set(store, (pitch = new FlightPathPitch()));
  if (fix) {
    store.applyFootTravelSample(fix.latDeg, fix.lonDeg, fix.planetRadiusM, fix.bodyName);
    fix.pitchDeg = pitch.push(fix, nowMs);
  } else pitch.reset();
  store.exoOrganicLastFix = fix;
}
