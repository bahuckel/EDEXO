/**
 * The arrival star of a generated system, worked out from the system's address, so a system nobody has visited can
 * say what star to expect (owner, 2026-11-24: "Build step E", then "Yes, build it" for the stages;
 * docs/plan-24112026-star-predictor.md, docs/boxel-star-placement-23112026.md §3g, §3i and §3j).
 *
 * The star is rolled on the system's own dice (shared/stellarPlacement.ts). The first roll is its birth mass, in
 * 1/256 of a solar mass, inside the band of its mass code. Once the system is placed, the next roll but one scales
 * the temperature that goes with that mass by 0.9 to 1.1 (a young system of mass code d and up rolls once more
 * first), and the class is the whole temperature against fixed limits. The temperature per birth mass is measured
 * (shared/stellarBaseTemperature.ts).
 *
 * What the star is by now goes by the system's age against the length of its main sequence,
 * T = 11000 × mass^-2.5 million years ({@link stageAt}): itself up to 0.95 T, then a small star in its place up to
 * T, then a giant, then dead (a white dwarf under 1.44 solar masses, a neutron star from there). The age is
 * ({@link systemAges}):
 * - on the system's own dice for a young system of mass code d or e (a roll modulo the main sequence's length,
 *   shared/stellarYoungModulus.ts), so its stage is told from nothing;
 * - for the others, a roll inside the boxel's age window: a base age and a width, both the boxel's own and found
 *   nowhere in the address. In the disc the window is as wide as half the main sequence of the mass code's
 *   heaviest star (1,270 or 1,271 My for d) with a base of up to as much again; the old boxels high over the plane
 *   have 4,000 My and a base of up to 9,200. Two scanned systems of the boxel show which ({@link ageReading},
 *   {@link boxelAgeWindowFrom}); the base is settled once two of them read 128 My apart. Without the window the
 *   stage is not told, and the class is the one the star has if it is still on the main sequence;
 *   {@link STAR_CLASS_SHARE} says how often it is.
 *
 * And one more thing it cannot know from the address: the boxel's own temperature factor. Every star of one boxel
 * is off by the same few parts in a thousand to two in a hundred (a quarter of the boxels far from the galaxy's
 * centre sit 1 to 2.3 % low), which moves a star near a limit into the next class. One scanned arrival star of the
 * boxel shows it ({@link temperatureWitness}, {@link boxelTemperatureFactor}); mass code d misses 95 % without it.
 *
 * And a third: in some boxels every star born heavier than a limit is replaced by a small one at any age. Around
 * Sol that is every star of 1.44 solar masses and more within 500 ly, thinning out to one boxel in seven at
 * 4,000 ly, and half of the lighter mass code d stars within 300 ly; the galaxy's centre has it too
 * ({@link replacedShare}; most such boxels hold a real catalogue star). It is the boxel's, all or none: one
 * scanned system of the boxel tells for the others ({@link replacementWitness}, {@link boxelReplacement}).
 *
 * Not told: T Tauri stars (in mass codes b and c exactly the systems under 212 My, but which young systems are
 * that young is on no roll found so far), black holes (mass code e: about one dead star in nine), Herbig stars.
 * Mass codes b to e. a has no mass rule yet, f and g too few stars for a temperature table, h is not placed.
 * Measured on stars the rules were not taken from: docs/perf/ggg-study-23112026/forge_judge.py (class),
 * forge_death_judge.py (stage).
 */
import { MASS_CODE_LETTERS, type MassCode } from "./boxelAdvice.js";
import type { Vec3 } from "./boxelOrder.js";
import { BASE_TEMPERATURE, BASE_TEMPERATURE_FIRST_MASS } from "./stellarBaseTemperature.js";
import { systemRolls } from "./stellarPlacement.js";
import { YOUNG_MODULUS_OFFSETS } from "./stellarYoungModulus.js";

/** Main-sequence classes, coolest first, and the whole kelvin each of the hotter ones starts at. */
export const MAIN_SEQUENCE = ["M", "K", "G", "F", "A", "B", "O"] as const;
export type MainSequenceClass = (typeof MAIN_SEQUENCE)[number];
const CLASS_FROM_KELVIN = [3700, 5200, 6000, 7500, 10000, 33000] as const;
/** Under this many kelvin the star is a brown dwarf of class L (mass code b: L up to 1,999 K, M from 2,000). */
const CLASS_M_FROM_KELVIN = 2000;
/** The class a star still itself can have: the main sequence, or L when it is too cool for M. */
export type StarClass = MainSequenceClass | "L";

