/**
 * The arrival star each system of a boxel should hold, worked out from its address (shared/stellarClass.ts; owner,
 * 2026-11-24: "Build step E"): for the systems nobody has recorded, so the Boxels table and the shortest order can
 * say what star to expect.
 *
 * It stands on the boxel's placement (server/boxelPositions.ts): a star's own rolls are counted from where the
 * system's dice stand once it is placed, so nothing is predicted unless the boxel's kind is known. The commander's
 * own scans of the boxel's arrival stars show the boxel's temperature factor, which sharpens the rest (no data
 * file: owner, 2026-11-24, "own scans only").
 */
import { boxelIndexOf, type PredictedStarDTO } from "../shared/boxel.js";
import type { Vec3 } from "../shared/boxelOrder.js";
import {
  boxelTemperatureFactor,
  predictArrivalStar,
  STAR_CLASS_SHARE,
  STAR_CLASS_SURE,
  temperatureWitness,
  type ArrivalStarScan,
} from "../shared/stellarClass.js";
import { visitedEntry, type VisitedSystem } from "./boxel.js";
import { boxelPositionSet } from "./boxelPositions.js";

export interface BoxelStarSet {
  /** System number → the star its address predicts, for every number up to the boxel's highest. */
  stars: Map<number, PredictedStarDTO>;
  /** How many of his scans showed the boxel's temperature factor. */
  witnesses: number;
}

/** His scans of a boxel's arrival stars, by system number: `arrival` reads one flown system's (null: none). */
export function boxelArrivalScans(
  prefix: string,
  visited: Iterable<VisitedSystem>,
  arrival: (systemAddress: number) => ArrivalStarScan | null,
): Map<number, ArrivalStarScan> {
  const out = new Map<number, ArrivalStarScan>();
  for (const v of visited) {
    const { name, addr } = visitedEntry(v);
    const n = addr != null ? boxelIndexOf(name, prefix) : null;
    const scan = n != null ? arrival(addr!) : null;
    if (scan) out.set(n!, scan);
  }
  return out;
}

/** The last answer per placement: the table and the order ask again after every refresh. */
const memo = new WeakMap<Map<number, number>, { factor: number | null; set: BoxelStarSet }>();

/**
 * The predicted stars of the boxel `prefix`, listed up to `upTo` (`here`: as server/boxelPositions.ts takes it).
 * `scans`: his scans of its arrival stars. Null when the boxel's stars cannot be predicted: a mass code without a
 * rule, a boxel whose kind is not known, or one listed too far.
 */
export function boxelStarSet(
  prefix: string,
  upTo: number,
  here: { name: string; pos: Vec3 } | null,
  scans: ReadonlyMap<number, ArrivalStarScan>,
): BoxelStarSet | null {
  const { frame, after } = boxelPositionSet(prefix, upTo, here);
  const share = frame ? STAR_CLASS_SHARE[frame.code] : null;
  if (!frame || !after || !share) return null;
  const address = (n: number) => frame.base | (BigInt(n) << frame.shift);
  const witnesses: { ratio: number; calm: boolean }[] = [];
  for (const [n, scan] of scans) {
    const at = after.get(n);
    const w = at != null ? temperatureWitness(address(n), frame.code, at, scan) : null;
    if (w) witnesses.push(w);
  }
  const factor = boxelTemperatureFactor(witnesses);
  const had = memo.get(after);
  if (had && had.factor === factor) return had.set;
  const sharpened = factor != null && share.sharpened != null;
  const right = sharpened ? share.sharpened! : share.right;
  const stars = new Map<number, PredictedStarDTO>();
  for (const [n, at] of after) {
    const star = predictArrivalStar(address(n), frame.code, at, factor ?? 1);
    if (!star) continue;
    stars.set(n, {
      cls: star.cls,
      right,
      alive: share.alive,
      ...(right < STAR_CLASS_SURE ? { likely: true } : {}),
      ...(sharpened ? { sharpened: true } : {}),
    });
  }
  const set = { stars, witnesses: witnesses.length };
  memo.set(after, { factor, set });
  return set;
}
