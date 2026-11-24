/**
 * Where a boxel's systems are, for the shortest order (shared/boxelOrder.ts): every route he plotted (NavRoute.json
 * gives each system's StarPos, the destination too; server/navRouteLog.ts keeps them), then Spansh's look-up of the
 * boxel (server/boxelLookup.ts), then the place the game's own dice give it (shared/stellarPlacement.ts; owner,
 * 2026-11-24). A galaxy-map target gives none: FSDTarget and Status.json carry a name and an address only (owner's
 * test, 2026-11-04), and the address places a g system no closer than its 640 ly cube.
 *
 * The third source is a prediction and is told apart ({@link BoxelPositionSet.predicted}): right for most systems,
 * about half a boxel off for the rest, and not made for mass codes f and h. The seen positions set its chain right.
 */
import { boxelIndexOf, parseBoxel } from "../shared/boxel.js";
import { boxelPositionOf, MASS_CODE_LETTERS, type MassCode } from "../shared/boxelAdvice.js";
import type { Vec3 } from "../shared/boxelOrder.js";
import {
  boxelFrame,
  boxelFrameAt,
  PLACEMENT_EXACT,
  predictBoxelPositions,
  type BoxelFrame,
} from "../shared/stellarPlacement.js";
import type { BoxelLookupRecord } from "./boxelLookup.js";
import { navRouteLog } from "./navRouteLog.js";

/** The look-ups kept by the Boxels routes (routes/boxelRoutes.ts); null until they are set up. */
let lookupOf: ((prefix: string) => BoxelLookupRecord | null) | null = null;

export function setBoxelLookupSource(get: ((prefix: string) => BoxelLookupRecord | null) | null): void {
  lookupOf = get;
}

/** A generated sector's place on the 1,280 ly grid, by its name (data/boxel/sector-names.json); null until set up. */
let sectorCellOf: ((sector: string) => readonly [number, number, number] | null) | null = null;

export function setBoxelSectorSource(
  get: ((sector: string) => readonly [number, number, number] | null) | null,
): void {
  sectorCellOf = get;
}

export interface BoxelPositionSet {
  /** System number → position, light years. */
  positions: Map<number, Vec3>;
  /** The numbers whose position is predicted, not seen. */
  predicted: Set<number>;
  /** The share of predictions that are exact at this boxel's mass code, as measured; null when none are made. */
  exact: number | null;
}

/**
 * A boxel listed past this number gets no predictions. The shortest order is worked out again after every jump, on
 * the server's own thread, and its cost grows with the square of the placed systems (measured 2026-11-24: 14 ms for
 * 300, 240 ms for 2,000, 840 ms for 4,000); and the share of exact predictions is measured up to number 300 and
 * falls with the number.
 */
export const PREDICT_MAX_NUMBER = 1000;

/** The last few predictions: the Boxels screen and the run ask again after every refresh. */
const memo = new Map<string, Map<number, Vec3>>();

/**
 * The boxel's frame: from the address of one of its systems when one is at hand (exact, and the only way for a
 * hand-named sector such as "Col 285 Sector"), else from its name through the sector's place on the grid.
 */
function frameOf(prefix: string, addresses: readonly number[]): BoxelFrame | null {
  const b = parseBoxel(`${prefix}0`);
  if (!b || !(MASS_CODE_LETTERS as readonly string[]).includes(b.massCode)) return null;
  for (const a of addresses) {
    const f = Number.isSafeInteger(a) ? boxelFrame(a) : null;
    if (f?.code === b.massCode) return f;
  }
  const cell = sectorCellOf?.(b.sector);
  const position = boxelPositionOf(b.boxel);
  return cell && position != null ? boxelFrameAt(b.massCode as MassCode, cell, position) : null;
}

/**
 * System number → position for the boxel `prefix` ("Eembaids EG-Y g"). The plotted routes win over Spansh, and both
 * over a prediction. `upTo`: the highest number wanted; without it, or past {@link PREDICT_MAX_NUMBER}, nothing is
 * predicted.
 */
export function boxelPositionSet(prefix: string, upTo?: number): BoxelPositionSet {
  const positions = new Map<number, Vec3>();
  const addresses: number[] = [];
  for (const s of navRouteLog().systems) {
    const n = boxelIndexOf(s.name, prefix);
    if (n == null || !s.pos) continue;
    positions.set(n, s.pos);
    addresses.push(s.address);
  }
  for (const [k, f] of Object.entries(lookupOf?.(prefix)?.systems ?? {})) {
    const n = Number(k);
    if (!Number.isInteger(n)) continue;
    if (f.pos && !positions.has(n)) positions.set(n, f.pos);
    if (f.id64 != null) addresses.push(f.id64);
  }
  const predicted = new Set<number>();
  if (upTo == null || !(upTo >= 0) || upTo > PREDICT_MAX_NUMBER) return { positions, predicted, exact: null };
  const frame = frameOf(prefix, addresses);
  const exact = frame ? PLACEMENT_EXACT[frame.code] : null;
  if (!frame || exact == null) return { positions, predicted, exact: null };
  // The seen positions steer the chain, so they are part of what a prediction stands on.
  let seen = 0;
  for (const n of positions.keys()) seen = (seen * 31 + n + 1) % 2147483647;
  const key = `${frame.base}|${upTo}|${positions.size}|${seen}`;
  let guess = memo.get(key);
  if (!guess) {
    guess = predictBoxelPositions(frame, upTo, positions) ?? new Map();
    memo.set(key, guess);
    if (memo.size > 8) memo.delete(memo.keys().next().value!);
  }
  for (const [n, p] of guess) {
    if (positions.has(n)) continue;
    positions.set(n, p);
    predicted.add(n);
  }
  return { positions, predicted, exact };
}

export function boxelPositions(prefix: string, upTo?: number): Map<number, Vec3> {
  return boxelPositionSet(prefix, upTo).positions;
}
