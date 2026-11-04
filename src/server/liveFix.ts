/**
 * A Status.json read, applied (null: off the surface): the foot odometer's sample, the nose's pitch from the flight
 * path, and the radar's fix. Status.json has no pitch; scanLocate.ts estimates it from the climb over the ground
 * covered, for composition scans placed ahead of the ship and the screen marker (owner, 2026-11-04).
 */
import type { FootTravelFix } from "./footTravelStatus.js";
import type { GameStateStore } from "./gameState.js";
import { normStatusBodyName } from "./organicSampleSessionFile.js";
import { regroupCodexMarks } from "./surfaceMarksFile.js";
import { FlightPathPitch } from "../shared/scanLocate.js";

const pitchByStore = new WeakMap<GameStateStore, FlightPathPitch>();

export function applyLiveFix(store: GameStateStore, fix: FootTravelFix | null, nowMs = Date.now()): void {
  let pitch = pitchByStore.get(store);
  if (!pitch) pitchByStore.set(store, (pitch = new FlightPathPitch()));
  if (fix) {
    store.applyFootTravelSample(fix.latDeg, fix.lonDeg, fix.planetRadiusM, fix.bodyName);
    fix.pitchDeg = pitch.push(fix, nowMs);
    regroupOnThisBody(store, fix);
  } else pitch.reset();
  store.exoOrganicLastFix = fix;
}

/**
 * Composition-scan marks of this body written before the radius was kept on them (the first build of 2026-11-04 put
 * two plants' scans in one mark): grouped into plants now that Status.json gives the planet's radius. Once per mark.
 */
function regroupOnThisBody(store: GameStateStore, fix: FootTravelFix): void {
  const list = store.surfaceCodexMarks;
  const here = normStatusBodyName(fix.bodyName);
  if (!list?.length || !here || !(fix.planetRadiusM > 0)) return;
  const old = list.filter((m) => !m.radiusM && (m.scans?.length ?? 0) > 1 && m.bodyNameNorm === here);
  if (!old.length) return;
  store.surfaceCodexMarks = regroupCodexMarks(list.map((m) => (old.includes(m) ? { ...m, radiusM: fix.planetRadiusM } : m)));
  store.persistSurfaceMarks?.();
}
