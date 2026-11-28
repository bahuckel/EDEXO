/**
 * The arrival star each system of a boxel should hold, worked out from its address (shared/stellarClass.ts; owner,
 * 2026-11-24: "Build step E"): for the systems nobody has recorded, so the Boxels table and the shortest order can
 * say what star to expect.
 *
 * It stands on the boxel's placement (server/boxelPositions.ts): a star's own rolls are counted from where the
 * system's dice stand once it is placed, so nothing is predicted unless the boxel's kind is known. The commander's
 * own scans of the boxel's arrival stars show two things of the boxel that no address holds (no data file: owner,
 * 2026-11-24, "own scans only"): its temperature factor, which sharpens the classes of the rest, and its age
 * window, which says what each other star is by now (itself, a small star in its place, a giant, a dead star).
 * And a third: whether the boxel replaces its heavier stars by small ones at any age, as boxels around Sol and at
 * the galaxy's centre do; without a scan the boxel's place says how likely that is.
 *
 * And the predictions are checked as he flies ({@link boxelStarCheck}; plan §3 item 4): each star he scanned
 * against what would have been predicted for it from his other scans in the boxel.
 */
import { boxelIndexOf, type BoxelStarCheckDTO, type PredictedStarDTO } from "../shared/boxel.js";
import type { BoxelFrame } from "../shared/stellarPlacement.js";
import type { Vec3 } from "../shared/boxelOrder.js";
import {
  ageReading,
  boxelAgeWindowFrom,
  boxelReplacement,
  boxelTemperatureFactor,
  predictArrivalStar,
  replacedShare,
  replacementWitness,
  STAR_CLASS_SHARE,
  STAR_CLASS_SURE,
  STAR_STAGE_SHARE,
  temperatureWitness,
  type AgeWindow,
  type ArrivalStarScan,
} from "../shared/stellarClass.js";
import { visitedEntry, type VisitedSystem } from "./boxel.js";
import { boxelPositionSet } from "./boxelPositions.js";

export interface BoxelStarSet {
  /** System number → the star its address predicts, for every number up to the boxel's highest. */
  stars: Map<number, PredictedStarDTO>;
  /** How many of his scans showed the boxel's temperature factor. */
  witnesses: number;
  /**
   * Whether the boxel replaces its stars by small ones, as his scans show it: the share of its other heavy stars
   * (1.44 solar masses and more) and of its lighter ones that are then replaced; null where no scan tells.
   */
  replaced: { heavy: number | null; light: number | null };
  /**
   * The boxel's age window as his scans show it (shared/stellarClass.ts `boxelAgeWindowFrom`): its width and its
   * base (the two it may be while no two scans read 128 My apart); null while the scans do not tell.
   */
  window: AgeWindow | null;
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

/**
 * A star is called a small one in another's place when that is at least this likely (one scanned replaced star in
 * the boxel makes it 86 %); under 95 % it is shown as likely, like any other answer.
 */
const REPLACED_LIKELY = 0.6;
/** Born with 1.44 solar masses and more (1/256 solar masses): the stars most such boxels replace. */
const HEAVY_FROM_MASS = 369;

/** What one of his scans says about its boxel. */
interface Evidence {
  n: number;
  at: number;
  scan: ArrivalStarScan;
  temperature: { ratio: number; calm: boolean } | null;
  reading: { upper: number; roll: number } | null;
}

/** What his scans show of a boxel: its temperature factor, its age window, and whether it replaces its stars. */
interface Verdicts {
  factor: number | null;
  witnesses: number;
  window: AgeWindow | null;
  swapped: { heavy: number | null; light: number | null };
}

const addressOf = (frame: BoxelFrame, n: number) => frame.base | (BigInt(n) << frame.shift);

function evidenceOf(
  frame: BoxelFrame,
  after: ReadonlyMap<number, number>,
  scans: ReadonlyMap<number, ArrivalStarScan>,
): Evidence[] {
  const out: Evidence[] = [];
  for (const [n, scan] of scans) {
    const at = after.get(n);
    if (at == null) continue;
    out.push({
      n,
      at,
      scan,
      temperature: temperatureWitness(addressOf(frame, n), frame.code, at, scan),
      reading: scan.age != null ? ageReading(addressOf(frame, n), scan.age) : null,
    });
  }
  return out;
}

function verdictsOf(frame: BoxelFrame, evidence: readonly Evidence[]): Verdicts {
  const witnesses = evidence.flatMap((e) => (e.temperature ? [e.temperature] : []));
  const window = boxelAgeWindowFrom(
    frame.code,
    evidence.flatMap((e) => (e.reading ? [e.reading] : [])),
  );
  // Whether the boxel replaces its stars: his scans, less the ones whose age alone makes them a small star.
  const swaps: { heavy: boolean; replaced: boolean }[] = [];
  for (const e of evidence) {
    if (predictArrivalStar(addressOf(frame, e.n), frame.code, e.at, 1, window)?.stage === "small") continue;
    const w = replacementWitness(addressOf(frame, e.n), frame.code, e.at, e.scan);
    if (w) swaps.push(w);
  }
  return { factor: boxelTemperatureFactor(witnesses), witnesses: witnesses.length, window, swapped: boxelReplacement(swaps) };
}

/** The star predicted for system `n`, given what the scans show of its boxel; null for a mass code without a rule. */
function starOf(frame: BoxelFrame, n: number, at: number, v: Verdicts): PredictedStarDTO | null {
  const share = STAR_CLASS_SHARE[frame.code];
  const star = share ? predictArrivalStar(addressOf(frame, n), frame.code, at, v.factor ?? 1, v.window) : null;
  if (!share || !star) return null;
  const sharpened = v.factor != null && share.sharpened != null;
  const classRight = sharpened ? share.sharpened! : share.right;
  const staged = STAR_STAGE_SHARE[frame.code];
  const aged = staged ? star.aged : undefined;
  const byAge = aged ? star.stage : undefined;
  // A giant or a dead star by its age: that is the answer.
  if (byAge && byAge !== "small") return { cls: star.cls, right: staged!.base.stage, stage: byAge, aged };
  // Else: is it replaced by a small star, as some boxels do to all such stars? His scans tell when they show the
  // stars kept; when they show them replaced, the place may say it louder.
  const birthMass = Math.round(star.solarMasses * 256);
  const seen = birthMass >= HEAVY_FROM_MASS || frame.code === "e" ? v.swapped.heavy : v.swapped.light;
  const half = frame.cubeLy / 2;
  const place = replacedShare(frame.code, birthMass, [frame.origin[0] + half, frame.origin[1] + half, frame.origin[2] + half]);
  const replaced = seen == null ? place : seen < 0.5 ? seen : Math.max(seen, place);
  if (replaced >= REPLACED_LIKELY) {
    const right = Math.min(0.99, replaced);
    const how = seen != null ? "kind" : "place";
    return { cls: star.cls, right, stage: "small", aged: how, ...(right < STAR_CLASS_SURE ? { likely: true } : {}) };
  }
  if (byAge) {
    // A small star by its age (a young system in the last twentieth of its main sequence).
    const right = staged!.young.small;
    return { cls: star.cls, right, stage: byAge, aged, ...(right < STAR_CLASS_SURE ? { likely: true } : {}) };
  }
  // The class, and how often the star is still itself.
  const alive = (aged ? staged![aged === "base" ? "base" : "young"].main : share.alive) * (1 - replaced);
  return {
    cls: star.cls,
    right: classRight,
    alive: Math.round(alive * 100) / 100,
    ...(aged ? { aged } : {}),
    ...(classRight < STAR_CLASS_SURE ? { likely: true } : {}),
    ...(sharpened ? { sharpened: true } : {}),
  };
}

/** The last answer per placement: the table and the order ask again after every refresh. */
const memo = new WeakMap<Map<number, number>, { key: string; set: BoxelStarSet }>();

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
  if (!frame || !after || !STAR_CLASS_SHARE[frame.code]) return null;
  const v = verdictsOf(frame, evidenceOf(frame, after, scans));
  const key = `${v.factor}|${v.window?.width}|${v.window?.bases.join()}|${v.swapped.heavy}|${v.swapped.light}`;
  const had = memo.get(after);
  if (had?.key === key) return had.set;
  const stars = new Map<number, PredictedStarDTO>();
  for (const [n, at] of after) {
    const star = starOf(frame, n, at, v);
    if (star) stars.set(n, star);
  }
  const set = { stars, witnesses: v.witnesses, window: v.window, replaced: v.swapped };
  memo.set(after, { key, set });
  return set;
}

