import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { BoxelStarCheckDTO, PredictedStarDTO } from "../shared/boxel.js";
import type { ArrivalStarScan } from "../shared/stellarClass.js";
import { resolveBoxelStarMissLogPath } from "./paths.js";

/**
 * Arrival stars the Boxels screen's self-check got wrong (server/boxelStars.ts `boxelStarCheck`; plan §6j: "a log
 * file of the misses").
 *
 * The check is recomputed every time the table is drawn and shows at most five misses per boxel; this keeps every one
 * it has ever found, with the scan that disproved it, so the star rules can be measured against his own flights
 * later (the Herbig stars of mass code e were found that way). Append-only JSONL beside the user settings, like the
 * outlier log; nothing here changes what the app shows.
 */
export interface BoxelStarMissRecord {
  /** ISO timestamp of the moment the miss was first noticed. */
  at: string;
  /** `Phraa Blao ED-Q d6` (the saved boxel's prefix without its closing dash). */
  boxel: string;
  n: number;
  /** `Phraa Blao ED-Q d6-162` */
  system: string;
  predicted: PredictedStarDTO;
  /** `BoxelStarCheckDTO.real`: the class while the star is itself, else what it is ("neutron", "herbig", …). */
  real: string;
  /** The scan that disproved it, so the record stands alone without the journal. */
  scan: { starType: string; stellarMass: number; temperature: number; age: number | null } | null;
  /** How many of his arrival-star scans in the boxel the prediction stood on (the one disproved left out). */
  evidence: number;
}

/** Keys already written, seeded from the file once per run: the table is recomputed far more often than it misses. */
let seen: Set<string> | null = null;

/** The same system, the same answer and the same scan → one record, however often the table is drawn. */
const missKey = (system: string, predicted: Pick<PredictedStarDTO, "cls" | "stage">, real: string) =>
  `${system}|${predicted.stage ?? predicted.cls}|${real}`;

function loadSeen(): Set<string> {
  if (seen) return seen;
  const set = new Set<string>();
  const p = resolveBoxelStarMissLogPath();
  if (existsSync(p)) {
    try {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const rec = JSON.parse(t) as Partial<BoxelStarMissRecord>;
          if (rec.system && rec.predicted && rec.real) set.add(missKey(rec.system, rec.predicted, rec.real));
        } catch {
          /* a truncated final line is not worth failing over */
        }
      }
    } catch {
      /* unreadable log: start fresh rather than fail the table */
    }
  }
  seen = set;
  return set;
}

/**
 * Append the misses of one saved boxel's check (`prefix`: the system name less its number) that are not in the log yet. Returns how many were written. Never throws:
 * the log is evidence, the table must still be drawn when the disk says no.
 */
export function logBoxelStarMisses(
  prefix: string,
  misses: BoxelStarCheckDTO["misses"],
  scans: ReadonlyMap<number, ArrivalStarScan>,
  now: () => Date = () => new Date(),
): number {
  if (!misses.length) return 0;
  // A saved boxel's prefix is the system name less its number: `Phraa Blao ED-Q d6-`, `Weqaei FG-Y e`.
  const boxel = prefix.replace(/-$/, "");
  const done = loadSeen();
  const lines: string[] = [];
  const added: string[] = [];
  for (const m of misses) {
    const system = `${prefix}${m.n}`;
    const key = missKey(system, m.predicted, m.real);
    if (done.has(key)) continue;
    const s = scans.get(m.n);
    const rec: BoxelStarMissRecord = {
      at: now().toISOString(),
      boxel,
      n: m.n,
      system,
      predicted: m.predicted,
      real: m.real,
      scan: s ? { starType: s.starType, stellarMass: s.stellarMass, temperature: s.temperature, age: s.age ?? null } : null,
      evidence: Math.max(0, scans.size - 1),
    };
    lines.push(JSON.stringify(rec));
    added.push(key);
    done.add(key);
  }
  if (!lines.length) return 0;
  try {
    appendFileSync(resolveBoxelStarMissLogPath(), `${lines.join("\n")}\n`, "utf8");
  } catch {
    for (const k of added) done.delete(k);
    return 0;
  }
  return lines.length;
}

/** Forget the keys read from the file (tests; a moved user-data folder). */
export function resetBoxelStarMissLog(): void {
  seen = null;
}