/** Birth mass per mass code, 1/256 solar masses: first value and how many values. */
const MASS_BAND: Partial<Record<MassCode, readonly [number, number]>> = {
  b: [51, 64],
  c: [115, 115],
  d: [230, 230],
  e: [460, 1100],
};
/** The roll's factor: 0.9 + (roll % 52429) / 262144, so 0.9 to 1.1 (52429 is 0.8 in 16.16 fixed point). */
const FACTOR_SPAN = 52429;
const FACTOR_UNIT = 262144;
/** A scanned star's real / predicted temperature is taken as the boxel's factor only inside this window. */
const FACTOR_MIN = 0.95;
const FACTOR_MAX = 1.02;

/** The main sequence lasts 11000 × mass^-2.5 My; the star is itself for the first 0.95 of it. */
const LENGTH_MY = 11000;
const LENGTH_POWER = -2.5;
const ITSELF_SHARE = 0.95;
/**
 * The giant phase after it, My: a fit to the gaps between the last giant and the first dead star of 209 birth
 * masses (mass code d; 30 of 82,173 stars on the wrong side, by 5 My at most), not a rule that is understood.
 */
const GIANT_MY = [
  [612.38005, -12.22874],
  [223.57253, -0.93537],
] as const;
/** A dead star of a birth mass under this (1.44 solar masses) is a white dwarf, from it a neutron star. */
const NEUTRON_FROM_MASS = 369;
/**
 * The widths a boxel's age window can have, My, with the highest base each goes with. The wide one is every mass
 * code's (past a base of 9,200 it is cut at 13,200: left out); the others are the disc's for mass code d. Mass
 * code e's disc windows (59 and 60 My) are left out: the stage told from them is right for 55 to 90 % only.
 */
const WINDOWS: Partial<Record<MassCode, readonly (readonly [width: number, topBase: number])[]>> = {
  d: [
    [1270, 1270],
    [1271, 1271],
    [4000, 9200],
  ],
  e: [[4000, 9200]],
};
/** The journal's age is v + v % 256: two ages 128 apart read the same. */
const AGE_FOLD = 256;

/** A boxel's age window as scans have shown it: its width, and the base (or the two bases it may be). */
export interface AgeWindow {
  width: number;
  bases: number[];
}

/**
 * As measured on unfitted stars, per mass code. `alive`: arrival stars that are still themselves (Spansh, 380,000
 * systems per code; the rest are dead stars, giants, T Tauri stars, small stars in their place), with the stars a
 * boxel replaces ({@link replacedShare}) taken out: they are counted by the boxel's place. `right`: of
 * those, the share whose class the address gives, 22,000 ly and more from the galaxy's centre (the lower of the
 * EDDN and Spansh figures). `sharpened`: the same with the boxel's factor read off one scanned star (the lower of
 * the two again); null where the factor brings nothing (e: the class is right either way).
 */
export const STAR_CLASS_SHARE: Partial<Record<MassCode, { alive: number; right: number; sharpened: number | null }>> =
  {
    b: { alive: 0.98, right: 0.996, sharpened: 0.998 },
    c: { alive: 0.99, right: 0.964, sharpened: 0.985 },
    d: { alive: 0.85, right: 0.94, sharpened: 0.978 },
    e: { alive: 0.62, right: 0.993, sharpened: null },
  };
/** Under this share an answer is shown as likely, not as predicted (owner, 2026-11-24: the plan's 95 %). */
export const STAR_CLASS_SURE = 0.95;

/** What an arrival star is once it is no longer itself on the main sequence. */
export type StarStage = "small" | "giant" | "whiteDwarf" | "neutron" | "collapsed";
/**
 * How often an answer told from the system's age is right, as measured on a quarter of the EDDN year the rules
 * were not found on (forge_death_judge2.py). `base`: the age from the boxel's window; `young`: from the system's
 * own dice. `main`: the share of "still itself" answers that are right, the stars a boxel replaces
 * ({@link replacedShare}) left aside; `stage`, `small`: the share of the other answers (in e the dead star is
 * called "neutron star or black hole", which is what it is).
 */
