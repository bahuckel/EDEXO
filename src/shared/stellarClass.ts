/**
 * The class of a generated system's arrival star, worked out from the system's address, so a system nobody has
 * visited can say what star to expect (owner, 2026-11-24: "Build step E"; docs/plan-24112026-star-predictor.md,
 * docs/boxel-star-placement-23112026.md §3g and §3i).
 *
 * The star is rolled on the system's own dice (shared/stellarPlacement.ts). The first roll is its birth mass, in
 * 1/256 of a solar mass, inside the band of its mass code. Once the system is placed, the next roll but one scales
 * the temperature that goes with that mass by 0.9 to 1.1 (a young system of mass code d and up rolls once more
 * first), and the class is the whole temperature against fixed limits. The temperature per birth mass is measured
 * (shared/stellarBaseTemperature.ts); nothing else is fitted.
 *
 * What it does not know:
 * - Whether the star is still what it was born as. Old and heavy stars are neutron stars, white dwarfs or black
 *   holes by now, a few systems hold a T Tauri star or a small star instead, and that goes by the system's age,
 *   which the address alone does not give. The class is the one the star has if it is still on the main sequence;
 *   {@link STAR_CLASS_SHARE} says how often it is.
 * - The boxel's own temperature factor. Every star of one boxel is off by the same few parts in a thousand to two
 *   in a hundred (a quarter of the boxels far from the galaxy's centre sit 1 to 2.3 % low), which moves a star near
 *   a limit into the next class. One scanned arrival star of the boxel shows the factor
 *   ({@link temperatureWitness}, {@link boxelTemperatureFactor}); mass code d misses 95 % without it.
 *
 * Mass codes b to e. a has no mass rule yet, f and g too few stars for a temperature table, h is not placed.
 * Measured on stars the table was not taken from (another quarter of the EDDN year, Spansh systems outside it, the
 * owner's journals, his collector's export): docs/perf/ggg-study-23112026/forge_judge.py.
 */
import { MASS_CODE_LETTERS, type MassCode } from "./boxelAdvice.js";
import { BASE_TEMPERATURE, BASE_TEMPERATURE_FIRST_MASS } from "./stellarBaseTemperature.js";
import { systemRolls } from "./stellarPlacement.js";

/** Main-sequence classes, coolest first, and the whole kelvin each of the hotter ones starts at. */
export const MAIN_SEQUENCE = ["M", "K", "G", "F", "A", "B", "O"] as const;
export type MainSequenceClass = (typeof MAIN_SEQUENCE)[number];
const CLASS_FROM_KELVIN = [3700, 5200, 6000, 7500, 10000, 33000] as const;

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

/**
 * As measured on unfitted stars, per mass code. `alive`: arrival stars still on the main sequence with their birth
 * mass (Spansh, 380,000 systems per code; the rest are dead stars, T Tauri stars, brown dwarfs, giants).
 * `right`: of those, the share whose class the address gives, 22,000 ly and more from the galaxy's centre (the
 * lower of the EDDN and Spansh figures). `sharpened`: the same with the boxel's factor read off one scanned star
 * (the lower of the two again); null where the factor brings nothing (e: the class is right either way).
 */
export const STAR_CLASS_SHARE: Partial<Record<MassCode, { alive: number; right: number; sharpened: number | null }>> =
  {
    b: { alive: 0.97, right: 0.996, sharpened: 0.998 },
    c: { alive: 0.99, right: 0.964, sharpened: 0.985 },
    d: { alive: 0.8, right: 0.94, sharpened: 0.978 },
    e: { alive: 0.6, right: 0.993, sharpened: null },
  };
/** Under this share a class is shown as likely, not as predicted (owner, 2026-11-24: the plan's 95 %). */
export const STAR_CLASS_SURE = 0.95;

/** The main-sequence class of a star this hot (the game goes by the whole kelvin). */
export const mainSequenceClassAt = (kelvin: number): MainSequenceClass =>
  MAIN_SEQUENCE[CLASS_FROM_KELVIN.filter((k) => Math.floor(kelvin) >= k).length]!;

/** Whether the arrival star's class can be worked out for this mass code. */
export const starClassKnown = (code: MassCode): boolean => MASS_BAND[code] != null;

export interface PredictedStar {
  cls: MainSequenceClass;
  /** Whole kelvin. */
  temperature: number;
  /** Birth mass, solar masses. */
  solarMasses: number;
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
  // Path B (roll 1 over 50), young (roll 2 under 75): such a system of mass code d and up rolls once more first,
  // and about one in ten of any mass code rolls a few more (not worked out), so it makes a poorer witness.
  const young = v[1]! % 100 > 50 && v[2]! % 100 < 75;
  const late = young && MASS_CODE_LETTERS.indexOf(code) >= 3 ? 1 : 0;
  const factor = 0.9 + (v[after + 1 + late]! % FACTOR_SPAN) / FACTOR_UNIT;
  return { birthMass, temperature: base * factor, calm: !young };
}

/**
 * The arrival star of the system at `address`, if it is still on the main sequence. `after`: where the system's
 * dice stand once it is placed (shared/stellarPlacement.ts `predictBoxelPlacement`). `boxelFactor`: the boxel's
 * temperature factor when a scanned star has shown it. Null for a mass code without a rule.
 */
export function predictArrivalStar(
  address: bigint,
  code: MassCode,
  after: number,
  boxelFactor = 1,
): PredictedStar | null {
  const dice = starDice(address, code, after);
  if (!dice) return null;
  const temperature = Math.floor(dice.temperature * boxelFactor);
  return { cls: mainSequenceClassAt(temperature), temperature, solarMasses: dice.birthMass / 256 };
}

/** The arrival star as the commander scanned it (journal Scan: StarType, StellarMass, SurfaceTemperature). */
export interface ArrivalStarScan {
  starType: string;
  stellarMass: number;
  temperature: number;
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
