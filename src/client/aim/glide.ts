/**
 * The marks between Status.json writes (owner, 2026-11-04: "the circles on-screen are getting updated every 3
 * seconds"). The heading and pitch are the HUD's, live; the position is Status.json's, which the game writes only every
 * few seconds while the ship moves (the HUD's own latitude has 4 decimals, about 16 m a step on his planet: too coarse
 * to place a plant by). Between writes the marks move by the ship's own motion, its speed taken from the last two
 * writes, for no longer than the gap between them, so a ship that stopped (and so wrote nothing new) drifts on for one
 * gap at most and then stays.
 */
import type { ExoMinimapDTO } from "@shared/types";

type Map = ExoMinimapDTO;

export interface GlideState {
  map: Map;
  atMs: number;
  /** Metres a second the ship moves east and north, and climbs; 0 until two writes are seen. */
  vE: number;
  vN: number;
  vUp: number;
  /** How long the motion is carried on: the gap between the last two writes. */
  holdMs: number;
}

/** Gaps longer than this are not one movement (a pause, a reconnect): no speed from them. */
const MAX_GAP_MS = 6000;
/** Faster than this is a jump of the reference (another body, a teleport of the fix), not flight near the ground. */
const MAX_SPEED_MS = 400;

/** The ship's shift between two maps: the move of a mark both hold, the other way round. */
function shift(prev: Map, next: Map): { e: number; n: number } | null {
  for (const m of next.marks) {
    const p = prev.marks.find((x) => x.kind === m.kind && x.name === m.name && x.label === m.label && Math.abs(x.eastM - m.eastM) + Math.abs(x.northM - m.northM) < 200);
    if (p) return { e: p.eastM - m.eastM, n: p.northM - m.northM };
  }
  return null;
}

/** A new map from the server: the speed from the last one. */
export function nextGlide(prev: GlideState | null, map: Map, nowMs: number): GlideState {
  const still = { map, atMs: nowMs, vE: 0, vN: 0, vUp: 0, holdMs: 0 };
  if (!prev) return still;
  const dt = nowMs - prev.atMs;
  if (!(dt > 0) || dt > MAX_GAP_MS) return still;
  const d = shift(prev.map, map);
  if (!d) return still;
  const vE = (d.e * 1000) / dt;
  const vN = (d.n * 1000) / dt;
  if (Math.hypot(vE, vN) > MAX_SPEED_MS) return still;
  const a0 = prev.map.altitudeM;
  const a1 = map.altitudeM;
  const vUp = a0 != null && a1 != null ? ((a1 - a0) * 1000) / dt : 0;
  return { map, atMs: nowMs, vE, vN, vUp, holdMs: dt };
}

/** The map as it stands now: every mark moved back by the ship's travel since the last write. */
export function glidedMap(g: GlideState | null, nowMs: number): Map | null {
  if (!g) return null;
  const t = Math.max(0, Math.min(nowMs - g.atMs, g.holdMs)) / 1000;
  if (t === 0 || (g.vE === 0 && g.vN === 0 && g.vUp === 0)) return g.map;
  const de = g.vE * t;
  const dn = g.vN * t;
  return {
    ...g.map,
    ...(g.map.altitudeM != null ? { altitudeM: Math.max(0, g.map.altitudeM + g.vUp * t) } : {}),
    marks: g.map.marks.map((m) => {
      const eastM = m.eastM - de;
      const northM = m.northM - dn;
      return { ...m, eastM, northM, distanceM: Math.hypot(eastM, northM) };
    }),
  };
}
