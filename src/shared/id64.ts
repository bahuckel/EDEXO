/**
 * What a system address (id64) says about where the system is: its mass code, its boxel inside its sector, its
 * sector on the 1,280 ly grid, and its number in the boxel. Every system has one, hand-named or not, so a system
 * known only by its address can still be put in its boxel (plan 6.1, 2026-10-13: the game's own visited list).
 *
 * Bit layout, low to high: mass code (3), boxel z / sector z (7 - mc, 7), boxel y / sector y (7 - mc, 6),
 * boxel x / sector x (7 - mc, 7), then the system's number in the boxel.
 */
import { SECTOR_ORIGIN, SECTOR_SIZE_LY } from "./sectorName.js";
import { MASS_CODE_LETTERS, type MassCode } from "./boxelAdvice.js";

export interface Id64Boxel {
  code: MassCode;
  /** The boxel's corner cell on the global grid of its mass code (gx = sector x × per-axis + boxel x). */
  grid: [number, number, number];
  /** The system's number in its boxel (`<boxel>-<n>`). */
  n: number;
  cubeLy: number;
  /** The boxel's centre, ly: within half a cube's diagonal of the system. */
  center: { x: number; y: number; z: number };
}

export function id64Boxel(id64: bigint | number | string): Id64Boxel | null {
  let v: bigint;
  try {
    v = BigInt(id64);
  } catch {
    return null;
  }
  if (v < 0n || v >= 1n << 64n) return null;
  const mc = Number(v & 7n);
  if (mc > 7) return null;
  const bs = BigInt(7 - mc);
  const take = (bits: bigint): number => {
    const out = Number(v & ((1n << bits) - 1n));
    v >>= bits;
    return out;
  };
  v >>= 3n;
  const bz = take(bs);
  const sz = take(7n);
  const by = take(bs);
  const sy = take(6n);
  const bx = take(bs);
  const sx = take(7n);
  const n = Number(v);
  const per = 1 << (7 - mc);
  const size = SECTOR_SIZE_LY / per;
  const grid: [number, number, number] = [sx * per + bx, sy * per + by, sz * per + bz];
  return {
    code: MASS_CODE_LETTERS[mc]!,
    grid,
    n,
    cubeLy: size,
    center: {
      x: SECTOR_ORIGIN.x + (grid[0] + 0.5) * size,
      y: SECTOR_ORIGIN.y + (grid[1] + 0.5) * size,
      z: SECTOR_ORIGIN.z + (grid[2] + 0.5) * size,
    },
  };
}