export const STAR_STAGE_SHARE: Partial<
  Record<MassCode, { base: { main: number; stage: number }; young: { main: number; small: number } }>
> = {
  d: { base: { main: 0.99, stage: 0.99 }, young: { main: 0.98, small: 0.89 } },
  e: { base: { main: 0.95, stage: 0.99 }, young: { main: 0.94, small: 0.58 } },
};

/** The class of a star this hot that is still itself (the game goes by the whole kelvin). */
export const mainSequenceClassAt = (kelvin: number): StarClass =>
  Math.floor(kelvin) < CLASS_M_FROM_KELVIN
    ? "L"
    : MAIN_SEQUENCE[CLASS_FROM_KELVIN.filter((k) => Math.floor(kelvin) >= k).length]!;

/** Whether the arrival star's class can be worked out for this mass code. */
export const starClassKnown = (code: MassCode): boolean => MASS_BAND[code] != null;

/** Which of the three ways a system's age is made: path A, a young system, an old one (rolls 1 and 2). */
export type AgePath = "a" | "young" | "old";
const agePathOf = (v: readonly number[]): AgePath => (v[1]! % 100 <= 50 ? "a" : v[2]! % 100 < 75 ? "young" : "old");

/** The length of a star's main sequence, My, by its birth mass in 1/256 solar masses. */
const mainSequenceMy = (birthMass: number): number => LENGTH_MY * (birthMass / 256) ** LENGTH_POWER;

/**
 * What a star of this birth mass (1/256 solar masses) is at this age (My, before the journal's "+ v % 256"):
 * "main" while it is itself on the main sequence. Mass codes d and e; lighter stars outlast every age the game
 * gives.
 */
export function stageAt(code: MassCode, birthMass: number, age: number): StarStage | "main" {
  const length = mainSequenceMy(birthMass);
  if (age < Math.floor(ITSELF_SHARE * length)) return "main";
  if (age < Math.floor(length)) return "small";
  const mass = birthMass / 256;
  if (age < length + GIANT_MY.reduce((t, [a, p]) => t + a * mass ** p, 0)) return "giant";
  // Mass code e: one dead star in nine is a black hole, and what makes it one is not found.
  return code === "e" ? "collapsed" : birthMass < NEUTRON_FROM_MASS ? "whiteDwarf" : "neutron";
}

/** The modulus a young system's age is rolled with, by its star's birth mass; null outside mass codes d and e. */
function youngModulus(code: MassCode, birthMass: number): number | null {
  if (code !== "d" && code !== "e") return null;
  const { first, offsets } = YOUNG_MODULUS_OFFSETS[code];
  const length = mainSequenceMy(birthMass);
  const read = offsets[birthMass - first];
  // Where it could not be read: the formula rounded (d) or rounded up (e), which is what the read ones mostly are.
  if (read == null || read === ".") return code === "d" ? Math.round(length) : Math.ceil(length);
  return Math.floor(length) + Number(read) - 2;
}

/**
 * The age of the system at `address`, My, for each base its boxel's window may have (`window`, from
 * {@link boxelAgeWindowFrom}): one age per base. A young system of mass code d or e has its age on its own dice
 * (`after`: where they stand once it is placed) and needs no window. Empty when the age cannot be told: no window,
 * or a mass code whose stars outlast every age (b, c) so that the age says nothing here.
 */
export function systemAges(address: bigint, code: MassCode, after: number, window?: AgeWindow | null): number[] {
  const band = MASS_BAND[code];
  if (!band || (code !== "d" && code !== "e") || !Number.isInteger(after) || after < 0) return [];
  const v = systemRolls(address, after + 3);
  const path = agePathOf(v);
  if (path === "young") return [v[after + 1]! % youngModulus(code, band[0] + (v[0]! % band[1]))!];
  if (!window) return [];
  // An old system's age is 1.4 times the base plus its roll, as an 11-bit fixed-point multiply.
  return window.bases.map((base) =>
    path === "a" ? base + (v[2]! % window.width) : ((base + (v[3]! % window.width)) * 2867) >> 11,
  );
}

