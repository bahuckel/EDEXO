/**
 * "How good are my predictions" (plan 1.9, 2026-10-11): the prediction log (`predictionAuditLog.ts`)
 * scored, for the Statistics screen.
 *
 * Every confirmed species is scored against the **last list before the first sample on the body** —
 * the DSS list where there was one, else the FSS list. The log's own `outcomes` score only the species
 * confirmed first (later ones meet a list that already holds the first answer), so this reads `truth`
 * and the stages instead.
 *
 * - **Hit counts** per genus and per species: `top` = first among its own genus on that list (the
 *   question left once the genus is known), `shown` = visible but not first, `unlikely` = only behind
 *   "show unlikely", `absent` = never offered.
 * - **Calibration** only on bodies where every biological signal was confirmed: elsewhere a candidate
 *   that was never sampled may still have been there, and counting it as "not there" would make every
 *   chance look too high. A confirmed species the app never offered counts in the bottom band at 0 %.
 * - **Versions**: stages carry the app version since 1.2.15, so a refit shows as its own line; older
 *   records group under "before".
 *
 * Read only, and cheap: the log is capped at 2,000 records (a few milliseconds), so no slicing.
 */
import type {
  CalibrationBandDTO,
  PredictionHitsDTO,
  PredictionMissDTO,
  PredictionQualityDTO,
  PredictionVerdict,
} from "../shared/dto/predictions.js";
import type { PredictionOffer, PredictionRecord, PredictionStage } from "./predictionAuditLog.js";

const MAX_MISSES = 200;

/** The last FSS and the last DSS list before the first sample. */
function listsBeforeTruth(r: PredictionRecord): { fss: PredictionStage | null; dss: PredictionStage | null } {
  let fss: PredictionStage | null = null;
  let dss: PredictionStage | null = null;
  for (const s of r.stages) {
    if (s.stage === "organic") break;
    if (s.stage === "fss") fss = s;
    else dss = s;
  }
  return { fss, dss };
}

function signalsOf(r: PredictionRecord): number {
  let n = 0;
  for (const s of r.stages) n = Math.max(n, s.biologicalSignals ?? 0);
  return n;
}

function verdictOf(offered: PredictionOffer[], id: string): { verdict: PredictionVerdict; o: PredictionOffer | null; first: PredictionOffer | null } {
  const o = offered.find((x) => x.speciesId === id) ?? null;
  if (!o) return { verdict: "absent", o: null, first: null };
  // Offers are stored shown-first in rank order, demoted after: the first of the genus is what the commander read first.
  const first = offered.find((x) => x.genus && x.genus === o.genus) ?? o;
  if (o.unlikely) return { verdict: "unlikely", o, first };
  return { verdict: first.speciesId === id ? "top" : "shown", o, first };
}

function emptyBands(): CalibrationBandDTO[] {
  return Array.from({ length: 10 }, (_, band) => ({ band, n: 0, there: 0, saidMean: 0 }));
}

function hits(map: Map<string, PredictionHitsDTO>, key: string, label: string, v: PredictionVerdict, genus?: string): void {
  let h = map.get(key);
  if (!h) map.set(key, (h = { key, label, ...(genus ? { genus } : {}), n: 0, top: 0, shown: 0, unlikely: 0, absent: 0 }));
  h.n++;
  h[v]++;
}

export function predictionQuality(records: PredictionRecord[], nameOf: (id: string) => { name: string; genus: string } | null): PredictionQualityDTO {
  const cal = { fss: emptyBands(), dss: emptyBands() };
  const saidSum = { fss: new Array<number>(10).fill(0), dss: new Array<number>(10).fill(0) };
  const genera = new Map<string, PredictionHitsDTO>();
  const species = new Map<string, PredictionHitsDTO>();
  const versions = new Map<string, { appVersion: string | null; n: number; top: number; shown: number; last: string }>();
  const misses: PredictionMissDTO[] = [];
  let scoredBodies = 0;
  let completeBodies = 0;
  let unscored = 0;

  for (const r of records) {
    const truth = r.truth ?? [];
    if (!truth.length) continue;
    const { fss, dss } = listsBeforeTruth(r);
    const list = dss ?? fss;
    if (!list) {
      unscored += truth.length;
      continue;
    }
    scoredBodies++;
    const truthSet = new Set(truth);
    const complete = signalsOf(r) > 0 && truth.length >= signalsOf(r);
    if (complete) {
      completeBodies++;
      for (const [k, s] of [["fss", fss], ["dss", dss]] as const) {
        if (!s) continue;
        const seen = new Set<string>();
        for (const o of s.offered) {
          if (o.percent == null || seen.has(o.speciesId)) continue;
          seen.add(o.speciesId);
          const b = Math.min(9, Math.max(0, Math.floor(o.percent / 10)));
          cal[k][b]!.n++;
          saidSum[k][b]! += o.percent;
          if (truthSet.has(o.speciesId)) cal[k][b]!.there++;
        }
        for (const id of truth) {
          if (seen.has(id)) continue;
          cal[k][0]!.n++;
          cal[k][0]!.there++;
        }
      }
    }
    const version = list.appVersion ?? null;
    const vk = version ?? "";
    const vrow = versions.get(vk) ?? { appVersion: version, n: 0, top: 0, shown: 0, last: "" };
    versions.set(vk, vrow);
    for (const id of truth) {
      const { verdict, o, first } = verdictOf(list.offered, id);
      const meta = nameOf(id);
      const name = o?.name ?? meta?.name ?? id;
      const genus = o?.genus || meta?.genus || "";
      hits(species, id, name, verdict, genus);
      if (genus) hits(genera, genus, genus, verdict);
      vrow.n++;
      if (verdict === "top") vrow.top++;
      if (verdict === "top" || verdict === "shown") vrow.shown++;
      if (list.at > vrow.last) vrow.last = list.at;
      if (verdict !== "top") {
        misses.push({
          bodyName: r.bodyName,
          at: list.at,
          stage: list.stage === "fss" ? "fss" : "dss",
          grew: name,
          grewPercent: o?.percent ?? null,
          verdict,
          beatenBy: first && first.speciesId !== id ? first.name : null,
          beatenByPercent: first && first.speciesId !== id ? first.percent : null,
          appVersion: version,
        });
      }
    }
  }

  for (const k of ["fss", "dss"] as const) {
    for (const b of cal[k]) b.saidMean = b.n ? Math.round((saidSum[k][b.band]! / b.n) * 10) / 10 : 0;
  }
  const byN = (a: PredictionHitsDTO, b: PredictionHitsDTO) => b.n - a.n || a.label.localeCompare(b.label);
  misses.sort((a, b) => b.at.localeCompare(a.at));
  return {
    bodies: records.length,
    scoredBodies,
    completeBodies,
    unscored,
    calibration: cal,
    genera: [...genera.values()].sort(byN),
    species: [...species.values()].sort(byN),
    misses: misses.slice(0, MAX_MISSES),
    versions: [...versions.values()]
      .sort((a, b) => b.last.localeCompare(a.last))
      .map(({ appVersion, n, top, shown }) => ({ appVersion, n, top, shown })),
  };
}
