/**
 * The screen marker's maths (owner, 2026-11-04: "ship moves along with mouse movement, so camera almost always points
 * directly at where the ship is pointed. So we have a dot in a circle on the screen where you need to point at, when
 * you point at a dot it opens to a hexagon and tells you the name").
 *
 * The camera looks where the nose points, so a mark's place on the screen is its angle off the nose put through the
 * game's own projection: across from the heading (exact), up / down from how far below the nose it is, which needs
 * the nose's pitch: Status.json has none, so it is the flight-path estimate (scanLocate.ts FlightPathPitch). Without
 * one (hovering) the nose is taken as level (owner, 2026-11-04: the hexagon opened on a plant 18 deg below a level nose,
 * "it still does not take into consideration the height"), drawn dashed to say so. On foot (no altitude) the marks
 * ride the middle line and open on direction alone.
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
  /** Degrees below the nose (pitch estimated, or level assumed), null on foot. */
  belowDeg: number | null;
  /** True when `y` comes from a pitch estimate; false: a level nose assumed, or on foot. */
  pitched: boolean;
}

/**
 * The marks the screen shows: composition scans (and so the next target), and the samples taken (owner, 2026-11-04:
 * "the On-Foot scans are not marked"), each ringed with its genus's sample distance.
 */
const shown = (m: Mark) => m.kind === "codex" || m.kind === "sample";

/** A ground point's angles off the nose and its place on the screen; `null` y offset on foot (no altitude). */
interface Placed {
  turnDeg: number;
  belowDeg: number | null;
  /** Off the side or behind: no place on the screen. */
  off: boolean;
  x: number;
  y: number;
}

/** The projection for this frame: a ground point (metres east and north of the commander) to the screen. */
function projector(map: ExoMinimapDTO, headingDeg: number, view: View, origin?: { x: number; y: number } | null) {
  // Half the view for the scale, the origin for the place (they differ when the HUD sits off the screen's centre).
  const hx = view.width / 2;
  const hy = view.height / 2;
  const cx = origin?.x ?? hx;
  const cy = origin?.y ?? hy;
  const tx = Math.tan((view.hFovDeg / 2) * RAD);
  const ty = Math.tan((view.vFovDeg / 2) * RAD);
  // From the eye, which sits above the reported altitude (learned per ship, server/eyeHeight.ts).
  const alt = map.altitudeM != null && map.altitudeM > 0 ? map.altitudeM + (map.eyeAboveM ?? 0) : null;
  const pitch = map.pitchDeg;
  // Rolled (the HUD read): the world turns on the screen with the ladder; positions turn by the boxes' tilt.
  const roll = (map.rollDeg ?? 0) * RAD;
  const place = (eastM: number, northM: number, distanceM: number): Placed => {
    const turnDeg = relativeDeg(bearingDeg(eastM, northM), headingDeg);
    const downDeg = alt != null && distanceM > 0 ? Math.atan2(alt, distanceM) / RAD : null;
    // Below the nose: the angle below the horizon less the nose's own (a nose 20 deg down sees 20 deg less below);
    // no estimate: a level nose.
    const belowDeg = downDeg == null ? null : downDeg + (pitch ?? 0);
    if (Math.abs(turnDeg) >= view.hFovDeg / 2 || Math.abs(turnDeg) >= 89) {
      return { turnDeg, belowDeg, off: true, x: turnDeg < 0 ? 0 : view.width, y: cy };
    }
    const xOff = (Math.tan(turnDeg * RAD) / tx) * hx;
    const yOff = belowDeg != null ? Math.max(-hy, Math.min(hy, (Math.tan(Math.max(-89, Math.min(89, belowDeg)) * RAD) / ty) * hy)) : 0;
    return { turnDeg, belowDeg, off: false, x: cx + xOff * Math.cos(roll) - yOff * Math.sin(roll), y: cy + xOff * Math.sin(roll) + yOff * Math.cos(roll) };
  };
  return { place, alt, pitched: pitch != null };
}

/** `origin`: where the nose points on the screen (the HUD's centre the reader found), else the screen's centre. */
export function projectMarks(map: ExoMinimapDTO | null | undefined, view: View, origin?: { x: number; y: number } | null): ScreenMark[] {
  if (!map || map.headingDeg == null) return [];
  const { place, pitched } = projector(map, map.headingDeg, view, origin);
  const out: ScreenMark[] = [];
  for (const m of map.marks) {
    if (!shown(m)) continue;
    const p = place(m.eastM, m.northM, m.distanceM);
    const edge = p.off ? (p.turnDeg < 0 ? "left" : "right") : null;
    out.push({ mark: m, x: p.x, y: p.y, edge, turnDeg: p.turnDeg, belowDeg: p.belowDeg, pitched: p.belowDeg != null && pitched });
  }
  return out;
}

/** The mark that opens: the one nearest the screen's centre, within reach of it (across only on foot). */
export function openMark(marks: readonly ScreenMark[], view: View, origin?: { x: number; y: number } | null): ScreenMark | null {
  const ox = origin?.x ?? view.width / 2;
  const oy = origin?.y ?? view.height / 2;
  const reach = (OPEN_PX_AT_1440 * view.height) / 1440;
  let best: ScreenMark | null = null;
  let bestD = Infinity;
  for (const s of marks) {
    if (s.edge) continue;
    const d = Math.hypot(s.x - ox, s.belowDeg != null ? s.y - oy : 0);
    if (d <= reach && (d < bestD || (d === bestD && best && s.mark.distanceM < best.mark.distanceM))) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
