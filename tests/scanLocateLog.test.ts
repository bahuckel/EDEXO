/**
 * Where a composition scan put a plant against where it was sampled (server/scanLocateLog.ts): the error, and how far
 * off each scan's logged heading was from the true bearing (owner, 2026-11-04: "the on-screen scan marker is a bit off").
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { logScanLocate } from "../src/server/scanLocateLog.js";
import { fromLocal } from "../src/shared/scanLocate.js";

const R = 1_000_000;
const O = { latDeg: 20, lonDeg: 30 };
let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("scan placing log", () => {
  it("logs the error and each scan's heading against the true bearing", () => {
    dir = mkdtempSync(path.join(tmpdir(), "edexo-locate-"));
    const file = path.join(dir, "log.jsonl");
    // The plant really at 0,100 north; the estimate 6 m west of it; one scan from due south logged 2 degrees short.
    const est = fromLocal(O, -6, 100, R);
    const scanAt = fromLocal(O, 0, 0, R);
    logScanLocate(
      [
        {
          bodyKey: "1:2",
          bodyNameNorm: "b",
          ...est,
          label: "Prasinum Sinuous Tubers",
          atIso: "2026-11-04T10:13:07Z",
          located: "crossing",
          scans: [{ ...scanAt, headingDeg: 358, altitudeM: 4, pitchDeg: null, atIso: "2026-11-04T10:13:07Z" }],
        },
      ],
      { ...fromLocal(O, 0, 100, R), planetRadiusM: R, bodyName: "B", headingDeg: 0, temperatureK: null, gravityG: null },
      "2026-11-04T10:40:00Z",
      file,
    );
    const row = JSON.parse(readFileSync(file, "utf8").trim()) as { errorM: number; errorEastM: number; scans: { offDeg: number; distM: number }[] };
    expect(row.errorM).toBeCloseTo(6, 0);
    expect(row.errorEastM).toBeCloseTo(-6, 0);
    expect(row.scans[0]!.offDeg).toBeCloseTo(2, 1);
    expect(row.scans[0]!.distM).toBe(100);
  });

  it("logs nothing for marks without a heading", () => {
    dir = mkdtempSync(path.join(tmpdir(), "edexo-locate-"));
    const file = path.join(dir, "log.jsonl");
    logScanLocate(
      [{ bodyKey: "1:2", bodyNameNorm: "b", ...O, label: "x", atIso: "2026-11-04T10:13:07Z" }],
      { ...O, planetRadiusM: R, bodyName: "B", headingDeg: 0, temperatureK: null, gravityG: null },
      "2026-11-04T10:40:00Z",
      file,
    );
    expect(() => readFileSync(file, "utf8")).toThrow();
  });
});