/**
 * What one scanned system says about its boxel's age window: the higher of the two ages its journal age
 * (`journalAge`, My: Scan's Age_MY of any of its stars) can stand for (the other is 128 less), and the roll the age
 * was made with. Only a path-A system tells (its age is the base plus that roll modulo the width); null for the
 * others, and for an age the rule cannot make.
 */
export function ageReading(address: bigint, journalAge: number): { upper: number; roll: number } | null {
  if (!Number.isInteger(journalAge) || journalAge < 0 || journalAge % 2) return null;
  const v = systemRolls(address, 3);
  if (agePathOf(v) !== "a") return null;
  return { upper: Math.floor(journalAge / AGE_FOLD) * AGE_FOLD + (journalAge % AGE_FOLD) / 2, roll: v[2]! };
}

/**
 * A boxel's age window from the readings of its scanned systems ({@link ageReading}), or null when they do not
 * tell: fewer than two (one fits every width), a mass code without a stage rule, readings no width fits (a window
 * cut at 0 or at 13,200, a boxel the rule does not cover), or that more than one fits. A width fits when every
 * reading gives the same base, or two bases 128 apart: then the lower is the base, else the base is the reading or
 * 128 less, whichever the width can have.
 */
export function boxelAgeWindowFrom(
  code: MassCode,
  readings: readonly { upper: number; roll: number }[],
): AgeWindow | null {
  if (readings.length < 2) return null;
  const fits: AgeWindow[] = [];
  for (const [width, topBase] of WINDOWS[code] ?? []) {
    const bases = readings.map((r) => r.upper - (r.roll % width));
    const low = Math.min(...bases);
    const high = Math.max(...bases);
    if (bases.some((x) => x !== low && x !== high) || (high !== low && high - low !== AGE_FOLD / 2)) continue;
    const left = (high === low ? [low, low - AGE_FOLD / 2] : [low]).filter((x) => x >= 0 && x <= topBase);
    if (left.length) fits.push({ width, bases: left });
  }
  return fits.length === 1 ? fits[0]! : null;
}

export interface PredictedStar {
  /** The class the star has while it is itself. */
  cls: StarClass;
  /** Whole kelvin, while it is itself. */
  temperature: number;
  /** Birth mass, solar masses. */
  solarMasses: number;
  /**
   * How the system's age is known, when it is: "dice" (a young system's own) or "base" (the boxel's age window,
   * from scans); absent when it is not, and the star's stage with it.
   */
  aged?: "dice" | "base";
  /** With a known age: what the star is by now when it is no longer itself; absent while it is. */
  stage?: StarStage;
}

/** The star's own rolls: birth mass, the temperature before the boxel's factor, and whether its path is a calm one. */
function starDice(
  address: bigint,
  code: MassCode,
  after: number,
): { birthMass: number; temperature: number; calm: boolean } | null {
  const band = MASS_BAND[code];
  if (!band || !Number.isInteger(after) || after < 0) return null;
  const v = systemRolls(address, after + 3);
  const birthMass = band[0] + (v[0]! % band[1]);
  const base = BASE_TEMPERATURE[birthMass - BASE_TEMPERATURE_FIRST_MASS];
  if (base == null) return null;
  // A young system of mass code d and up rolls once more first (its age), and about one in ten of any mass code
  // rolls a few more (not worked out), so it makes a poorer witness.
  const young = agePathOf(v) === "young";
  const late = young && MASS_CODE_LETTERS.indexOf(code) >= 3 ? 1 : 0;
  const factor = 0.9 + (v[after + 1 + late]! % FACTOR_SPAN) / FACTOR_UNIT;
  return { birthMass, temperature: base * factor, calm: !young };
}

/**
 * The arrival star of the system at `address`. `after`: where the system's dice stand once it is placed
 * (shared/stellarPlacement.ts `predictBoxelPlacement`). `boxelFactor`: the boxel's temperature factor when a
 * scanned star has shown it. `window`: the boxel's age window, as far as scans have shown it
 * ({@link boxelAgeWindowFrom}). The stage is told when the age is known and every base left gives the same one.
 * Null for a mass code without a rule.
 */
