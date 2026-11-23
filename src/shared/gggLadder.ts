/**
 * Green gas giants by the cloud ladder — CMDR Arcanic's "The Mystery Property: Revealed" (2026), from
 * CMDR Regza's finding that bulk density is the property the green ones share (owner, 2026-10-05).
 * Aligned to his own code on https://ed-ggg.github.io/edggg/densitydemo.html (owner, 2026-10-07: "align
 * it to his code"): the float path, the step limits, the cracks and the nudge ranges are his.
 *
 * Every gas giant gets seven cloud layers ("rungs"), evenly spaced in temperature from its surface
 * temperature up to a top that its density decides, capped by a ceiling. Each class colours its
 * clouds by temperature band; a rung that lands exactly on a band border ("crack", "door") is given
 * no colour and stays the default green.
 *
 *   density = MassEM × 5.97219e24 / (4/3 · π · r³)                      kg/m³, r in metres
 *   reach   = (density/1300 · T)^1.2 · (1/180) · (130000/density)        = 722.2 · (T/1300)^1.2 · density^0.2
 *   top     = min(T + reach, ceiling(T))
 *   step    = (top − T) · (1/7), held to the class's limits (class II–V)
 *   rung k  = f32(step · k + T),  k = 0 … 6
 *
 * Everything is 64-bit until the rung, which is rounded to a 32-bit float once, as he does. That puts
 * all 37 catalogued GGGs that cannot be nudged exactly on a crack (with their Spansh values), and
 * reproduces his always-green tables value by value (176.666626 K is not green: it misses by a step).
 *
 * Some giants get a random nudge of their temperature before the ladder is built (his ranges in
 * `nudgeOf`): below a class's lower bound nothing can be said; between it and the upper bound a
 * crack hit still holds if the nudge left the planet alone ("maybe"), with the chance of
 * `nudgeKeepChance`.
 *
 * One line is not his (study of 2026-11-17 on a year of EDDN scans and Spansh's dump; built in on the
 * owner's word, 2026-11-22): a cold giant the nudge may leave alone builds its ladder from
 * T · 0.9 / f32(0.9), not from T (`COLD_KEPT`). A rung a float step or two off a crack is no longer a
 * hit of any kind: no such giant is green, and the three catalogued ones that needed it land exactly
 * with this line.
 */

const f = Math.fround;

/** Earth's mass in kg, as in the formula. */
const EARTH_KG = 5.97219e24;

/** Ceiling of the ladder: from this surface temperature up, this ceiling. */
const CEILINGS: readonly [number, number][] = [
  [0, 100],
  [75, 340],
  [330, 700],
  [680, 1200],
  [900, 1500],
  [1400, 5000],
];

export type LadderClass =
  "I" | "II" | "III" | "IV" | "V" | "ammonia" | "water" | "waterGiant" | "heliumRich" | "helium";

/** Band borders ("cracks", "doors"), in K: class I and ammonia-based life, and all other gas and water giants. */
const CRACKS_COLD: readonly number[] = [115, 250, 270, 370, 700, 900, 1400];
const CRACKS: readonly number[] = [114, 210, 270, 370, 700, 900, 1400];

export function cracksOf(cls: LadderClass): readonly number[] {
  return cls === "I" || cls === "ammonia" ? CRACKS_COLD : CRACKS;
}

/** Smallest and largest step between rungs, in K. */
const STEP_LIMITS: Partial<Record<LadderClass, readonly [number, number]>> = {
  II: [5, 20],
  III: [30, 100],
  IV: [50, 100],
  V: [250, 1000],
};

/** Nudge ranges of class II–V: up to the first value always nudged, below the second maybe. */
const NUDGE: Partial<Record<LadderClass, readonly [number, number]>> = {
  II: [250, 280],
  III: [365, 415],
  IV: [500, 700],
  V: [1000, 1500],
};

/**
 * What the cold nudge leaves of a temperature it does not move: T · 0.9 / f32(0.9), 2.65 parts in 100
 * million above T, kept in 64 bits. The nudge works on 0.9 · T (his test `t < 110 + 0.1·t` is
 * 0.9 · t < 110) and seems to divide by a 32-bit 0.9 on the way back: x = max(0.9 · T, 90 + 20 · draw),
 * T' = x / 0.9f. With T itself, three of the five catalogued GGGs of the range miss their crack by one
 * float step (Boekh AO-H b27-33 1, Dryooe Groa QX-F c16 A 7, Synookio EI-J d9-1 7); with this all five
 * land exactly, and of Spansh's 3,524,714 cold giants of the range with a real-precision temperature
 * the ladder lands on those five and no other. Whether class II–V keep theirs the same way is not
 * known: no body tests it (the one catalogued GGG there sits on a crack at its surface either way).
 */
