/**
 * Review 2026-11-10 A11: the journals replay at every start before the run in progress is loaded back, and a replayed
 * `Died` (or anything else that ends a run) deleted its file first. While a replay runs, the file is neither deleted
 * nor written; afterwards it goes only when the replayed end came after the file was last written.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clearPersistedOrganicSampleSession,
  holdSampleSessionFileForReplay,
  organicSampleSessionPath,
  releaseSampleSessionFileAfterReplay,
} from "../src/server/organicSampleSessionFile.js";

let dir: string;
let before: string | undefined;

beforeEach(() => {
  before = process.env.EDEXO_USER_DATA_DIR;
  dir = mkdtempSync(path.join(tmpdir(), "edexo-session-hold-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
});

afterEach(() => {
  releaseSampleSessionFileAfterReplay(dir);
  if (before === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = before;
  rmSync(dir, { recursive: true, force: true });
});

/** The run's file, last written at `writtenIso`. */
function savedRun(writtenIso: string): string {
  const file = organicSampleSessionPath(dir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "{}");
  const t = new Date(writtenIso);
  utimesSync(file, t, t);
  return file;
}

describe("the run's file while the journals replay", () => {
  it("survives a death replayed from before it was written", () => {
    const file = savedRun("2026-11-10T20:00:00Z");
    let now: string | null = "2025-03-01T12:00:00Z";
    holdSampleSessionFileForReplay(() => now);
    clearPersistedOrganicSampleSession(dir);
    now = "2026-11-10T19:00:00Z";
    expect(existsSync(file)).toBe(true);
    releaseSampleSessionFileAfterReplay(dir);
    expect(existsSync(file)).toBe(true);
  });

  it("goes when the replayed end came after it was written (a run ended while the app was closed)", () => {
    const file = savedRun("2026-11-10T20:00:00Z");
    holdSampleSessionFileForReplay(() => "2026-11-10T21:00:00Z");
    clearPersistedOrganicSampleSession(dir);
    expect(existsSync(file)).toBe(true);
    releaseSampleSessionFileAfterReplay(dir);
    expect(existsSync(file)).toBe(false);
  });

  it("is deleted at once outside a replay", () => {
    const file = savedRun("2026-11-10T20:00:00Z");
    clearPersistedOrganicSampleSession(dir);
    expect(existsSync(file)).toBe(false);
  });
});
