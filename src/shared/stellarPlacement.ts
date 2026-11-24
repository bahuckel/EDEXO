/**
 * Where the game puts a boxel's systems, worked out from the system address alone, so a system nobody has visited
 * still has a place for the shortest boxel order (owner, 2026-11-24: "Build step A";
 * docs/plan-24112026-star-predictor.md).
 *
 * Every system rolls its own dice: the seed is Thomas Wang's 64-to-32-bit hash of its address and the generator is
 * MINSTD (state × 48271 mod 2³¹ − 1). A boxel is a grid of cells; its systems are placed one after the other by
 * number. One roll says whether a system is tied to the one before it (a cell −3 to +2 away on each axis, cut at the
 * boxel's walls) or goes anywhere; a try whose cell is the previous system's, or one an "anywhere" system already
 * took, is rolled again, five tries at most; three more rolls place it inside the cell on the game's 1/32 ly grid.
 *
 * Where the rules come from: the grid, the window and the same-cell rule were measured on Spansh's 203.6 million
 * system positions (docs/boxel-star-placement-23112026.md). The hash, the generator, which roll does what and the
 * order of the re-rolls were taken, as rules, from the ED-Procgen_ID64-XYZ project
 * (github.com/Intergalactic-Astronomical-Union/ED-Procgen_ID64-XYZ), which worked them out from EDSM and Spansh
 * data. None of its code is here; this file was written from the rules and checked against Spansh.
 *
 * A prediction, not a fact: a boxel also inherits state from its parent boxel that is not understood yet, so some
 * systems land in another cell ({@link PLACEMENT_EXACT}: the measured share per mass code, with nothing known).
 * A miss keeps its place inside the cell and is off by about half the boxel. Mass codes f and h are left out (66 %
 * and 38 %: h rolls once more before the placement for a reason outside the address). A system whose real position
 * is known puts the chain back on track for the ones after it.
 */
import { MASS_CODE_LETTERS, type MassCode } from "./boxelAdvice.js";
import type { Vec3 } from "./boxelOrder.js";
import { id64Boxel } from "./id64.js";
import { SECTOR_ORIGIN } from "./sectorName.js";

/**
 * Share of systems placed exactly, per mass code, with nothing but the address known and every system before it
 * predicted too (system numbers up to 300, 1,200 to 1,500 boxels each, Spansh, 2026-11-24:
 * docs/perf/ggg-study-23112026/forge_place2.py). Null: not good enough to show.
 */
export const PLACEMENT_EXACT: Record<MassCode, number | null> = {
  a: 0.931,
  b: 0.958,
  c: 0.928,
  d: 0.96,
  e: 0.866,
  f: null,
  g: 1,
  h: null,
};

const MODULUS = 2147483647;
const MULTIPLIER = 48271;
/** Rolls one system can need: the latest first try starts at roll 7, five tries of three, three for the offsets. */
const ROLLS = 25;
const TRIES = 5;
const STEPS_PER_LY = 32;
/** Cells per axis, mass code a to h. */
const CELLS = [10, 10, 20, 16, 16, 16, 16, 32] as const;

/** Thomas Wang's 64-bit to 32-bit integer hash. */
export function wang64to32(value: bigint): number {
  let n = BigInt.asUintN(64, value);
  n = BigInt.asUintN(64, ~n + (n << 18n));
  n ^= n >> 31n;
  n = BigInt.asUintN(64, n * 21n);
  n ^= n >> 11n;
  n = BigInt.asUintN(64, n + (n << 6n));
  return Number((n ^ (n >> 22n)) & 0xffffffffn);
}

/** The first rolls of a system's own stream. */
export function systemRolls(address: bigint, count = ROLLS): number[] {
  let state = wang64to32(address) % MODULUS || 1;
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    // Below 2^47: exact in a double.
    state = (state * MULTIPLIER) % MODULUS;
    out[i] = state;
  }
  return out;
}

/** A boxel as the placement sees it. */
export interface BoxelFrame {
  code: MassCode;
  /** The address of the boxel's system 0; system n adds `n << shift`. */
  base: bigint;
  shift: bigint;
  /** The boxel's low corner, light years. */
  origin: Vec3;
  cubeLy: number;
}

/** The boxel of any of its systems' addresses. */
export function boxelFrame(address: bigint | number | string): BoxelFrame | null {
  const b = id64Boxel(address);
  if (!b) return null;
  const mc = MASS_CODE_LETTERS.indexOf(b.code);
  const shift = BigInt(44 - 3 * mc);
  return {
    code: b.code,
    base: BigInt(address) & ((1n << shift) - 1n),
    shift,
    origin: [
      SECTOR_ORIGIN.x + b.grid[0] * b.cubeLy,
      SECTOR_ORIGIN.y + b.grid[1] * b.cubeLy,
      SECTOR_ORIGIN.z + b.grid[2] * b.cubeLy,
    ],
    cubeLy: b.cubeLy,
  };
}

