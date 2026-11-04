/**
 * The screen marker's maths (owner, 2026-11-04: "ship moves along with mouse movement, so camera almost always points
 * directly at where the ship is pointed. So we have a dot in a circle on the screen where you need to point at, when
 * you point at a dot it opens to a hexagon and tells you the name").
 *
 * The camera looks where the nose points, so a mark's place on the screen is its angle off the nose put through the
 * game's own projection: across from the heading (exact), up / down from how far below the nose it is, which needs
 * the nose's pitch: Status.json has none, so it is the flight-path estimate (scanLocate.ts FlightPathPitch). Without
 * one (hovering, on foot) the marks ride the screen's middle line and say how far below they are instead.
 * Field of view and resolution from the game's own settings (/api/elite-view): Settings.xml `<FOV>` is vertical.
 */
import { bearingDeg, relativeDeg } from "@shared/scanLocate";
import type { ExoMinimapDTO } from "@shared/types";

type Mark = ExoMinimapDTO["marks"][number];

/** Elite's default vertical field of view, when the settings file cannot be read. */
export const DEFAULT_VFOV_DEG = 56.25;
/** A mark this close to the screen's centre (pixels at 1440 high, scaled) opens. */
const OPEN_PX_AT_1440 = 60;

export interface View {
  width: number;
  height: number;
  vFovDeg: number;
  hFovDeg: number;
}

const RAD = Math.PI / 180;

/** The view for a window of `width` x `height`, from the game's vertical field of view. */
export function viewOf(width: number, height: number, vFovDeg: number | null | undefined): View {
  const v = vFovDeg && vFovDeg > 0 ? vFovDeg : DEFAULT_VFOV_DEG;
  const h = (2 * Math.atan(Math.tan((v * RAD) / 2) * (width / Math.max(1, height)))) / RAD;
  return { width, height, vFovDeg: v, hFovDeg: h };
}

export interface ScreenMark {
  mark: Mark;
  x: number;
  y: number;
  /** Off the side of the screen: drawn as an arrow at that edge. */
  edge: "left" | "right" | null;
  /** Degrees to turn, negative left. */
  turnDeg: number;
  /** Degrees below the nose (pitch known), or below the horizon (pitch unknown, flying); null on foot. */
  belowDeg: number | null;
  /** True when `y` comes from a pitch estimate; false: the middle line. */
  pitched: boolean;
}

/** The marks the screen shows: composition scans (and so the next target). Samples taken are behind you. */
const shown = (m: Mark) => m.kind === "codex";

export function projectMarks(map: ExoMinimapDTO | null | undefined, view: View): ScreenMark[] {
  if (!map || map.headingDeg == null) return [];
  const cx = view.width / 2;
  const cy = view.height / 2;
  const tx = Math.tan((view.hFovDeg / 2) * RAD);
  const ty = Math.tan((view.vFovDeg / 2) * RAD);
  const alt = map.altitudeM != null && map.altitudeM > 0 ? map.altitudeM : null;
  const pitch = map.pitchDeg;
  const out: ScreenMark[] = [];
  for (const m of map.marks) {
    if (!shown(m)) continue;
    const turnDeg = relativeDeg(bearingDeg(m.eastM, m.northM), map.headingDeg);
    const downDeg = alt != null && m.distanceM > 0 ? Math.atan2(alt, m.distanceM) / RAD : null;
    const pitched = downDeg != null && pitch != null;
    // Below the nose: the angle below the horizon less the nose's own (a nose 20 deg down sees 20 deg less below).
    const belowDeg = downDeg == null ? null : pitched ? downDeg + pitch! : downDeg;
    if (Math.abs(turnDeg) >= view.hFovDeg / 2 || Math.abs(turnDeg) >= 89) {
      out.push({ mark: m, x: turnDeg < 0 ? 0 : view.width, y: cy, edge: turnDeg < 0 ? "left" : "right", turnDeg, belowDeg, pitched });
      continue;
    }
    const x = cx + (Math.tan(turnDeg * RAD) / tx) * cx;
    const yOff = pitched ? Math.max(-cy, Math.min(cy, (Math.tan(Math.max(-89, Math.min(89, belowDeg!)) * RAD) / ty) * cy)) : 0;
    out.push({ mark: m, x, y: cy + yOff, edge: null, turnDeg, belowDeg, pitched });
  }
  return out;
}

/** The mark that opens: the one nearest the screen's centre, within reach of it (across only when not pitched). */
export function openMark(marks: readonly ScreenMark[], view: View): ScreenMark | null {
  const reach = (OPEN_PX_AT_1440 * view.height) / 1440;
  let best: ScreenMark | null = null;
  let bestD = Infinity;
  for (const s of marks) {
    if (s.edge) continue;
    const d = Math.hypot(s.x - view.width / 2, s.pitched ? s.y - view.height / 2 : 0);
    if (d <= reach && (d < bestD || (d === bestD && best && s.mark.distanceM < best.mark.distanceM))) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
