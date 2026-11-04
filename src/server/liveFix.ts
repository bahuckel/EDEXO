/**
 * A Status.json read, applied (null: off the surface): the foot odometer's sample, the nose's pitch from the flight
 * path, and the radar's fix. Status.json has no pitch; scanLocate.ts estimates it from the climb over the ground
 * covered, for composition scans placed ahead of the ship and the screen marker (owner, 2026-11-04).
 */
import { parseStatusJsonFootFix, type FootTravelFix } from "./footTravelStatus.js";
import type { GameStateStore } from "./gameState.js";
import { normStatusBodyName } from "./organicSampleSessionFile.js";
import { regroupCodexMarks } from "./surfaceMarksFile.js";
import { FlightPathPitch } from "../shared/scanLocate.js";

const pitchByStore = new WeakMap<GameStateStore, FlightPathPitch>();

/**
 * The pitch read off the game's HUD (aim/ capture, shared/hudPitchReader.ts; owner 2026-11-04, a launcher option):
 * read every 2 s while the screen marker has plants to show, and better than the flight-path estimate while fresh.
 */
interface HudPitch {
  pitchDeg: number;
  rollDeg: number;
  atMs: number;
}
const hudPitchByStore = new WeakMap<GameStateStore, HudPitch>();
/** A HUD reading this old no longer stands for the nose (the reader reads every 2 s). */
export const HUD_PITCH_FRESH_MS = 3500;

/** A reading from the HUD (or null: the reader could not read it), as the screen marker's page posts it. */
export function setHudPitch(store: GameStateStore, r: { pitchDeg: number; rollDeg: number } | null, nowMs = Date.now()): void {
  if (r) hudPitchByStore.set(store, { ...r, atMs: nowMs });
  else hudPitchByStore.delete(store);
}

/** The HUD's reading while fresh. */
export function freshHudPitch(store: GameStateStore, nowMs = Date.now()): HudPitch | null {
  const r = hudPitchByStore.get(store);
  return r && nowMs - r.atMs <= HUD_PITCH_FRESH_MS ? r : null;
}

export function applyLiveFix(store: GameStateStore, fix: FootTravelFix | null, nowMs = Date.now()): void {
  let pitch = pitchByStore.get(store);
  if (!pitch) pitchByStore.set(store, (pitch = new FlightPathPitch()));
  if (fix) {
    store.applyFootTravelSample(fix.latDeg, fix.lonDeg, fix.planetRadiusM, fix.bodyName);
    const path = pitch.push(fix, nowMs);
    // The HUD's own number when the reader has a fresh one (not on foot: no ship's HUD), else the flight path.
    const hud = fix.altitudeM != null ? freshHudPitch(store, nowMs) : null;
    fix.pitchDeg = hud ? hud.pitchDeg : path;
    fix.rollDeg = hud ? hud.rollDeg : null;
    fix.pitchFromHud = !!hud;
    regroupOnThisBody(store, fix);
  } else pitch.reset();
  store.exoOrganicLastFix = fix;
}

/**
 * The fix for a journal line, read from Status.json as the line lands, with the nose's pitch the live reads estimated
 * (a fresh read has none: every composition scan of 2026-11-04 was saved without one).
 */
export function journalLineFix(store: GameStateStore, statusText: string | null | undefined): FootTravelFix | null {
  const fix = statusText ? parseStatusJsonFootFix(statusText) : null;
  const live = fix && fix.altitudeM != null ? store.exoOrganicLastFix : null;
  if (fix) {
    fix.pitchDeg = live?.pitchDeg ?? null;
    fix.pitchFromHud = !!live?.pitchFromHud;
    fix.rollDeg = live?.rollDeg ?? null;
  }
  return fix;
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
