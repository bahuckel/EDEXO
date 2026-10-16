/**
 * Colour-star classes a species is never confirmed under (plan-15102026-1.2.18 Part 1, owner 2026-10-15).
 *
 * The star that matters is the one the game colours a plant after: the brightest in the body's sky
 * ({@link colourStarTypeFor}), the star the host-star gates already read. Measured on the EDDN year, where each species
 * is logged on the exact body (`docs/perf/build_colour_star_never.py`): a class is listed only when none of the
 * species' bodies has that colour star although its usual rate in its own planet-class / atmosphere zone expects at
 * least 20 there. Before it was switched on (`docs/vectors-results-15102026.md`): hold-outs A / B wrong rows −8 %,
 * D −4 %, the owner's journals unchanged, no miss anywhere. The parent-star reading missed Stratum araneamus (which
 * follows the main star) and the main-star reading Anemone blatteum — the colour star missed neither.
 *
 * Why a table of its own: the "never seen under this host star" verdict ({@link hostStarVerdict}) asks the parent star
 * and lets any Spansh / codex observation overrule it, and a few mis-attributed ones (0.01-0.6 % of a species' bodies)
 * kept it from ever firing on these pairs.
 *
 * Not judged: species under 200 EDDN-year bodies, and Anemone and Amphora, whose star rules the app already reads off
 * another star (Anemone colours: the main star's class and luminosity; Amphora: an A or B star anywhere in the
 * system) — the first table demoted an Anemone croceum the spawn suite confirms.
 *
 * A listed class demotes the row into the unlikely tier, never removes it — as every gate.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { colourStarClassKey } from "../shared/hostStarClass.js";
import { getProjectRoot } from "./paths.js";

export interface ColourStarNever {
  /** The colour star's class key, e.g. "G". */
  cls: string;
  /** Bodies the species' usual rate would have put under this class. */
  expected: number;
  /** The species' EDDN-year bodies. */
  speciesBodies: number;
}

let cache: {
  root: string;
  bySpecies: Map<string, Map<string, { expected: number; speciesBodies: number }>>;
} | null = null;
let rootOverride: string | null = null;

export function setColourStarNeverRootForTests(root: string | null): void {
  rootOverride = root;
  cache = null;
}

export function clearColourStarNeverCache(): void {
  cache = null;
}

function table(root: string) {
  if (cache?.root === root) return cache.bySpecies;
  const bySpecies = new Map<string, Map<string, { expected: number; speciesBodies: number }>>();
  try {
    const p = path.join(root, "data", "exomastery", "colour-star-never.json");
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8")) as {
        species?: Record<string, Record<string, { expected?: number; speciesBodies?: number }>>;
      };
      for (const [id, classes] of Object.entries(j.species ?? {})) {
        const m = new Map<string, { expected: number; speciesBodies: number }>();
        for (const [cls, v] of Object.entries(classes)) {
          if (typeof v?.expected === "number" && typeof v.speciesBodies === "number") {
            m.set(cls, { expected: v.expected, speciesBodies: v.speciesBodies });
          }
        }
        if (m.size) bySpecies.set(id, m);
      }
    }
  } catch {
    /* no table: no verdict */
  }
  cache = { root, bySpecies };
  return bySpecies;
}

/** The never verdict for a species under a colour star, or null (not listed, unknown star, no table). */
export function colourStarNever(
  speciesId: string,
  colourStarType: string | null | undefined,
  root?: string,
): ColourStarNever | null {
  const cls = colourStarClassKey(colourStarType);
  if (!cls) return null;
  const hit = table(root ?? rootOverride ?? getProjectRoot())
    .get(speciesId)
    ?.get(cls);
  return hit ? { cls, ...hit } : null;
}
