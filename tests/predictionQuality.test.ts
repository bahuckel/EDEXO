/**
 * How good are my predictions (plan 1.9, 2026-10-11): every confirmed species is scored against the last
 * list before the first sample; calibration counts only bodies where every signal was confirmed; a
 * record with no list from before its answer is unscored, not a hit or a miss.
 */
import { describe, expect, it } from "vitest";
import { predictionQuality } from "../src/server/predictionQuality.js";
import type { PredictionOffer, PredictionRecord, PredictionStage } from "../src/server/predictionAuditLog.js";

const offer = (speciesId: string, genus: string, percent: number, rank: number | null, unlikely = false): PredictionOffer => ({
  speciesId,
  name: speciesId.replace(/_/g, " "),
  genus,
  rank,
  percent,
  unlikely,
  blockedBy: [],
});
const stage = (s: PredictionStage["stage"], offered: PredictionOffer[], signals: number, appVersion?: string): PredictionStage => ({
  stage: s,
  at: "2026-10-11T10:00:00.000Z",
  biologicalSignals: signals,
  genusHints: [],
  offered,
  dropped: [],
  unofferedGenera: [],
  ...(appVersion ? { appVersion } : {}),
});
const record = (name: string, stages: PredictionStage[], truth: string[]): PredictionRecord => ({
  bodyKey: name,
  bodyName: name,
  starSystem: "S",
  firstSeenAt: "2026-10-11T09:00:00.000Z",
  updatedAt: "2026-10-11T11:00:00.000Z",
  scan: { planetClass: null, atmosphereType: null, surfaceTemperatureK: null, surfaceGravity: null, surfacePressure: null, volcanism: null },
  stages,
  truth,
  outcomes: [],
  conditions: null,
  final: true,
});

describe("prediction quality", () => {
  const dss = [offer("stratum_x", "Stratum", 95, 1), offer("bac_cerbrus", "Bacterium", 70, 2), offer("bac_tela", "Bacterium", 30, 3), offer("tussock_y", "Tussock", 0.5, null, true)];
  const records = [
    // Complete: two signals, both confirmed. Tela grew but cerbrus was first of the Bacterium.
    record("A 1", [stage("fss", [offer("stratum_x", "Stratum", 55, 1)], 2), stage("dss", dss, 2, "1.2.15"), stage("organic", dss, 2)], ["stratum_x", "bac_tela"]),
    // Incomplete: three signals, one confirmed — scored, but no "was not there" from it.
    record("B 2", [stage("dss", [offer("tussock_y", "Tussock", 40, 1)], 3), stage("organic", [], 3)], ["tussock_y"]),
    // First met after the scan: nothing to score against.
    record("C 3", [stage("organic", [], 1)], ["stratum_x"]),
    // A species the list never had.
    record("D 4", [stage("dss", [offer("stratum_x", "Stratum", 90, 1)], 1), stage("organic", [], 1)], ["fungoida_z"]),
  ];
  const q = predictionQuality(records, (id) => (id === "fungoida_z" ? { name: "Fungoida z", genus: "Fungoida" } : null));

  it("scores every confirmed species within its genus against the list before landing", () => {
    expect(q.scoredBodies).toBe(3);
    expect(q.unscored).toBe(1);
    const g = Object.fromEntries(q.genera.map((h) => [h.key, h]));
    expect(g.Stratum).toMatchObject({ n: 1, top: 1 });
    expect(g.Bacterium).toMatchObject({ n: 1, shown: 1 });
    expect(g.Tussock).toMatchObject({ n: 1, top: 1 });
    expect(g.Fungoida).toMatchObject({ n: 1, absent: 1 });
    expect(q.species.find((s) => s.key === "bac_tela")!.genus).toBe("Bacterium");
    const tela = q.misses.find((m) => m.grew === "bac tela")!;
    expect(tela).toMatchObject({ verdict: "shown", beatenBy: "bac cerbrus", beatenByPercent: 70, grewPercent: 30, stage: "dss", appVersion: "1.2.15" });
    expect(q.misses.find((m) => m.grew === "Fungoida z")!.verdict).toBe("absent");
  });

  it("calibrates on the complete bodies only, a never-offered truth at 0 %", () => {
    expect(q.completeBodies).toBe(2);
    const d = q.calibration.dss;
    expect(d[9]).toMatchObject({ n: 2, there: 1 }); // stratum on A (there), stratum on D (not there)
    expect(d[7]).toMatchObject({ n: 1, there: 0 });
    expect(d[3]).toMatchObject({ n: 1, there: 1 });
    // Tussock at 0.5 % (not there) plus D's fungoida, never offered but there.
    expect(d[0]).toMatchObject({ n: 2, there: 1 });
    expect(q.calibration.fss[5]).toMatchObject({ n: 1, there: 1 });
    // B's Tussock never reaches the curve: two of its three signals are unknown.
    expect(q.calibration.dss[4]!.n).toBe(0);
  });

  it("splits by the version that made the list", () => {
    const by = Object.fromEntries(q.versions.map((v) => [v.appVersion ?? "before", v]));
    expect(by["1.2.15"]).toMatchObject({ n: 2, top: 1, shown: 2 });
    expect(by.before).toMatchObject({ n: 2, top: 1, shown: 1 });
  });
});
