/**
 * The chance an unvisited system holds biology, by the path its age takes and its arrival star's birth mass (owner
 * 2026-11-28: "check if we can use this in Exobio prediction"; docs/plan-24112026-star-predictor.md §8.5 step 1,
 * measured in docs/boxel-star-placement-23112026.md §3n and §3s).
 *
 * A system's own dice (shared/stellarPlacement.ts `systemRolls`) say how its age is made (shared/stellarClass.ts
 * `agePathOf`): roll 1 % 100 up to 50 is path A (the age from the boxel's window), else roll 2 % 100 under 75 is a
 * young system and 75 and up an old one; and roll 0 gives the arrival star's birth mass (stellarClass `MASS_BAND`).
 * Both go with how much biology the system holds, beyond what its main star's class says: in mass code e a young
 * system holds a body with biology 2.4 times as often as a path-A one; in d an old system whose star was born heavy
 * (a neutron star by now, most of them) 4.2 %, a young one born light 8.4 %. Mass code a reads its dice one roll
 * later (its placement, and its arrival star's mass, do too); its birth-mass rule is not settled, so a goes by path
 * alone.
 *
 * The shares: Spansh's galaxy dump, 166,175 to 272,777 systems with bodies per mass code, the share with a body that
 * carries biological signals; birth mass in thirds of each mass code's systems. Not measured for f to h.
 */
import type { MassCode } from "./boxelAdvice.js";
import { systemRolls } from "./stellarPlacement.js";

export type AgePathName = "A" | "young" | "old";
export type BirthMassThird = "light" | "middle" | "heavy";

type Row = readonly [light: number, middle: number, heavy: number];

interface Shares {
  /** Every system of the mass code, whatever its path and star. */
  all: number;
  /** Birth mass band (1/256 solar masses: first value, how many) and the two edges between the thirds. */
  band?: readonly [number, number];
  edges?: readonly [number, number];
  A: Row;
  young: Row;
  old: Row;
}

/** By path, then by the third of birth mass (a: one share per path, the same in all three). */
const SHARE: Partial<Record<MassCode, Shares>> = {
  a: { all: 0.0527, A: [0.0491, 0.0491, 0.0491], young: [0.0617, 0.0617, 0.0617], old: [0.0404, 0.0404, 0.0404] },
  b: {
    all: 0.0621,
    band: [51, 64],
    edges: [72, 93],
    A: [0.0573, 0.0633, 0.064],
    young: [0.062, 0.0667, 0.0657],
    old: [0.0526, 0.0555, 0.0606],
  },
  c: {
    all: 0.0724,
    band: [115, 115],
    edges: [156, 195],
    A: [0.0667, 0.0739, 0.0775],
    young: [0.0715, 0.0728, 0.0738],
    old: [0.0647, 0.0752, 0.0713],
  },
  d: {
    all: 0.068,
    band: [230, 230],
    edges: [317, 398],
    A: [0.0804, 0.0698, 0.0547],
    young: [0.0836, 0.0728, 0.0613],
    old: [0.0746, 0.0684, 0.0419],
  },
  e: {
    all: 0.0325,
    band: [460, 1100],
    edges: [875, 1257],
    A: [0.0179, 0.0218, 0.0253],
    young: [0.0594, 0.0552, 0.0345],
    old: [0.0307, 0.028, 0.0385],
  },
};

export interface BioOdds {
  /** Share of such systems with a body that carries biology. */
  chance: number;
  path: AgePathName;
  /** The arrival star's birth mass, in thirds of its mass code (absent for mass code a). */
  third?: BirthMassThird;
  /** The same share for every system of the mass code. */
  average: number;
}

/** The path a system's age takes, from its address. */
export function agePathName(code: MassCode, address: bigint): AgePathName {
  const v = systemRolls(address, 4);
  const at = code === "a" ? 1 : 0;
  return v[1 + at]! % 100 <= 50 ? "A" : v[2 + at]! % 100 < 75 ? "young" : "old";
}

/** The chance a system holds biology, by its path and its star's birth mass; null for f to h (not measured). */
export function bioOddsOf(code: MassCode, address: bigint): BioOdds | null {
  const s = SHARE[code];
  if (!s) return null;
  const path = agePathName(code, address);
  if (!s.band || !s.edges) return { chance: s[path][0], path, average: s.all };
  const mass = s.band[0] + (systemRolls(address, 1)[0]! % s.band[1]);
  const at = mass < s.edges[0] ? 0 : mass < s.edges[1] ? 1 : 2;
  const third: BirthMassThird = (["light", "middle", "heavy"] as const)[at];
  return { chance: s[path][at], path, third, average: s.all };
}
