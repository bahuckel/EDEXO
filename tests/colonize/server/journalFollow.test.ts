/**
 * Colonize follows EDEXO's journal reading (1.3.0, journalTap.ts) instead of a tail of its own. The rule it must
 * keep: every journal line is applied exactly once, whether it came from Colonize's own window read, a catch-up
 * after the journals were re-read (a new journal file), or the live tail, and in whichever order those overlap.
 *
 * Its contribution history already ignores repeats, so tonnage alone would not catch a line applied twice: the
 * reducer is wrapped here to count applications per line.
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const applied = new Map<number, number>();
vi.mock("../../../src/server/colonize/journalEvents", async (orig) => {
  const real = await orig<typeof import("../../../src/server/colonize/journalEvents")>();
  return {
    ...real,
    applyJournalObject: (state: Parameters<typeof real.applyJournalObject>[0], j: Record<string, unknown>) => {
      if (typeof j.n === "number") applied.set(j.n, (applied.get(j.n) ?? 0) + 1);
      return real.applyJournalObject(state, j);
    },
  };
});

const { ColonizeStore } = await import("../../../src/server/colonize/colonizeStore");
const { emitJournalReread, emitLiveJournalLine } = await import("../../../src/server/journalTap.js");
const { startJournalWatcher } = await import("../../../src/server/journalWatcher.js");
const { resolveColonizeDataDir } = await import("../../../src/server/paths.js");
const { colonizeServiceRunning } = await import("../../../src/server/colonize/colonizeService");

let journalDir: string;
let dataDir: string;
let file: string;
let store: InstanceType<typeof ColonizeStore> | null = null;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A journal file named for now, so it is inside Colonize's 7-day window. */
function journalName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `Journal.${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.01.log`;
}

const line = (n: number) => ({ timestamp: new Date().toISOString(), event: "Music", MusicTrack: `t${n}`, n });
/** Append a line; returns where it ends in the file (bytes). */
function append(n: number): { obj: ReturnType<typeof line>; end: number } {
  const obj = line(n);
  appendFileSync(file, `${JSON.stringify(obj)}\r\n`);
  return { obj, end: readFileSync(file).length };
}

beforeEach(() => {
  applied.clear();
  journalDir = mkdtempSync(path.join(tmpdir(), "colonize-follow-j-"));
  dataDir = mkdtempSync(path.join(tmpdir(), "colonize-follow-d-"));
  file = path.join(journalDir, journalName());
  writeFileSync(file, "");
});

afterEach(async () => {
  await store?.shutdown();
  store = null;
  rmSync(journalDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Colonize following EDEXO's journal reading", () => {
  it("applies each line once across the window read, the live tail and a catch-up", async () => {
    const a = [append(1), append(2), append(3)];
    store = new ColonizeStore(dataDir, { journalDir: () => journalDir, edsmApiKey: () => null });
    await store.restartTail();
    expect([...applied.entries()].sort()).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);

    // The live tail delivers a line the window read already had: skipped.
    emitLiveJournalLine(a[2]!.obj, { path: file, end: a[2]!.end });
    // A new line, live: applied.
    const l4 = append(4);
    emitLiveJournalLine(l4.obj, { path: file, end: l4.end });
    expect(applied.get(3)).toBe(1);
    expect(applied.get(4)).toBe(1);

    // A line written while the tail missed it, then a re-read (a new journal file): the catch-up reads only it.
    const l5 = append(5);
    emitJournalReread();
    await store.catchUp();
    expect(applied.get(5)).toBe(1);
    expect(applied.get(4)).toBe(1);
    // ...and the live tail delivering it afterwards changes nothing.
    emitLiveJournalLine(l5.obj, { path: file, end: l5.end });
    expect(applied.get(5)).toBe(1);

    // A live line that lands while a catch-up runs is held, then applied once.
    const l6 = append(6);
    const run = store.catchUp();
    emitLiveJournalLine(l6.obj, { path: file, end: l6.end });
    await run;
    expect(applied.get(6)).toBe(1);
    expect([...applied.values()].every((v) => v === 1)).toBe(true);
  });

  it("stops following when shut down", async () => {
    append(1);
    store = new ColonizeStore(dataDir, { journalDir: () => journalDir, edsmApiKey: () => null });
    await store.restartTail();
    await store.shutdown();
    store = null;
    const l2 = append(2);
    emitLiveJournalLine(l2.obj, { path: file, end: l2.end });
    expect(applied.get(2)).toBeUndefined();
  });

  it("takes the journal folder and the EDSM key from EDEXO, and writes its state where it is told", async () => {
    let key: string | null = "abc";
    store = new ColonizeStore(dataDir, { journalDir: () => journalDir, edsmApiKey: () => key });
    expect(store.getJournalDir()).toBe(journalDir);
    expect(store.getSnapshot().edsmApiKeyPresent).toBe(true);
    key = null;
    expect(store.getSnapshot().edsmApiKeyPresent).toBe(false);
    await store.persistState();
    expect(existsSync(path.join(dataDir, "edexo-colonize-state.json"))).toBe(true);
  });
});

describe("the service and its files", () => {
  it("is not started by importing it (a commander who never opens Colonize pays nothing)", () => {
    expect(colonizeServiceRunning()).toBe(false);
  });

  it("keeps its files in the profile's colonize folder", () => {
    // Resolved as the app resolves it: a Git Bash temp folder (/tmp/...) is not the path it becomes.
    expect(resolveColonizeDataDir().startsWith(path.resolve(process.env.EDEXO_USER_DATA_DIR!))).toBe(true);
    expect(path.basename(resolveColonizeDataDir())).toBe("colonize");
  });
});

describe("the live tail's line ends", () => {
  it("says where each line ends in bytes, multi-byte names included", async () => {
    const seen: { n: number; end: number }[] = [];
    const watcher = startJournalWatcher(
      journalDir,
      (l, at) => seen.push({ n: l.n as number, end: at.end }),
      async () => {},
      { path: file, size: 0 },
      () => ({ minFileStartUtcMs: null }),
      () => 100,
    );
    try {
      await wait(150);
      const lines = [1, 2, 3].map((n) => JSON.stringify({ event: "FSDJump", StarSystem: "Hēlen Löwe's Star", n }));
      appendFileSync(file, `${lines[0]}\r\n${lines[1]}\r\n`);
      await wait(400);
      appendFileSync(file, `${lines[2]}\r\n`);
      await wait(400);
      let end = 0;
      const want = lines.map((l, i) => ({ n: i + 1, end: (end += Buffer.byteLength(`${l}\r\n`)) }));
      expect(seen).toEqual(want);
    } finally {
      await watcher.close();
    }
  });
});
