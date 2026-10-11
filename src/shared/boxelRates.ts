/**
 * What boxels of each mass code hold, measured on the Spansh galaxy dump (read 2026-10-05:
 * 199,683,686 systems, 199,532,223 with a procedural name; docs/perf/boxel_study.py and
 * boxel_rates_ts.py, which writes data/boxel/boxel-rates.json; plan 2.1, 2026-10-11: data, not code). Per mass code: `n` systems with at least one body known to Spansh and, of those,
 * how many hold each target (`star:X` = a star of that class anywhere in the system, `main:X` = the
 * main star), for every
 * boxel (`all`) and for AA-A boxels only (`aaA`); and the Helium-rich gas giants found (bodies, not
 * systems). Commanders fly interesting systems first, so rare things are somewhat inflated wherever
 * people go; the ranking between mass codes is what this is for.
 */
import rates from "../../data/boxel/boxel-rates.json";

export interface BoxelRateCounts {
  n: number;
  hits: Record<string, number>;
}

export interface BoxelMassCodeRates {
  all: BoxelRateCounts;
  aaA: BoxelRateCounts;
  heliumRichBodies: number;
}

/** Read from `data/boxel/boxel-rates.json`; both bundlers inline it, so the table is there at import as before. */
export const BOXEL_RATES: Readonly<Record<string, BoxelMassCodeRates>> = rates;
