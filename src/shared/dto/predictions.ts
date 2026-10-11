/**
 * "How good are my predictions" (plan 1.9, 2026-10-11): the prediction log, scored. Built on the server
 * by `predictionQuality.ts` from `edexo-predictions.json`, drawn in Statistics.
 */

/** One tenth of the chance scale: what the app said, against what grew. */
export interface CalibrationBandDTO {
  /** 0 for 0-10 %, ..., 9 for 90-100 % */
  band: number;
  /** candidates offered with a chance in this band */
  n: number;
  /** of them, confirmed on the body */
  there: number;
  /** the mean chance the app gave them, 0-100 */
  saidMean: number;
}

export type PredictionVerdict = "top" | "shown" | "unlikely" | "absent";

/** Hit counts for one genus or species: where the confirmed plant sat in the list before landing. */
export interface PredictionHitsDTO {
  key: string;
  label: string;
  /** the genus, on a species row */
  genus?: string;
  /** confirmed and scored */
  n: number;
  top: number;
  shown: number;
  unlikely: number;
  absent: number;
}

export interface PredictionMissDTO {
  bodyName: string;
  at: string;
  /** which list it was scored against: the last before landing */
  stage: "fss" | "dss";
  grew: string;
  /** the chance the app gave what grew, null when it was not offered */
  grewPercent: number | null;
  verdict: Exclude<PredictionVerdict, "top">;
  /** the species of the same genus the app put first, null when none was offered */
  beatenBy: string | null;
  beatenByPercent: number | null;
  appVersion: string | null;
}

export interface PredictionVersionDTO {
  /** null for records written before the log carried the version */
  appVersion: string | null;
  n: number;
  top: number;
  shown: number;
}

export interface PredictionQualityDTO {
  /** bodies in the log */
  bodies: number;
  /** bodies with at least one confirmed species scored against a list from before it */
  scoredBodies: number;
  /** bodies with every biological signal confirmed: the only ones a "was not there" can be trusted on */
  completeBodies: number;
  /** confirmed species with no list from before the confirmation (journal replay, late start) */
  unscored: number;
  /** calibration on the complete bodies, from the FSS list (before the DSS) and the DSS list */
  calibration: { fss: CalibrationBandDTO[]; dss: CalibrationBandDTO[] };
  genera: PredictionHitsDTO[];
  species: PredictionHitsDTO[];
  /** newest first */
  misses: PredictionMissDTO[];
  /** the same hit counts by the app version that made the list, newest first */
  versions: PredictionVersionDTO[];
}
