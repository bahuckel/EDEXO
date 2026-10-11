/**
 * Why this chance: the facts behind a candidate row's number, for the [?] beside it (plan 1.7,
 * 2026-10-11).
 *
 * The number comes from a chain (the ranking model, the genus prior, the measured odds, the fitted
 * which-of-the-genus tables for seven genera), and a raw term of it — a log-probability — means
 * nothing to a reader. What does: how often this genus grows on bodies like this one, how this species
 * compares with the others of its genus on this body field by field, a measured rate where one applies,
 * and how often it has been logged in the region. Each line carries the nudge it gives where there is
 * one (log-odds, + for and − against).
 *
 * Read only, after the ranking: nothing here changes a number. Body tab only (snapshot.ts), so the
 * backlog and the system map pay nothing for it.
 */
import type { BodyExoState, ExplorationScanRecord, PlanetScan, SpeciesMatch } from "../shared/types.js";
import type { CandidateInputs } from "./candidatePipeline.js";
import { genusPriorBaseline, genusPriorFor, genusPriorKey } from "./genusPrior.js";
import { measuredOddsNote } from "./measuredOdds.js";
import { regionalSpeciesCount } from "./regionSpeciesData.js";
import { speciesLogScore, TERM_DAMPING } from "./speciesLikelihood.js";
import { valueForNumericPath, valueForCategoricalPath } from "./exomasteryBodyValues.js";
import { splitColumnLabel, splitContributions, splitFacts, type SplitInputs } from "./speciesSplit.js";

export type ChanceWhyLine = { label: string; weight: number | null; kind: "genus" | "field" | "measured" | "region" };

/** Smallest nudge worth a line: a fifth of a log-odds unit, about ×1.2. */
const MIN_NUDGE = 0.2;
const MAX_FIELD_LINES = 3;

/** The model's fields a reader can act on; orbital angles and bookkeeping are scored but say nothing. */
const FIELD_WORDS: [RegExp, string, string, number][] = [
  [/surfacetemperature/i, "temperature", "K", 0],
  [/\.gravity$/i, "gravity", "g", 2],
  [/surfacepressure/i, "pressure", "atm", 4],
  [/distancetoarrival/i, "distance from arrival", "Ls", 0],
  [/earthmasses/i, "mass", "EM", 3],
  [/\.radius$/i, "radius", "km", 0],
  [/semimajoraxis/i, "orbit", "AU", 3],
  [/orbitalperiod/i, "orbital period", "d", 1],
  [/orbitaleccentricity/i, "eccentricity", "", 3],
  [/orbitalinclination/i, "inclination", "°", 1],
  [/rotationalperiod$/i, "rotation", "d", 1],
  [/solidcomposition\.(\w+)/i, "$1 in the crust", "%", 1],
  [/materials\.(\w+)/i, "$1", "%", 2],
];
const CAT_WORDS: [RegExp, string][] = [
  [/body\.subtype/i, "planet class"],
  [/volcanismtype/i, "volcanism"],
  [/atmospheretype/i, "atmosphere"],
  [/terraformingstate/i, "terraforming"],
  [/tidallylocked/i, "tidal lock"],
  [/host_star_spectral_primary/i, "host star"],
  [/system_primary_spectral/i, "main star"],
];

function fieldLabel(path: string, scan: PlanetScan, rec: ExplorationScanRecord | null): string | null {
  if (path === "body.atmosphereComposition") return "the gases in the air";
  for (const [re, words, unit, digits] of FIELD_WORDS) {
    const m = re.exec(path);
    if (!m) continue;
    const name = words.replace("$1", (m[1] ?? "").toLowerCase());
    const v = valueForNumericPath(path, scan, rec);
    return v == null ? name : `${name} ${v.toFixed(digits)}${unit ? (unit === "°" ? unit : ` ${unit}`) : ""}`;
  }
  for (const [re, words] of CAT_WORDS) {
    if (!re.test(path)) continue;
    const v = valueForCategoricalPath(path, scan, rec);
    return v ? `${words}: ${v}` : words;
  }
  return null;
}

/** One genus's cell of the genus prior, as words: "HMC · 1 signal · carbon dioxide · 180–199 K · K star". */
function cellWords(cell: string): string {
  const [level, type, n, atmo, temp, star, volc] = cell.split("|");
  const parts: string[] = [];
  if (level === "L5") return `bodies with ${type} signal${type === "1" ? "" : "s"}`;
  if (type) parts.push(type === "hmc" ? "HMC" : type);
  if (n) parts.push(`${n} signal${n === "1" ? "" : "s"}`);
  if (atmo) parts.push(atmo === "none" ? "no atmosphere" : atmo);
  if (temp && temp !== "?") parts.push(`${Number(temp) * 20}–${Number(temp) * 20 + 19} K`);
  if (star && star !== "?") parts.push(`${star} star`);
  if (volc) parts.push(volc === "none" ? "no volcanism" : volc);
  return parts.join(" · ");
}

