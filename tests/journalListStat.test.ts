/**
 * The journal listing runs on every 2 s poll over every log; only names that carry no timestamp, or share one, need
 * their mtime (code review D8, 2026-10-14). The order and the start-time filter must be what they were.
 */
import { promises as fsp, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listJournalFilesChronological } from "../src/server/journalWatcher.js";

afterEach(() => vi.restoreAllMocks());

function dirWith(files: [string, number][]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "edexo-journal-list-"));
  for (const [name, mtimeSec] of files) {
    const p = path.join(dir, name);
    writeFileSync(p, "");
    utimesSync(p, mtimeSec, mtimeSec);
  }
  return dir;
}

describe("listJournalFilesChronological", () => {
  it("orders by the name's timestamp and stats only legacy or tied names", async () => {
    const dir = dirWith([
      ["Journal.2026-10-13T120000.01.log", 300],
      ["Journal.2026-10-12T080000.01.log", 900],
      ["Journal.2026-10-13T120000.02.log", 100],
      ["Journal.2026-10-14T010000.01.log", 50],
    ]);
    const stat = vi.spyOn(fsp, "stat");
    const out = (await listJournalFilesChronological(dir)).map((p) => path.basename(p));
    expect(out).toEqual([
      "Journal.2026-10-12T080000.01.log",
      // Same second in the name: their mtimes decide, as before.
      "Journal.2026-10-13T120000.02.log",
      "Journal.2026-10-13T120000.01.log",
      "Journal.2026-10-14T010000.01.log",
    ]);
    // Only the two whose names tie are stat'ed.
    expect(stat.mock.calls.length).toBe(2);
  });

  it("still filters by the start time in the name", async () => {
    const dir = dirWith([
      ["Journal.2026-10-12T080000.01.log", 900],
      ["Journal.2026-10-14T010000.01.log", 50],
    ]);
    const out = await listJournalFilesChronological(dir, { minFileStartUtcMs: Date.UTC(2026, 9, 13) });
    expect(out.map((p) => path.basename(p))).toEqual(["Journal.2026-10-14T010000.01.log"]);
  });
});
