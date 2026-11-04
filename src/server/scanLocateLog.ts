/**
 * How far off a composition scan's placing was (owner, 2026-11-04: "the on-screen scan marker is a bit off"). When a
 * sample retires a scan mark, the sample's spot is the plant's: one line per mark in the commander's folder, with the
 * scans, the estimate and the error (east / north metres, and the bearing error from each scan), so a constant bias
 * (Status.json's whole-degree heading, the scanner locking a degree or two off the nose) can be measured and corrected.
 * Local only, like the outlier log.
 */
import { appendFileSync } from "node:fs";
import type { FootTravelFix } from "./footTravelStatus.js";
import type { SurfaceMark } from "./surfaceMarksFile.js";
import { resolveScanLocateLogPath } from "./paths.js";
import { bearingDeg, relativeDeg, toLocal } from "../shared/scanLocate.js";

export function logScanLocate(retired: readonly SurfaceMark[], sample: FootTravelFix, at: unknown, file = resolveScanLocateLogPath()): void {
  const R = sample.planetRadiusM;
  const lines = retired
    .filter((m) => m.scans?.some((s) => s.headingDeg != null))
    .map((m) => {
      const err = toLocal(sample, m, R);
      return JSON.stringify({
        at: typeof at === "string" ? at : new Date().toISOString(),
        species: m.label,
        located: m.located ?? null,
        errorM: Math.round(Math.hypot(err.e, err.n) * 10) / 10,
        errorEastM: Math.round(err.e * 10) / 10,
        errorNorthM: Math.round(err.n * 10) / 10,
        // Per scan: the heading logged, the true bearing to the plant from there, and the difference (+ clockwise).
        scans: (m.scans ?? []).map((s) => {
          const p = toLocal(s, sample, R);
          const trueDeg = bearingDeg(p.e, p.n);
          return {
            headingDeg: s.headingDeg,
            trueBearingDeg: Math.round(trueDeg * 10) / 10,
            offDeg: s.headingDeg == null ? null : Math.round(relativeDeg(trueDeg, s.headingDeg) * 10) / 10,
            distM: Math.round(Math.hypot(p.e, p.n)),
            altitudeM: s.altitudeM,
            pitchDeg: s.pitchDeg,
          };
        }),
      });
    });
  if (!lines.length) return;
  try {
    appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
  } catch {
    /* a log that cannot be written changes nothing in game */
  }
}
