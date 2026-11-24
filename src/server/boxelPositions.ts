/**
 * Where a boxel's systems are, for the shortest order (shared/boxelOrder.ts): every route he plotted (NavRoute.json
 * gives each system's StarPos, the destination too; server/navRouteLog.ts keeps them), then Spansh's look-up of the
 * boxel (server/boxelLookup.ts), then the place the game's own dice give it (shared/stellarPlacement.ts; owner,
 * 2026-11-24). A galaxy-map target gives none: FSDTarget and Status.json carry a name and an address only (owner's
 * test, 2026-11-04), and the address places a g system no closer than its 640 ly cube.
 *
 * The third source is a prediction and is told apart ({@link BoxelPositionSet.predicted}). A boxel is of one of two
 * kinds, and the prediction is exact once the kind is right: the seen positions say which it is, where he is
 * included; with none seen, where the boxel is in the galaxy says it (far from the centre, as around Sol, every
 * boxel is of the normal kind); in the zone between it is guessed from how crowded the boxel is, and nothing is
 * predicted when that guess is close to a coin toss. Not made for mass code h.
 */
import { boxelIndexOf, parseBoxel } from "../shared/boxel.js";
import { boxelPositionOf, MASS_CODE_LETTERS, type MassCode } from "../shared/boxelAdvice.js";
import type { Vec3 } from "../shared/boxelOrder.js";
import {
  boxelFrame,
  boxelFrameAt,
  boxelKindFrom,
  likelyBoxelKind,
  PLACEMENT_EXACT_KNOWN_KIND,
  PLACEMENT_MIN_EXACT,
  predictBoxelPositions,
  type BoxelFrame,
  type BoxelKind,
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
  /** The share of such predictions that are exact, as measured; null when none are made. */
  exact: number | null;
  /**
   * How many seen positions the boxel's kind was read from; 0 when it was guessed from how crowded the boxel is
   * (shared/stellarPlacement.ts).
   */
  checked: number;
}

/**
 * A boxel listed past this number gets no predictions. The shortest order is worked out again after every jump, on
 * the server's own thread, and its cost grows with the square of the placed systems (measured 2026-11-24: 14 ms for
 * 300, 240 ms for 2,000, 840 ms for 4,000); and the kinds of boxel are measured up to number 1,000.
 */
export const PREDICT_MAX_NUMBER = 1000;

/** The last few predictions: the Boxels screen and the run ask again after every refresh. */
const memo = new Map<string, { guess: Map<number, Vec3>; exact: number; checked: number } | null>();

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
 * The predictions for a boxel listed up to `highest`, with what they stand on: the kind the seen positions show,
 * else the kind of its part of the galaxy, else the likelier kind of a boxel this crowded. Null: nothing to show (the seen positions fit neither kind well,
 * or the guess is too close to a coin toss).
 */
function predictionsOf(
  frame: BoxelFrame,
  highest: number,
  seen: ReadonlyMap<number, Vec3>,
): { guess: Map<number, Vec3>; exact: number; checked: number } | null {
  const read = boxelKindFrom(frame, seen);
  let kind: BoxelKind;
  let exact: number;
  if (read) {
    // Seen positions that mostly disagree with both kinds: a boxel the rules do not cover.
    if (read.hits < PLACEMENT_MIN_EXACT * read.checked) return null;
    kind = read.kind;
    exact = PLACEMENT_EXACT_KNOWN_KIND;
  } else {
    const middle = frame.cubeLy / 2;
    const likely = likelyBoxelKind(frame.code, highest, [
      frame.origin[0] + middle,
      frame.origin[1] + middle,
      frame.origin[2] + middle,
    ]);
    if (!likely) return null;
    ({ kind, exact } = likely);
  }
  const guess = predictBoxelPositions(frame, highest, seen, kind);
  return guess ? { guess, exact, checked: read?.checked ?? 0 } : null;
}

/**
 * System number → position for the boxel `prefix` ("Eembaids EG-Y g"). The plotted routes win over Spansh, and both
 * over a prediction. `upTo`: the boxel's highest listed number; without it, or past {@link PREDICT_MAX_NUMBER},
 * nothing is predicted. `here`: where he is, a seen position when it is one of the boxel's systems.
 */
export function boxelPositionSet(
  prefix: string,
  upTo?: number,
  here?: { name: string; pos: Vec3 } | null,
): BoxelPositionSet {
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
  const at = here ? boxelIndexOf(here.name, prefix) : null;
  if (at != null && !positions.has(at)) positions.set(at, here!.pos);
  const predicted = new Set<number>();
  const none = { positions, predicted, exact: null, checked: 0 };
  if (upTo == null || !(upTo >= 0) || upTo > PREDICT_MAX_NUMBER) return none;
  const frame = frameOf(prefix, addresses);
  if (!frame) return none;
  // The seen positions say the kind and steer the chain, so they are part of what a prediction stands on.
  let seen = 0;
  for (const [n, p] of positions) seen = (seen * 31 + n + 1 + Math.round(p[0] * 32)) % 2147483647;
  const key = `${frame.base}|${upTo}|${positions.size}|${seen}`;
  let made = memo.get(key);
  if (made === undefined) {
    made = predictionsOf(frame, upTo, positions);
    memo.set(key, made);
    if (memo.size > 8) memo.delete(memo.keys().next().value!);
  }
  if (!made) return none;
  for (const [n, p] of made.guess) {
    if (positions.has(n)) continue;
    positions.set(n, p);
    predicted.add(n);
  }
  return { positions, predicted, exact: made.exact, checked: made.checked };
}

export function boxelPositions(
  prefix: string,
  upTo?: number,
  here?: { name: string; pos: Vec3 } | null,
): Map<number, Vec3> {
  return boxelPositionSet(prefix, upTo, here).positions;
}