export function predictArrivalStar(
  address: bigint,
  code: MassCode,
  after: number,
  boxelFactor = 1,
  window: AgeWindow | null = null,
): PredictedStar | null {
  const dice = starDice(address, code, after);
  if (!dice) return null;
  const temperature = Math.floor(dice.temperature * boxelFactor);
  const star: PredictedStar = { cls: mainSequenceClassAt(temperature), temperature, solarMasses: dice.birthMass / 256 };
  const stages = new Set(systemAges(address, code, after, window).map((age) => stageAt(code, dice.birthMass, age)));
  if (stages.size !== 1) return star;
  const [stage] = stages;
  return { ...star, aged: dice.calm ? "base" : "dice", ...(stage !== "main" ? { stage } : {}) };
}

/** The arrival star as the commander scanned it (journal Scan: StarType, StellarMass, SurfaceTemperature, Age_MY). */
export interface ArrivalStarScan {
  starType: string;
  stellarMass: number;
  temperature: number;
  /** The system's age, My, when the scan gave one. */
  age?: number;
}

/**
 * What a scanned arrival star says about its boxel's temperature factor: its real temperature over the predicted
 * one. Null when the star tells nothing: a mass code where the factor brings nothing, a star that is not on the
 * main sequence or no longer has the mass it was born with (dead, replaced), or a ratio outside 0.95 to 1.02 (its
 * dice were read at the wrong place).
 */
export function temperatureWitness(
  address: bigint,
  code: MassCode,
  after: number,
  scan: ArrivalStarScan,
): { ratio: number; calm: boolean } | null {
  if (STAR_CLASS_SHARE[code]?.sharpened == null) return null;
  if (!(MAIN_SEQUENCE as readonly string[]).includes(scan.starType)) return null;
  const dice = starDice(address, code, after);
  if (!dice || Math.round(scan.stellarMass * 256) !== dice.birthMass) return null;
  const ratio = scan.temperature / dice.temperature;
  return ratio >= FACTOR_MIN && ratio <= FACTOR_MAX ? { ratio, calm: dice.calm } : null;
}

/**
 * A boxel's temperature factor from its witnesses: the middle one. Stars on a calm path are asked first (inside a
 * boxel they agree to 0.07 %); young ones only when there is no other. Null with no witness.
 */
export function boxelTemperatureFactor(witnesses: readonly { ratio: number; calm: boolean }[]): number | null {
  const calm = witnesses.filter((w) => w.calm);
  const asked = (calm.length ? calm : witnesses).map((w) => w.ratio).sort((a, b) => a - b);
  if (!asked.length) return null;
  const mid = asked.length >> 1;
  return asked.length % 2 ? asked[mid]! : (asked[mid - 1]! + asked[mid]!) / 2;
}

/** A small star in another's place has 25 to 280 in 1/256 solar masses, on the roll after the placement but one. */
const SMALL_STAR_MASS = [25, 256] as const;
const DWARF_CLASSES: readonly string[] = ["K", "G", "M", "L", "T", "Y", "F", "A"];
/** The galaxy's centre (Sagittarius A*), light years from Sol. */
const CENTRE: Vec3 = [25.21875, -20.90625, 25899.96875];
/**
 * The share of arrival stars that are replaced by a small one, by the boxel's distance from Sol (up to the first
 * figure of each pair, ly), as measured on one year of EDDN scans (docs/perf/ggg-study-23112026/
 * forge_small_judge.py; the fit part and the judged quarter agree to a point). `heavy`: born with 1.44 solar
 * masses and more, mass code d; `e`: mass code e (all of it is that heavy); `light`: the rest of mass code d;
 * `c`: mass code c. The small stars every boxel has for the last twentieth of a main sequence are taken out.
 */