const GIANT = /Giant$|^(S|MS|CN|CJ|C)$/;
const SMALL_CLASSES: readonly string[] = ["K", "G", "M", "L", "T", "Y", "F", "A"];

/**
 * What a scanned arrival star is, in the words a prediction uses: its class while it is the star the system was
 * born with, else "small" (the small star in its place), "giant", "whiteDwarf", "neutron", "blackHole", "tTauri",
 * "herbig" or "other".
 */
function scannedAs(frame: BoxelFrame, e: Evidence): string {
  const w = replacementWitness(addressOf(frame, e.n), frame.code, e.at, e.scan);
  if (w) return w.replaced ? "small" : e.scan.starType;
  const t = e.scan.starType;
  // A dwarf lighter than the star the system was born with: the small star of the main sequence's last twentieth
  // (its mass is not the replaced stars' roll).
  const born = predictArrivalStar(addressOf(frame, e.n), frame.code, e.at)?.solarMasses;
  if (born != null && e.scan.stellarMass < born && SMALL_CLASSES.includes(t)) return "small";
  if (t === "N") return "neutron";
  if (t === "H") return "blackHole";
  if (/^D/.test(t)) return "whiteDwarf";
  if (t === "TTS") return "tTauri";
  if (t === "AeBe") return "herbig";
  return GIANT.test(t) ? "giant" : "other";
}

/**
 * The predictions checked against his own scans (plan §3 item 4: "checks itself as he flies"): for each system of
 * the boxel whose arrival star he scanned, what would have been predicted for it from his other scans in the boxel
 * (never from its own), against what the star is. Null when the boxel's stars cannot be predicted or none is
 * scanned.
 */
export function boxelStarCheck(
  prefix: string,
  upTo: number,
  here: { name: string; pos: Vec3 } | null,
  scans: ReadonlyMap<number, ArrivalStarScan>,
): Omit<BoxelStarCheckDTO, "boxelId"> | null {
  const { frame, after } = boxelPositionSet(prefix, upTo, here);
  if (!frame || !after || !STAR_CLASS_SHARE[frame.code]) return null;
  const evidence = evidenceOf(frame, after, scans);
  const misses: BoxelStarCheckDTO["misses"] = [];
  let checked = 0;
  for (const e of evidence) {
    const predicted = starOf(frame, e.n, e.at, verdictsOf(frame, evidence.filter((x) => x !== e)));
    if (!predicted) continue;
    checked++;
    const real = scannedAs(frame, e);
    const hit = predicted.stage
      ? predicted.stage === real || (predicted.stage === "collapsed" && (real === "neutron" || real === "blackHole"))
      : predicted.cls === real;
    if (!hit) misses.push({ n: e.n, predicted, real });
  }
  if (!checked) return null;
  misses.sort((x, y) => x.n - y.n);
  return { checked, right: checked - misses.length, misses };
}
