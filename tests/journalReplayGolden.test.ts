/**
 * The journal replay gives one state however it is fed (review 2026-11-10 §4.3 / T10, plan 2.1): the whole log at
 * once, half of it then the cache then the tail (a restart mid-session), and the same lines read twice (a re-read after
 * a resync) all end in the same store. Compared through the payload the merge cache writes, field by field.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const lines = readFileSync("tests/fixtures/journal-variety/Journal.2026-09-01T100000.01.log", "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l) as JournalLine);

const payload = (st: GameStateStore) =>
  JSON.parse(JSON.stringify(st.serializeJournalMergePayload())) as Record<string, unknown>;

function diff(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

function once(): GameStateStore {
  const st = new GameStateStore();
  for (const l of lines) st.apply(l);
  return st;
}

describe("the journal replay", () => {
  it("is the same read whole, or half, then through the cache, then the rest", () => {
    const half = Math.floor(lines.length / 2);
    const first = new GameStateStore();
    for (const l of lines.slice(0, half)) first.apply(l);
    const resumed = new GameStateStore();
    expect(resumed.hydrateJournalMergePayload(payload(first) as never)).toBe(true);
    for (const l of lines.slice(half)) resumed.apply(l);
    expect(diff(payload(once()), payload(resumed))).toEqual([]);
  });

  /*
    Rolling records of lines as they came, which a second read lengthens by design; everything else must not count a
    line twice. jumpRange keeps the last 40 jumps flown: a re-read jump counts again in the full-range estimate (only a
    resync that re-reads lines does that; noted in the plan, 2026-11-11).
  */
  const SEQUENCE_RECORDS = new Set(["footJournalContextBuffer", "jumpRange"]);

  it("is the same when every line is read twice, rolling records of lines aside", () => {
    const twice = new GameStateStore();
    for (const l of lines) twice.apply(l);
    for (const l of lines) twice.apply(l);
    expect(diff(payload(once()), payload(twice)).filter((k) => !SEQUENCE_RECORDS.has(k))).toEqual([]);
  });
});
