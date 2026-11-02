/**
 * The FSS chance, corrected to how often rows like it came true (owner, 2026-11-02: "if no real results are lost,
 * implement the FSS chance correction"; study in docs/chance-recal-02112026.md).
 *
 * Pooled over all genera the shown chances were honest, but per genus they leaned in opposite directions: Bacterium
 * rows said 66 % came true 50 %, Stratum rows said 25 % came true 37 %, Tussock rows said 75 % came true 96 %. Each
 * genus with enough rows has its own monotone map of shown → real (data/exomastery/chance-recalibration.json, fitted
 * on fully identified bodies of the EDDN year, scored on the October hold-out: Brier on rows under 99.5 % 0.154 →
 * 0.145); the others share one pooled map.
 *
 * Display only, and only before a DSS (after one the question is which species of a known genus, which a per-row map
 * does not answer; the same finding as 1.2.19's dss_soften study). Rows already demoted are not touched, rows at
 * 99.5 % or more are left alone, and every corrected row stays between 1 % and 99.5 %, so which rows show is the same
 * as without it; the chance, the expected value and the order inside a genus move.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SpeciesMatch } from "../shared/types.js";

type Point = [shown: number, real: number];

interface RecalFile {
  pooled: Point[];
  genera: Record<string, Point[]>;
}

/** Rows at or above this are left as they are: the matcher is sure, and the map was not fitted there. */
const TOP_PCT = 99.5;
const MIN_PCT = 1;

let cache: { root: string; file: RecalFile | null } | null = null;

export function clearChanceRecalibrationCache(): void {
  cache = null;
}

function load(root: string): RecalFile | null {
  if (cache?.root === root) return cache.file;
  let file: RecalFile | null = null;
  try {
    const p = path.join(root, "data", "exomastery", "chance-recalibration.json");
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8")) as Partial<RecalFile>;
      if (Array.isArray(j.pooled) && j.pooled.length && j.genera) file = { pooled: j.pooled, genera: j.genera };
    }
  } catch {
    file = null;
  }
  cache = { root, file };
  return file;
}

/** The map's value at `x` (a fraction): linear between points, through 0 below the first and 1 past the last. */
function along(m: Point[], x: number): number {
  const first = m[0]!;
  const last = m[m.length - 1]!;
  if (x <= first[0]) return first[0] > 0 ? (first[1] * x) / first[0] : first[1];
  if (x >= last[0]) return last[1] + ((x - last[0]) * (1 - last[1])) / Math.max(1e-9, 1 - last[0]);
  for (let i = 1; i < m.length; i++) {
    const [x0, y0] = m[i - 1]!;
    const [x1, y1] = m[i]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / Math.max(1e-9, x1 - x0);
  }
  return last[1];
}

/** The corrected FSS chance of a row of `genus` shown at `pct`, or `pct` itself when there is nothing to correct. */
export function recalibratedChance(root: string, genus: string, pct: number): number {
  if (!Number.isFinite(pct) || pct >= TOP_PCT) return pct;
  const file = load(root);
  if (!file) return pct;
  const m = file.genera[genus.trim().toLowerCase()] ?? file.pooled;
  const v = along(m, pct / 100) * 100;
  return Math.round(Math.min(TOP_PCT, Math.max(MIN_PCT, v)) * 10) / 10;
}

/** Corrects the shown rows' chances before a DSS; the chance before is kept on the row for its "why this chance". */
export function recalibrateFssChances(matches: SpeciesMatch[], afterDss: boolean, root: string): void {
  if (afterDss) return;
  for (const m of matches) {
    const p = m.presenceProbabilityPercent;
    if (m.unlikely || typeof p !== "number" || !Number.isFinite(p) || p >= TOP_PCT) continue;
    const v = recalibratedChance(root, m.entry.genus, p);
    if (v === p) continue;
    m.chanceBeforeRecal = p;
    m.presenceProbabilityPercent = v;
  }
}
