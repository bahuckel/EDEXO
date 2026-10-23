import { distanceLy3d } from "./systemDistanceLy";
import { normSystemName } from "./stationFilter";

export type GalaxyCoords = [number, number, number];

/** Galaxy x/y/z per system, keyed by `normSystemName` — what `resolveSystemCoords` returns. */
export type SystemCoordsByNorm = Readonly<Record<string, GalaxyCoords>>;

/**
 * 3D straight-line Ly between two systems: 0 for the same one, null unless both coordinates are known. The one rule
 * for the server's Map of coordinates and the planner's record of them (audit 2026-10-22: two copies).
 */
export function coordsDistanceLy(
  fromSystem: string,
  toSystem: string,
  coordsOf: (norm: string) => GalaxyCoords | undefined,
): number | null {
  const fromNorm = normSystemName(fromSystem);
  const toNorm = normSystemName(toSystem);
  if (!fromNorm || !toNorm) return null;
  if (fromNorm === toNorm) return 0;
  const a = coordsOf(fromNorm);
  const b = coordsOf(toNorm);
  if (!a || !b) return null;
  return distanceLy3d(a, b);
}

/** 3D straight-line Ly between two systems when both coords are known. */
export function galaxyDistanceLy3d(
  fromSystem: string,
  toSystem: string,
  coordsByNorm: ReadonlyMap<string, GalaxyCoords>,
): number | null {
  return coordsDistanceLy(fromSystem, toSystem, (k) => coordsByNorm.get(k));
}