/**
 * The boxel named by its sector's place on the 1,280 ly grid and its own place in the sector (the name's letters:
 * shared/boxelAdvice.ts `boxelPositionOf`). Null when the place does not exist at that mass code.
 */
export function boxelFrameAt(
  code: MassCode,
  sector: readonly [number, number, number],
  position: number,
): BoxelFrame | null {
  const mc = MASS_CODE_LETTERS.indexOf(code);
  const per = 1 << (7 - mc);
  const bx = position % 128;
  const by = Math.floor(position / 128) % 128;
  const bz = Math.floor(position / 16384);
  if (![bx, by, bz].every((v) => Number.isInteger(v) && v >= 0 && v < per)) return null;
  const [sx, sy, sz] = sector;
  if (!(sx >= 0 && sx < 128 && sy >= 0 && sy < 64 && sz >= 0 && sz < 128)) return null;
  // Low to high: mass code, boxel z, sector z, boxel y, sector y, boxel x, sector x (shared/id64.ts).
  const bits = BigInt(7 - mc);
  let v = 0n;
  let at = 0n;
  const put = (value: number, width: bigint) => {
    v |= BigInt(value) << at;
    at += width;
  };
  put(mc, 3n);
  put(bz, bits);
  put(sz, 7n);
  put(by, bits);
  put(sy, 6n);
  put(bx, bits);
  put(sx, 7n);
  return boxelFrame(v);
}

/**
 * The predicted position of every system 0 to `upTo` of a boxel, light years; null for a mass code that is not
 * predicted. `known`: real positions (visited, plotted, looked up), which set the chain right for the systems
 * after them. The answer holds a prediction for the known ones too, so a caller can compare.
 */
export function predictBoxelPositions(
  frame: BoxelFrame,
  upTo: number,
  known?: ReadonlyMap<number, Vec3>,
): Map<number, Vec3> | null {
  if (PLACEMENT_EXACT[frame.code] == null || !(upTo >= 0)) return null;
  const mc = MASS_CODE_LETTERS.indexOf(frame.code);
  const cells = CELLS[mc]!;
  const stepsPerCell = ((10 << mc) * STEPS_PER_LY) / cells;
  const boxelSteps = cells * stepsPerCell;
  const key = (c: readonly number[]) => c[0]! + cells * (c[1]! + cells * c[2]!);
  const taken = new Set<number>();
  let prev: readonly number[] = [0, 0, 0];
  const out = new Map<number, Vec3>();
  for (let n = 0; n <= upTo; n++) {
    const v = systemRolls(frame.base | (BigInt(n) << frame.shift));
    const phase = (mc === 0 ? v[2]! : v[1]!) % 100 <= 50 ? 7 : 8;
    // g goes anywhere, always; the rest roll for it. The first try's cell rolls start at `start`.
    let tied = mc === 6 ? false : v[phase - (mc === 0 ? 2 : 3)]! % 100 <= 49;
    const start = mc === 6 ? phase - 3 : mc === 0 ? phase - 1 : phase - 2;
    const tiedCell = (s: number) =>
      [0, 1, 2].map((i) => {
        const low = Math.max(0, prev[i]! - 3);
        const high = Math.min(cells - 1, prev[i]! + 2);
        return low + (v[s + i]! % (high - low + 1));
      });
    const anywhereCell = (s: number) => [0, 1, 2].map((i) => v[s + i]! % cells);
    let cell: number[] = [];
    let cellAt = start;
    let anywhere = false;
    for (let attempt = 0; attempt < TRIES; attempt++) {
      cellAt = start + attempt * 3;
      cell = tied ? tiedCell(cellAt) : anywhereCell(cellAt);
      const same = tied && cell.every((c, i) => c === prev[i]);
      const hit = taken.has(key(cell));
      if (!(same || hit) || attempt === TRIES - 1) {
        anywhere = !tied;
        break;
      }
      if (tied && hit && !same) tied = false;
    }
    const along = (i: number) =>
      frame.origin[i]! + (cell[i]! * stepsPerCell + (v[cellAt + 3 + i]! % stepsPerCell)) / STEPS_PER_LY;
    out.set(n, [along(0), along(1), along(2)]);
    // The real position, when known, is what the next system sees.
    const real = known?.get(n);
    const steps = real?.map((p, i) => Math.round((p - frame.origin[i]!) * STEPS_PER_LY));
    if (steps && steps.every((s) => s >= 0 && s < boxelSteps)) {
      cell = steps.map((s) => Math.floor(s / stepsPerCell));
      // Which try it was says how it was placed: its offsets follow that try's cell rolls.
      anywhere = false;
      for (let attempt = 0; attempt < TRIES; attempt++) {
        const s = start + attempt * 3;
        if (![0, 1, 2].every((i) => v[s + 3 + i]! % stepsPerCell === steps[i]! % stepsPerCell)) continue;
        anywhere = anywhereCell(s).every((c, i) => c === cell[i]);
        break;
      }
    }
    if (anywhere) taken.add(key(cell));
    prev = cell;
  }
  return out;
}
