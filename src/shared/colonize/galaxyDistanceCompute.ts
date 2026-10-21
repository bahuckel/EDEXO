import { distanceLy3d } from "./systemDistanceLy";
import { normSystemName } from "./stationFilter";

export type GalaxyCoords = [number, number, number];

/** Galaxy x/y/z per system, keyed by `normSystemName` — what `resolveSystemCoords` returns. */
export type SystemCoordsByNorm = Readonly<Record<string, GalaxyCoords>>;

/** 3D straight-line Ly between two systems when both coords are known. */
export function galaxyDistanceLy3d(
  fromSystem: string,
  toSystem: string,
  coordsByNorm: ReadonlyMap<string, GalaxyCoords>,
): number | null {
  const fromNorm = normSystemName(fromSystem);
  const toNorm = normSystemName(toSystem);
  if (!fromNorm || !toNorm) return null;
  if (fromNorm === toNorm) return 0;
  const a = coordsByNorm.get(fromNorm);
  const b = coordsByNorm.get(toNorm);
  if (!a || !b) return null;
  return distanceLy3d(a, b);
}
