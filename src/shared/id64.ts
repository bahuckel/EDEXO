/**
 * What a system address (id64) says about where the system is: its mass code, its boxel inside its sector, its
 * sector on the 1,280 ly grid, and its number in the boxel. Every system has one, hand-named or not, so a system
 * known only by its address can still be put in its boxel (plan 6.1, 2026-10-13: the game's own visited list).
 *
 * Bit layout, low to high: mass code (3), boxel z / sector z (7 - mc, 7), boxel y / sector y (7 - mc, 6),
 * boxel x / sector x (7 - mc, 7), then the system's number in the boxel.
 */
import { SECTOR_ORIGIN, SECTOR_SIZE_LY } from "./sectorName.js";
import { boxelNameAt, MASS_CODE_LETTERS, type MassCode } from "./boxelAdvice.js";
import { parseBoxel } from "./boxel.js";

export interface Id64Boxel {
  code: MassCode;
  /** The boxel's corner cell on the global grid of its mass code (gx = sector x × per-axis + boxel x). */
  grid: [number, number, number];
  /** The system's number in its boxel (`<boxel>-<n>`). */
  n: number;
  /** The sector on the 1,280 ly grid, and the boxel inside it (bx + 128 by + 16384 bz: the name's letters). */
  sector: [number, number, number];
  position: number;
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
    sector: [sx, sy, sz],
    position: bx + 128 * by + 16384 * bz,
    cubeLy: size,
    center: {
      x: SECTOR_ORIGIN.x + (grid[0] + 0.5) * size,
      y: SECTOR_ORIGIN.y + (grid[1] + 0.5) * size,
      z: SECTOR_ORIGIN.z + (grid[2] + 0.5) * size,
    },
  };
}

/**
 * A system's mass code: from a procedural name ("… d12-3"), else from its address when the address is exact. A
 * journal's SystemAddress arrives as a JSON number, which is exact only below 2^53; past that its low bits, the
 * mass code, may have been rounded away, so it is not trusted.
 */
export function massCodeOfSystem(
  addr: number | bigint | string | null | undefined,
  name?: string | null,
): MassCode | null {
  const fromName = name ? parseBoxel(name) : null;
  if (fromName && (MASS_CODE_LETTERS as readonly string[]).includes(fromName.massCode))
    return fromName.massCode as MassCode;
  if (addr == null) return null;
  if (typeof addr === "number" && !Number.isSafeInteger(addr)) return null;
  return id64Boxel(addr)?.code ?? null;
}

/**
 * The procedural name an address stands for — `<sector> <boxel>-<n>`, or `<sector> <boxel><n>` for a sector's boxel 0
 * ("Swoilz AA-A d23") — given the sector's name. Hand-named and catalogue systems have another name in the game: the
 * caller keeps those apart (the neutron index stores them, 1,826 of 3.5 M; plan 8.1).
 */
export function proceduralSystemName(
  id64: bigint | number | string,
  sectorName: (sx: number, sy: number, sz: number) => string | null,
): string | null {
  const b = id64Boxel(id64);
  if (!b) return null;
  const sector = sectorName(b.sector[0], b.sector[1], b.sector[2]);
  if (!sector) return null;
  const boxel = boxelNameAt(b.code, b.position);
  return /\d$/.test(boxel) ? `${sector} ${boxel}-${b.n}` : `${sector} ${boxel}${b.n}`;
}