const COLD_KEPT = 0.9 / f(0.9);

/** The journal's PlanetClass → the ladder's class; null for a body that is not a gas or water giant. */
export function ladderClassOf(planetClass: string | null | undefined): LadderClass | null {
  switch ((planetClass ?? "").trim()) {
    case "Sudarsky class I gas giant":
      return "I";
    case "Sudarsky class II gas giant":
      return "II";
    case "Sudarsky class III gas giant":
      return "III";
    case "Sudarsky class IV gas giant":
      return "IV";
    case "Sudarsky class V gas giant":
      return "V";
    case "Gas giant with ammonia based life":
      return "ammonia";
    case "Gas giant with water based life":
      return "water";
    case "Water giant":
      return "waterGiant";
    case "Helium rich gas giant":
      return "heliumRich";
    case "Helium gas giant":
      return "helium";
    default:
      return null;
  }
}

function ceilingOf(t: number): number {
  let c = 10000;
  for (const [from, ceiling] of CEILINGS) {
    if (t >= from) c = ceiling;
    else break;
  }
  return c;
}

/** Bulk density in kg/m³ from the journal's MassEM and Radius (metres). */
export function gasGiantDensity(massEM: number, radiusM: number): number {
  return (massEM * EARTH_KG) / ((4 / 3) * Math.PI * radiusM ** 3);
}

/** His depth for the temperature the ladder is built from (the shown one, or the cold nudge's 64-bit one). */
function depthOf(t: number, density: number): number {
  return Math.pow((density / 1300) * t, 1.2) * (1 / 180) * (130000 / density);
}

/** How far up the clouds reach above the surface, in K (the "depth"), as his code computes it. */
export function ladderDepth(tempK: number, density: number): number {
  return depthOf(f(tempK), density);
}

/**
 * Whether the shown temperature can be nudged: `always` (nothing can be said), `maybe` (a crack hit
 * holds if the nudge left it alone) or `none`. His `nudgeOf`.
 */
export function nudgeOf(cls: LadderClass, tempK: number): "none" | "maybe" | "always" {
  const t = f(tempK);
  const n = NUDGE[cls];
  if (n) return t >= n[1] ? "none" : t > n[0] ? "maybe" : "always";
  if (t > 80 && t < 110 + 0.1 * t) return t > 100 ? "maybe" : "always";
  return "none";
}

/** True where the shown temperature may not be the ladder's (`maybe` or `always`). */
export function inNudgeRange(cls: LadderClass, tempK: number): boolean {
  return nudgeOf(cls, tempK) !== "none";
}

/**
 * The chance the nudge leaves a giant alone: 1 outside the nudge ranges, 0 where it always moves, and
 * in a "maybe" range the giant's place in it, (T − lower) / (upper − lower) — the draw is even over
 * the range and never lowers a temperature. Cold giants: (T − 100) / 22.22; the five catalogued GGGs
 * there that kept their temperature stand at 0.62 to 0.95 of the range, the four that were moved at
 * 0.00 to 0.44. For class II–V it is his description of the nudge, with one GGG to go by.
 */
export function nudgeKeepChance(cls: LadderClass, tempK: number): number {
  const t = f(tempK);
  const nudge = nudgeOf(cls, t);
  if (nudge !== "maybe") return nudge === "none" ? 1 : 0;
  const [lo, hi] = nudgeRange(cls);
  return (t - lo) / (hi - lo);
}

interface Ladder {
  rungs: number[];
  /** The density set the step: the clouds stop short of the ceiling and the step is not held to a limit. */
  densityDecided: boolean;
  /** The step was raised to the class's smallest step: then no density can change it. */
  heldAtMin: boolean;
}

/**
 * His `ladder`, built from the temperature the nudge left (`COLD_KEPT` for a cold giant in its "maybe"
 * range); without a density the clouds are assumed to reach the ceiling.
 */
