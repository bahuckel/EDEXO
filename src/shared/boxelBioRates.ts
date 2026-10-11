/**
 * Exobiology by boxel, from EDAstro's codex file (codex-data.csv: 4,909,402 logged entries,
 * 1,804,395 systems with biology; docs/perf/boxel_species_study.py, boxel_golden.py and
 * boxel_bio_rates_ts.py, 2026-10-05). Per mass code (`all`) and AA-A boxels only (`aaA`): `n`
 * systems with a biology entry logged, and how many of them hold each genus (`g:`) and species
 * (`sp:`). The share is of systems someone logged biology in, not of every system.
 *
 * `BOXEL_BIO_GOLDEN`: exact boxel positions (= letter combinations) where a genus or species is far
 * more common than in the rest of its mass code — clearing a Bonferroni threshold over 101,285 tests
 * and holding in both halves of the galaxy. [target, mass code, position, systems, hits, rest's share,
 * confirmed: 1 when the Spansh bio export finds the genus golden at the same position too]. The Bark
 * Mound and Electricae ones are where procedural nebulae sit: d boxels 200-300 ly from the sector's
 * origin corner have a nebula within 100 ly 14x as often as other d boxels.
 */
import type { BoxelMassCodeRates } from "./boxelRates.js";
import bio from "../../data/boxel/boxel-bio-rates.json";

export type BoxelBioRates = Pick<BoxelMassCodeRates, "all" | "aaA">;

type GoldenRow = readonly [string, string, number, number, number, number, 0 | 1];

/** Both tables from `data/boxel/boxel-bio-rates.json` (plan 2.1, 2026-10-11), written by boxel_bio_rates_ts.py. */
export const BOXEL_BIO_RATES: Readonly<Record<string, BoxelBioRates>> = bio.rates;

// JSON reads a tuple back as a plain array; the generator writes exactly these seven fields.
export const BOXEL_BIO_GOLDEN: readonly GoldenRow[] = bio.golden as unknown as readonly GoldenRow[];