const REPLACED_FROM_SOL: Record<"heavy" | "e" | "light" | "c", readonly (readonly [number, number])[]> = {
  heavy: [[500, 1], [750, 0.92], [1000, 0.68], [1500, 0.5], [2000, 0.36], [3000, 0.23], [4000, 0.17], [6000, 0.1], [Infinity, 0.06]],
  e: [[750, 0.99], [1000, 0.8], [1500, 0.46], [2000, 0.18], [3000, 0.1], [6000, 0.06], [Infinity, 0.03]],
  light: [[300, 0.47], [500, 0.22], [750, 0.08], [1000, 0.03], [2000, 0.01], [Infinity, 0]],
  c: [[300, 0.15], [500, 0.02], [Infinity, 0]],
};
/** The same by the distance from the galaxy's centre, where it is more than Sol's table gives. */
const REPLACED_FROM_CENTRE: Record<"heavy" | "e", readonly (readonly [number, number])[]> = {
  heavy: [[300, 1], [600, 0.82], [1000, 0.4], [2000, 0.33], [3000, 0.2], [5000, 0.14], [Infinity, 0]],
  e: [[300, 1], [600, 0.78], [Infinity, 0]],
};

/**
 * How likely the arrival star of a system at `at` (light years; the boxel's centre will do) is replaced by a small
 * one, going by the place alone, for a star of this mass code and birth mass (1/256 solar masses). Mass code b:
 * not measured, 0.
 */
export function replacedShare(code: MassCode, birthMass: number, at: Vec3): number {
  const key = code === "e" ? "e" : code === "c" ? "c" : code === "d" ? (birthMass >= NEUTRON_FROM_MASS ? "heavy" : "light") : null;
  if (!key) return 0;
  const read = (table: readonly (readonly [number, number])[], d: number) => table.find(([upTo]) => d < upTo)![1];
  const sol = read(REPLACED_FROM_SOL[key], Math.hypot(...at));
  if (key !== "heavy" && key !== "e") return sol;
  return Math.max(sol, read(REPLACED_FROM_CENTRE[key], Math.hypot(at[0] - CENTRE[0], at[1] - CENTRE[1], at[2] - CENTRE[2])));
}

/**
 * What a scanned arrival star says about its boxel replacing stars: "kept" when it is the star the system was born
 * with (its birth mass, a class a star still itself has), "replaced" when it is the small star the dice put in its
 * place; `heavy`: the system's star was born with 1.44 solar masses and more. Null when the scan tells neither (a
 * dead star, a giant, a T Tauri star).
 */
export function replacementWitness(
  address: bigint,
  code: MassCode,
  after: number,
  scan: ArrivalStarScan,
): { heavy: boolean; replaced: boolean } | null {
  const dice = starDice(address, code, after);
  if (!dice) return null;
  const mass = Math.round(scan.stellarMass * 256);
  const heavy = dice.birthMass >= NEUTRON_FROM_MASS;
  if (mass === dice.birthMass && (scan.starType === "L" || (MAIN_SEQUENCE as readonly string[]).includes(scan.starType)))
    return { heavy, replaced: false };
  const small = SMALL_STAR_MASS[0] + (systemRolls(address, after + 2)[after + 1]! % SMALL_STAR_MASS[1]);
  return mass === small && DWARF_CLASSES.includes(scan.starType) ? { heavy, replaced: true } : null;
}

/** How often a boxel's kind read off witnesses holds for its other stars (forge_small_judge.py, quarter 1). */
const REPLACED_BY_WITNESSES = 0.97;
const REPLACED_BY_ONE_WITNESS = 0.86;
const KEPT_BY_WITNESS = 0.02;

/**
 * Whether a boxel replaces its stars, from its witnesses ({@link replacementWitness}): the share of its other heavy
 * stars, and of its other lighter ones, that are then replaced; null where the witnesses do not tell. A replaced
 * light star says the heavy ones are replaced too, a heavy star that is itself says the light ones are as well.
 */
export function boxelReplacement(witnesses: readonly { heavy: boolean; replaced: boolean }[]): {
  heavy: number | null;
  light: number | null;
} {
  const count = (heavy: boolean, replaced: boolean) =>
    witnesses.filter((w) => w.heavy === heavy && w.replaced === replaced).length;
  const share = (replaced: number, kept: number) =>
    replaced && !kept
      ? replaced >= 2
        ? REPLACED_BY_WITNESSES
        : REPLACED_BY_ONE_WITNESS
      : kept && !replaced
        ? KEPT_BY_WITNESS
        : null;
  const light = share(count(false, true), count(false, false));
  const heavy = share(count(true, true) + count(false, true), count(true, false));
  return { heavy, light: light ?? (heavy === KEPT_BY_WITNESS ? KEPT_BY_WITNESS : null) };
}
