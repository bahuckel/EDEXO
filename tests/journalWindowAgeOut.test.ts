/**
 * Review 2026-11-10 A10: with a "last N days" history window, each old journal that aged out of it mid-session reset
 * the store and replayed every journal uncached. A list that only lost files at its front is now taken as it is; a
 * window widened (files come back) still replays.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startJournalWatcher, type JournalWatcherHandle } from "../src/server/journalWatcher.js";

let dir: string;
let watcher: JournalWatcherHandle | null = null;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const logName = (stamp: string) => `Journal.${stamp}.01.log`;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-window-"));
});

afterEach(async () => {
  await watcher?.close();
  watcher = null;
  rmSync(dir, { recursive: true, force: true });
});

describe("the history window moving on", () => {
  it("does not replay when an old file ages out, and does when the window widens", async () => {
    for (const s of ["2026-09-01T100000", "2026-09-10T100000", "2026-09-18T100000"]) writeFileSync(path.join(dir, logName(s)), "");
    const newest = path.join(dir, logName("2026-09-18T100000"));
    let cutoff: number | null = null;
    let resyncs = 0;
    watcher = startJournalWatcher(
      dir,
      () => {},
      async () => {
        resyncs += 1;
      },
      { path: newest, size: 0 },
      () => ({ minFileStartUtcMs: cutoff }),
      () => 60,
    );
    await wait(200);
    expect(resyncs).toBe(0);

    cutoff = Date.UTC(2026, 8, 5);
    await wait(300);
    expect(resyncs, "the 1 September file aged out").toBe(0);

    cutoff = null;
    await wait(300);
    expect(resyncs, "the window widened: its files come back").toBe(1);
  });
});
