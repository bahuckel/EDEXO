import { promises as fs } from "node:fs";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listJournalFilesChronological } from "../../../src/server/colonize/journalFs";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "journals-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("listJournalFilesChronological", () => {
  it("only stats files the name cannot rule out, and keeps their order", async () => {
    const names = [
      "Journal.2026-01-02T100000.01.log",
      "Journal.2026-01-03T100000.01.log",
      "Journal.2026-09-20T080000.01.log",
      "Journal.2026-09-21T080000.01.log",
      "Journal.2026-09-21T080000.02.log",
      "Journal.legacy.log",
      "Cargo.json",
    ];
    for (const n of names) await writeFile(path.join(dir, n), "{}\n");
    /** The undated file is old on disk, so its mtime has to rule it out. */
    const old = new Date("2025-01-01T00:00:00Z");
    await utimes(path.join(dir, "Journal.legacy.log"), old, old);

    const stat = vi.spyOn(fs, "stat");
    const cutoff = Date.parse("2026-09-15T00:00:00Z");
    const files = await listJournalFilesChronological(dir, cutoff);

    expect(files.map((f) => path.basename(f))).toEqual([
      "Journal.2026-09-20T080000.01.log",
      "Journal.2026-09-21T080000.01.log",
      "Journal.2026-09-21T080000.02.log",
    ]);
    /** Three in the window plus the undated one — never the two dated before the cutoff. */
    const statted = stat.mock.calls.map(([p]) => path.basename(String(p))).sort();
    expect(statted).toEqual([
      "Journal.2026-09-20T080000.01.log",
      "Journal.2026-09-21T080000.01.log",
      "Journal.2026-09-21T080000.02.log",
      "Journal.legacy.log",
    ]);
  });

  it("with no cutoff lists everything", async () => {
    await writeFile(path.join(dir, "Journal.2020-01-01T000000.01.log"), "");
    await writeFile(path.join(dir, "Journal.2026-09-21T080000.01.log"), "");
    expect(await listJournalFilesChronological(dir, null)).toHaveLength(2);
  });
});
