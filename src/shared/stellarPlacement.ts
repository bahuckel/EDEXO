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
 * A boxel is of one of two kinds ({@link BoxelKind}; found 2026-11-25, docs/boxel-star-placement-23112026.md §3f).
 * In a normal one a system that rolls "tied" is tied. In a scatter one nothing is tied: every system goes anywhere,
 * with the same rolls, and for mass codes a and b the grid has twice the cells per axis. With the right kind the
 * positions are exact for 99.5 to 100 % of systems, mass codes a to g. What makes a boxel scatter is not known, so
 * the kind is read from real positions when there are any ({@link boxelKindFrom}: one is enough for a and b, one
 * that rolled "tied" for the rest), and guessed from how crowded the boxel is when there are none
 * ({@link likelyBoxelKind}). A wrong guess puts every system of an a or b boxel, and half of the others', in
 * another cell: right inside the cell, about half the boxel off. Mass code h is left out: it rolls once more
 * before the placement for a reason outside the address. A system whose real position is known also puts the chain
 * back on track for the ones after it.
 */
import { MASS_CODE_LETTERS, type MassCode } from "./boxelAdvice.js";
import type { Vec3 } from "./boxelOrder.js";
import { id64Boxel } from "./id64.js";
import { SECTOR_ORIGIN } from "./sectorName.js";

/** Normal: a system that rolls "tied" is tied. Scatter: none is, and a and b boxels have the finer grid. */
export type BoxelKind = "normal" | "scatter";

/**
 * Share of scatter boxels per mass code, by the boxel's highest listed number (up to and including the first
 * figure of each pair), on Spansh, 100 to 200 boxels per group, 2026-11-25:
 * docs/perf/ggg-study-23112026/forge_kind.py. g goes anywhere by rule, so it has one kind; h is not predicted.
 * Mass code a past 511: 9 boxels only, left out.
 */
const SCATTER_SHARE: Record<MassCode, readonly (readonly [number, number])[] | null> = {
  a: [[15, 0.015], [31, 0.255], [63, 0.585], [127, 0.545], [255, 0.365], [511, 0.37]],
  b: [[15, 0.005], [31, 0.035], [63, 0.27], [127, 0.35], [255, 0.455], [511, 0.33], [1000, 0.46]],
  c: [[15, 0], [31, 0.005], [63, 0.045], [127, 0.17], [255, 0.39], [511, 0.54], [1000, 0.65]],
  d: [[15, 0], [31, 0.025], [63, 0.01], [127, 0.04], [255, 0.045], [511, 0.19], [1000, 0.37]],
  e: [[15, 0.045], [31, 0.045], [63, 0.205], [127, 0.455], [255, 0.57], [511, 0.65], [1000, 0.86]],
  f: [[15, 0.2], [31, 0.795], [63, 0.68], [127, 0.73], [255, 0.93], [511, 0.97], [1000, 0.97]],
  g: [[1000, 0]],
  h: null,
};

/** Share of exact positions once the boxel's kind is known (measured 99.5 to 100 % in every group, a to g). */
export const PLACEMENT_EXACT_KNOWN_KIND = 0.99;
/** A guessed kind that would be exact for fewer systems than this is not shown: too close to a coin toss. */
export const PLACEMENT_MIN_EXACT = 0.6;

/** Mass codes whose systems can be placed at all. */
export const placementKnown = (code: MassCode): boolean => SCATTER_SHARE[code] != null;

/**
 * With no real position to read the kind from: the likelier kind of a boxel this crowded, and the share of its
 * systems that would then be exact. A wrong kind leaves no system of an a or b boxel in its cell (another grid),
 * and about half of the others' (the ones that roll "anywhere" either way). Null when the mass code is not
 * predicted, the boxel is listed past the measured sizes, or the share is under {@link PLACEMENT_MIN_EXACT}.
 */
export function likelyBoxelKind(code: MassCode, highest: number): { kind: BoxelKind; exact: number } | null {
  const row = highest >= 0 ? SCATTER_SHARE[code]?.find(([upTo]) => highest <= upTo) : undefined;
  if (!row) return null;
  const scatter = row[1];
  const likelier = Math.max(scatter, 1 - scatter);
  const fine = code === "a" || code === "b";
  const exact = PLACEMENT_EXACT_KNOWN_KIND * (likelier + (fine ? 0 : (1 - likelier) / 2));
  return exact < PLACEMENT_MIN_EXACT ? null : { kind: scatter > 0.5 ? "scatter" : "normal", exact };
}

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
 * after them. The answer holds a prediction for the known ones too, so a caller can compare. `kind`: the boxel's
 * kind, from {@link boxelKindFrom} or {@link likelyBoxelKind}.
 */
export function predictBoxelPositions(
  frame: BoxelFrame,
  upTo: number,
  known?: ReadonlyMap<number, Vec3>,
  kind: BoxelKind = "normal",
): Map<number, Vec3> | null {
  if (!placementKnown(frame.code) || !(upTo >= 0)) return null;
  const mc = MASS_CODE_LETTERS.indexOf(frame.code);
  const scatter = kind === "scatter";
  // A scatter boxel of mass code a or b has twice the cells per axis.
  const cells = CELLS[mc]! * (scatter && mc <= 1 ? 2 : 1);
  const stepsPerCell = ((10 << mc) * STEPS_PER_LY) / cells;
  const boxelSteps = cells * stepsPerCell;
  const key = (c: readonly number[]) => c[0]! + cells * (c[1]! + cells * c[2]!);
  const taken = new Set<number>();
  let prev: readonly number[] = [0, 0, 0];
  const out = new Map<number, Vec3>();
  for (let n = 0; n <= upTo; n++) {
    const v = systemRolls(frame.base | (BigInt(n) << frame.shift));
    const phase = (mc === 0 ? v[2]! : v[1]!) % 100 <= 50 ? 7 : 8;
    // g goes anywhere, always, and so does every system of a scatter boxel; the rest roll for it. The first try's
    // cell rolls start at `start`.
    let tied = mc === 6 || scatter ? false : v[phase - (mc === 0 ? 2 : 3)]! % 100 <= 49;
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

/**
 * Which kind of boxel the real positions show, or null when they do not tell (none known, or only systems that
 * roll "anywhere" in a c to f boxel, which land the same either way). Each known system is predicted both ways
 * from the real position of the ones before it; the kind that puts more of them where they are is the answer.
 * `checked`: the known systems looked at, `hits`: how many of them that kind puts right.
 */
export function boxelKindFrom(
  frame: BoxelFrame,
  known: ReadonlyMap<number, Vec3>,
): { kind: BoxelKind; checked: number; hits: number } | null {
  if (!placementKnown(frame.code) || !known.size) return null;
  let upTo = -1;
  for (const n of known.keys()) if (Number.isInteger(n) && n > upTo) upTo = n;
  const score = (kind: BoxelKind): number => {
    const guess = predictBoxelPositions(frame, upTo, known, kind);
    let hits = 0;
    for (const [n, real] of known) if (guess?.get(n)?.every((v, i) => v === real[i])) hits++;
    return hits;
  };
  const normal = score("normal");
  const scatter = score("scatter");
  if (normal === scatter) return null;
  return { kind: scatter > normal ? "scatter" : "normal", checked: known.size, hits: Math.max(normal, scatter) };
}
