/**
 * Places a species never grows although its usual rate says it should (plan-15102026-1.2.18 Part 3b).
 *
 * Each rule came out of the app's own wrong rows on two EDDN hold-outs and was kept only when no confirmed body of
 * the species falls inside it anywhere we have data: the EDDN year (342k bodies, each species logged on the exact
 * body), hold-outs A, B and D, and the commander's journals — and when its usual rate would put at least ten bodies
 * there (Aleoida spica under 167.7 K: 611 expected, none found). Frutexa acus under a K parent star in a K-primary
 * system, Tubus in the Temple region, Concha aureolas on a wide orbit, … The table is
 * `data/exomastery/measured-exclusions.json`, built by `docs/perf/build_measured_exclusions.py`.
 *
 * A match demotes the row to the unlikely tier with the reason; nothing is removed. A value the body does not have
 * (no detailed scan, no star scanned) never matches.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./paths.js";

/** The body values a rule can test, in the units the table uses. */
export interface ExclusionValues {
  temp?: number;
  mass?: number;
  /** Kind of the journal `Parents[0]` entry: Star, Null (a barycentre) or Planet. */
  parent?: string;
  sma_ls?: number;
  orb_d?: number;
  dist_ls?: number;
  grav_g?: number;
  c_metal?: number;
  /** Parent star class, `hostStarClassKey`. */
  host?: string;
  /** System main star class, `hostStarClassKey`. */
  main?: string;
  region?: string;
}

interface Condition {
  value: keyof ExclusionValues;
  op: "=" | "<=" | ">=";
  is: string | number;
}

export interface MeasuredExclusion {
  when: Condition[];
  speciesBodies: number;
  expected: number;
}

let cache: { root: string; bySpecies: Map<string, MeasuredExclusion[]> } | null = null;
let rootOverride: string | null = null;

export function setMeasuredExclusionsRootForTests(root: string | null): void {
  rootOverride = root;
  cache = null;
}

export function clearMeasuredExclusionsCache(): void {
  cache = null;
}

function load(root: string): Map<string, MeasuredExclusion[]> {
  const bySpecies = new Map<string, MeasuredExclusion[]>();
  try {
    const p = path.join(root, "data", "exomastery", "measured-exclusions.json");
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8")) as { species?: Record<string, MeasuredExclusion[]> };
      for (const [id, rules] of Object.entries(j.species ?? {})) {
        const ok = rules.filter((r) => Array.isArray(r.when) && r.when.length > 0);
        if (ok.length) bySpecies.set(id, ok);
      }
    }
  } catch {
    /* no table: nothing is excluded */
  }
  return bySpecies;
}

function holds(c: Condition, v: ExclusionValues): boolean {
  const have = v[c.value];
  if (have === undefined || have === null) return false;
  if (c.op === "=") return typeof have === "string" && have === c.is;
  if (typeof have !== "number" || !Number.isFinite(have) || typeof c.is !== "number") return false;
  return c.op === "<=" ? have <= c.is : have >= c.is;
}

/** The first rule of this species the body falls inside, or null. */
export function measuredExclusion(
  speciesId: string,
  values: ExclusionValues,
  root?: string,
): MeasuredExclusion | null {
  const r = root ?? rootOverride ?? getProjectRoot();
  if (cache?.root !== r) cache = { root: r, bySpecies: load(r) };
  for (const rule of cache.bySpecies.get(speciesId) ?? []) {
    if (rule.when.every((c) => holds(c, values))) return rule;
  }
  return null;
}

const LABEL: Record<keyof ExclusionValues, string> = {
  temp: "temperature",
  mass: "mass",
  parent: "orbiting",
  sma_ls: "orbit",
  orb_d: "orbital period",
  dist_ls: "distance from arrival",
  grav_g: "gravity",
  c_metal: "metal content",
  host: "parent star",
  main: "main star",
  region: "region",
};

const UNIT: Partial<Record<keyof ExclusionValues, string>> = {
  temp: " K",
  mass: " Earth masses",
  sma_ls: " ls",
  orb_d: " days",
  dist_ls: " ls",
  grav_g: " g",
};

/** "parent star K and main star K" — the rule in words, for the reason line. */
export function describeExclusion(rule: MeasuredExclusion): string {
  return rule.when
    .map((c) => {
      if (c.value === "parent") {
        const kind = c.is === "Null" ? "a barycentre" : c.is === "Star" ? "a star" : "a planet";
        return `orbiting ${kind}`;
      }
      if (c.op === "=") return `${LABEL[c.value]} ${c.is}`;
      const n = typeof c.is === "number" ? Number(c.is.toPrecision(4)) : c.is;
      const shown = c.value === "c_metal" && typeof n === "number" ? `${Math.round(n * 100)} %` : `${n}${UNIT[c.value] ?? ""}`;
      return `${LABEL[c.value]} ${c.op === "<=" ? "≤" : "≥"} ${shown}`;
    })
    .join(" and ");
}
