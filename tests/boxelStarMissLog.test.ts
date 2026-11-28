import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoxelStarCheckDTO } from "../src/shared/boxel.js";
import type { ArrivalStarScan } from "../src/shared/stellarClass.js";

let tmp: string;
let logPath: string;

// Resolved from the user data directory: a temp file, so the test never touches the commander's own log.
vi.mock("../src/server/paths.js", async () => {
  const actual = await vi.importActual<typeof import("../src/server/paths.js")>("../src/server/paths.js");
  return { ...actual, resolveBoxelStarMissLogPath: () => logPath };
});

const { logBoxelStarMisses, resetBoxelStarMissLog } = await import("../src/server/boxelStarMissLog.js");

const BOXEL = "Phraa Blao ED-Q d6-";
const scans = new Map<number, ArrivalStarScan>([
  [162, { starType: "G", stellarMass: 0.98, temperature: 5600, age: 4200 }],
  [7, { starType: "K", stellarMass: 0.7, temperature: 4400 }],
  [9, { starType: "Herbig", stellarMass: 2.9, temperature: 9800 }],
]);
const misses: BoxelStarCheckDTO["misses"] = [
  { n: 162, predicted: { cls: "K", right: 0.97 }, real: "G" },
  { n: 9, predicted: { cls: "A", right: 0.95, stage: "giant" }, real: "herbig" },
];
const at = () => new Date("2026-11-28T15:00:00.000Z");
const lines = () =>
  readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "edexo-star-miss-"));
  logPath = path.join(tmp, "edexo-star-misses.jsonl");
  resetBoxelStarMissLog();
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("boxel star miss log", () => {
  it("writes each miss once, with the scan that disproved it", () => {
    expect(logBoxelStarMisses(BOXEL, misses, scans, at)).toBe(2);
    const [a, b] = lines();
    expect(a).toEqual({
      at: "2026-11-28T15:00:00.000Z",
      boxel: "Phraa Blao ED-Q d6",
      n: 162,
      system: "Phraa Blao ED-Q d6-162",
      predicted: { cls: "K", right: 0.97 },
      real: "G",
      scan: { starType: "G", stellarMass: 0.98, temperature: 5600, age: 4200 },
      evidence: 2,
    });
    expect(b.real).toBe("herbig");
    expect(b.scan.age).toBeNull();
    // The table is drawn again: nothing new.
    expect(logBoxelStarMisses(BOXEL, misses, scans, at)).toBe(0);
    expect(lines()).toHaveLength(2);
  });

  it("remembers what the file holds across a restart", () => {
    logBoxelStarMisses(BOXEL, misses.slice(0, 1), scans, at);
    resetBoxelStarMissLog();
    expect(logBoxelStarMisses(BOXEL, misses, scans, at)).toBe(1);
    expect(lines().map((r) => r.n)).toEqual([162, 9]);
  });

  it("a new answer for the same system is a new record", () => {
    logBoxelStarMisses(BOXEL, misses.slice(0, 1), scans, at);
    const sharper = [{ n: 162, predicted: { cls: "F", right: 0.96 }, real: "G" }];
    expect(logBoxelStarMisses(BOXEL, sharper, scans, at)).toBe(1);
  });

  it("skips a broken line and writes nothing for no misses", () => {
    writeFileSync(logPath, '{"system":"Phraa Blao ED-Q d6-162","predicted":{"cls":"K"},"real":"G"}\n{"trunc', "utf8");
    expect(logBoxelStarMisses(BOXEL, [], scans, at)).toBe(0);
    expect(logBoxelStarMisses(BOXEL, misses, scans, at)).toBe(1);
  });

  it("names a system of a boxel with no number as its prefix and number", () => {
    logBoxelStarMisses("Weqaei FG-Y e", [{ n: 8, predicted: { cls: "B", right: 0.99 }, real: "herbig" }], scans, at);
    expect(lines()[0]).toMatchObject({ boxel: "Weqaei FG-Y e", system: "Weqaei FG-Y e8" });
  });

  it("never throws when the file cannot be written, and tries again next time", () => {
    logPath = path.join(tmp, "no-such-dir", "edexo-star-misses.jsonl");
    expect(logBoxelStarMisses(BOXEL, misses, scans, at)).toBe(0);
    logPath = path.join(tmp, "edexo-star-misses.jsonl");
    expect(logBoxelStarMisses(BOXEL, misses, scans, at)).toBe(2);
  });
});
