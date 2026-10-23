import { coordsDistanceLy, type SystemCoordsByNorm } from "../galaxyDistanceCompute";
import { isKnownLy } from "../systemDistanceLy";

export type { SystemCoordsByNorm };

/** One end of a leg: the system, and its distance from the construction site. */
export type LegEnd = { systemName: string; ly: number };

/**
 * S-13. How far it is from one buy stop to the next.
 *
 * The planner used to take the difference of the two stations' distances from the site. That
 * is the real leg only when both lie on one line through the site: two sellers 40 Ly out on
 * opposite sides scored a 0 Ly hop, where the flight is 80 Ly, and the nearest-neighbour order
 * ran on that one-dimensional picture. With both systems' coordinates the leg is now the
 * straight line between them.
 *
 * Without them it falls back to the radial difference. That never exceeds the real distance
 * (triangle inequality), so an unresolved pair looks as short as it could possibly be — the
 * same answer the planner gave for every pair before.
 */
export function legLy(from: LegEnd, to: LegEnd, coords?: SystemCoordsByNorm): number {
  return measuredLegLy(from.systemName, to.systemName, coords) ?? Math.abs(to.ly - from.ly);
}

/** Straight-line Ly between two systems: 0 for the same one, null without both coordinates. */
export function measuredLegLy(fromSystem: string, toSystem: string, coords?: SystemCoordsByNorm): number | null {
  const d = coordsDistanceLy(fromSystem, toSystem, (k) => coords?.[k]);
  return isKnownLy(d) ? d : null;
}