/**
 * Within the genus: each shown row's fields against the mean of the genus's shown rows on this body,
 * strongest first. From the fitted table for a split genus, else from the ranking model's own terms
 * (damped as the model damps them, so the nudges are on the scale of the chance).
 */
function withinGenus(
  rows: SpeciesMatch[],
  genus: string,
  inputs: CandidateInputs & { scan: PlanetScan },
  splitIn: SplitInputs | null,
  root: string,
): Map<string, ChanceWhyLine[]> {
  const out = new Map<string, ChanceWhyLine[]>();
  if (rows.length < 2) return out;
  let per: Map<string, Map<string, number>> | null = null;
  let label: (key: string) => string | null;
  if (splitIn) {
    const contrib = splitContributions(root, genus, splitFacts(splitIn));
    if (contrib) {
      per = new Map(rows.map((m) => [m.entry.id, contrib.get(m.entry.id) ?? new Map()]));
      label = (col) => splitColumnLabel(root, col);
    }
  }
  if (!per) {
    per = new Map();
    for (const m of rows) {
      const terms = new Map<string, number>();
      speciesLogScore(m.entry, inputs.scan, inputs.rec, inputs.journalHost, {
        root,
        onTerm: (path, lp) => terms.set(path, (terms.get(path) ?? 0) + TERM_DAMPING * lp),
      });
      per.set(m.entry.id, terms);
    }
    label = (path) => fieldLabel(path, inputs.scan, inputs.rec);
  }
  const keys = new Set<string>();
  for (const t of per.values()) for (const k of t.keys()) keys.add(k);
  for (const m of rows) {
    const mine = per.get(m.entry.id)!;
    const lines: ChanceWhyLine[] = [];
    for (const k of keys) {
      let sum = 0;
      for (const t of per.values()) sum += t.get(k) ?? 0;
      const nudge = (mine.get(k) ?? 0) - sum / per.size;
      if (Math.abs(nudge) < MIN_NUDGE) continue;
      const words = label!(k);
      if (!words) continue;
      lines.push({ label: words, weight: Math.round(nudge * 10) / 10, kind: "field" });
    }
    lines.sort((a, b) => Math.abs(b.weight!) - Math.abs(a.weight!));
    out.set(m.entry.id, lines.slice(0, MAX_FIELD_LINES));
  }
  return out;
}

export function explainChances(
  matches: SpeciesMatch[],
  b: BodyExoState,
  inputs: CandidateInputs,
  root: string,
  opts: { splitGenera: ReadonlySet<string>; splitInputs: SplitInputs | null },
): void {
  const scan = inputs.scan;
  if (!scan) return;
  const withScan = inputs as CandidateInputs & { scan: PlanetScan };
  const shown = matches.filter((m) => !m.unlikely || m.sampledHere);
  const byGenus = new Map<string, SpeciesMatch[]>();
  for (const m of shown) byGenus.set(m.entry.genus, [...(byGenus.get(m.entry.genus) ?? []), m]);

  // Before a DSS: how often the genus grows on bodies like this one, against any body with this count.
  const signals = b.biologicalSignals;
  const prior =
    !b.genusHints?.length && signals != null && signals >= 1 ? genusPriorFor(root, scan, signals, inputs.ctx.parentStarType) : null;
  const base = prior && signals != null ? genusPriorBaseline(root, signals) : null;

  for (const [genus, rows] of byGenus) {
    const split = opts.splitGenera.has(genus) ? opts.splitInputs : null;
    const fields = withinGenus(rows, genus, withScan, split, root);
    for (const m of rows) {
      const lines: ChanceWhyLine[] = [];
      if (prior) {
        const k = genusPriorKey(genus);
        const p = prior.p[k] ?? 0;
        const p0 = base?.[k];
        const nudge = p0 && p0 > 0 && p > 0 ? Math.round(Math.log(p / p0) * 10) / 10 : null;
        lines.push({
          label: `${genus} is on ${(p * 100).toFixed(p < 0.1 ? 1 : 0)} % of ${prior.n.toLocaleString("en-US")} bodies like this (${cellWords(prior.cell)}; Spansh dump)`,
          weight: nudge,
          kind: "genus",
        });
      }
      const measured = measuredOddsNote(m, scan);
      if (measured) lines.push({ label: measured, weight: null, kind: "measured" });
      lines.push(...(fields.get(m.entry.id) ?? []));
      const regional = regionalSpeciesCount(root, inputs.ctx.regionIndex, m.entry.id);
      if (regional != null && inputs.ctx.regionName) {
        lines.push({
          label: `logged in ${regional.toLocaleString("en-US")} system${regional === 1 ? "" : "s"} of ${inputs.ctx.regionName} (EDAstro codex)`,
          weight: null,
          kind: "region",
        });
      }
      if (lines.length) m.chanceWhy = lines;
    }
  }
}
