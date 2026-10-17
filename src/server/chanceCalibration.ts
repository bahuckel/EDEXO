/**
 * How often "Chance here" came true, for the "why this chance" popover (plan-17102026-1.2.19 F3, owner 2026-10-17).
 *
 * Measured on the EDDN year's two held-back samples with 1.2.19's prediction code
 * (`docs/perf/calibration/build_chance_calibration.py`): complete bodies, signal count known, each listed row counted
 * as true when the species was logged on that body. Before a DSS and after one are kept apart — after a DSS the
 * middle bands read high (rows said 65-80 % came true 56 % on 1.2.19), and the line says so rather than hiding it.
 *
 * Per genus where its band holds at least `minRows` rows, else all genera together. Read-only; no chance is changed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Cell = [rows: number, cameTrue: number, saidMean: number | null];

interface CalibrationFile {
  bands: number[];
  minRows: number;
  fss: Record<string, Cell[]>;
  dss: Record<string, Cell[]>;
}

let cache: { root: string; file: CalibrationFile | null } | null = null;

export function clearChanceCalibrationCache(): void {
  cache = null;
}

function load(root: string): CalibrationFile | null {
  if (cache?.root === root) return cache.file;
  let file: CalibrationFile | null = null;
  try {
    const p = path.join(root, "data", "exomastery", "chance-calibration.json");
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8")) as Partial<CalibrationFile>;
      if (Array.isArray(j.bands) && j.fss && j.dss) file = { bands: j.bands, minRows: j.minRows ?? 30, fss: j.fss, dss: j.dss };
    }
  } catch {
    file = null;
  }
  cache = { root, file };
  return file;
}

/** The band a chance falls in: index into `bands` (the last band includes 100). */
function bandIndex(bands: number[], pct: number): number {
  for (let i = 0; i < bands.length - 1; i++) if (pct >= bands[i]! && pct < bands[i + 1]!) return i;
  return bands.length - 2;
}

/**
 * The calibration line for one row, or null (no table, no chance, too few rows even across all genera).
 * `afterDss`: the body's genera are known from a DSS.
 */
export function calibrationLine(root: string, genus: string, pct: number | null | undefined, afterDss: boolean): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const file = load(root);
  if (!file) return null;
  const tab = afterDss ? file.dss : file.fss;
  const i = bandIndex(file.bands, pct);
  const own = tab[genus.trim().toLowerCase()]?.[i];
  const all = tab["*"]?.[i];
  const pick = own && own[0] >= file.minRows ? { cell: own, whose: `${genus} rows` } : all && all[0] >= file.minRows ? { cell: all, whose: "rows of all genera" } : null;
  if (!pick) return null;
  const [n, y] = pick.cell;
  const lo = file.bands[i]!;
  const hi = Math.min(100, file.bands[i + 1]!);
  const real = Math.round((100 * y) / n);
  return `rows said ${lo}-${hi} % ${afterDss ? "after a DSS " : ""}came true ${real} % of the time (${n.toLocaleString("en-US")} ${pick.whose}, EDDN year)`;
}