function buildLadder(cls: LadderClass, tempK: number, density: number | null): Ladder {
  const shown = f(tempK);
  const t = !NUDGE[cls] && nudgeOf(cls, shown) === "maybe" ? shown * COLD_KEPT : shown;
  const ceil = ceilingOf(t);
  const top = density != null ? depthOf(t, density) + t : Infinity;
  let step = ((ceil < top ? ceil : top) - t) * (1 / 7);
  const free = step;
  const lim = STEP_LIMITS[cls];
  if (lim) step = Math.max(Math.min(step, lim[1]), lim[0]);
  const bottom = ceil < t ? ceil : t;
  const rungs: number[] = [];
  for (let k = 0; k < 7; k++) rungs.push(f(step * k + bottom));
  return {
    rungs,
    densityDecided: top < ceil && step === free,
    heldAtMin: !!lim && free < lim[0],
  };
}

/** The seven rungs (32-bit) for a temperature and density; null density: the ceiling is assumed. */
export function ladderRungs(cls: LadderClass, tempK: number, density: number | null): number[] {
  return buildLadder(cls, tempK, density).rungs;
}

/**
 * His nudge range for a class, [lower, upper] in K: class II–V their own; every other giant 100 K to
 * where 0.9 · T reaches 110 (122.2 K).
 */
export function nudgeRange(cls: LadderClass): readonly [number, number] {
  return NUDGE[cls] ?? [100, 110 / 0.9];
}

export interface LadderVerdict {
  /** The rung on a crack (1 = the surface) and the crack's temperature. */
  rung: number;
  door: number;
  /** `ceiling`: temperature alone decides (certain); `density`: the density's float path matters (likely). */
  basis: "ceiling" | "density";
  /** `maybe`: the planet can be nudged; the hit holds only if the nudge left it alone. */
  nudge: "none" | "maybe";
  /** The chance the nudge left it alone (`nudgeKeepChance`): 1 unless `maybe`. */
  keepChance: number;
}

/**
 * The ladder's verdict for one gas giant, or null when no rung lands exactly on a crack (or the planet
 * is always nudged, or the inputs are missing). A rung next to a crack is not his "green", and his "on
 * the edge" finds nothing: of the year's 16 giants one to three float steps off, none is green.
 */
export function ladderGreen(opts: {
  planetClass: string | null | undefined;
  tempK: number | null | undefined;
  massEM: number | null | undefined;
  radiusM: number | null | undefined;
}): LadderVerdict | null {
  const cls = ladderClassOf(opts.planetClass);
  const T = opts.tempK;
  if (!cls || T == null || !Number.isFinite(T) || T <= 0) return null;
  const nudge = nudgeOf(cls, T);
  if (nudge === "always") return null;
  const density =
    opts.massEM != null && opts.radiusM != null && opts.massEM > 0 && opts.radiusM > 0
      ? gasGiantDensity(opts.massEM, opts.radiusM)
      : null;
  const L = buildLadder(cls, T, density);
  const cracks = cracksOf(cls);
  const k = L.rungs.findIndex((r) => cracks.includes(r));
  if (k < 0) return null;
  // Certain when no density can move the rung: the surface, a scanned density that reaches the
  // ceiling, or a step held at its smallest. Without a mass the ceiling is only assumed.
  const certain = k === 0 || L.heldAtMin || (density != null && !L.densityDecided);
  return {
    rung: k + 1,
    door: L.rungs[k]!,
    basis: certain ? "ceiling" : "density",
    nudge,
    keepChance: nudgeKeepChance(cls, T),
  };
}

/**
 * Every float temperature in [lo, hi] a class turns green at whatever its density, once the ladder
 * reaches its ceiling — his "every always-green surface temperature" tables. For tests and research.
 */
export function alwaysGreenTemps(cls: LadderClass, lo: number, hi: number): number[] {
  const out: number[] = [];
  const buf = new DataView(new ArrayBuffer(4));
  buf.setFloat32(0, lo);
  let bits = buf.getInt32(0);
  buf.setFloat32(0, hi);
  const end = buf.getInt32(0);
  const cracks = cracksOf(cls);
  for (; bits <= end; bits++) {
    buf.setInt32(0, bits);
    const t = buf.getFloat32(0);
    if (buildLadder(cls, t, null).rungs.some((r) => cracks.includes(r))) out.push(t);
  }
  return out;
}
