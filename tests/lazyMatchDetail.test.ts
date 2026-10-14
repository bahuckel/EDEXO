/**
 * The habitat detail built when read (code review, 2026-10-14; src/server/lazyMatchDetail.ts): once, on the first
 * read; a copy of the row carries the built value; the push stamps the row without building it, and the stamp holds
 * once it has been built.
 */
import { describe, expect, it, vi } from "vitest";
import { attachLazyDetail, lazyDetailOf } from "../src/server/lazyMatchDetail.js";
import { findMatchDetail, slimBodyForApp } from "../src/server/wsChannels.js";
import type { AppSnapshot, BodyComputed } from "../src/shared/types.js";

const detail = { stats: [{ id: "a" }] } as never;

function row() {
  return {
    entry: { id: "x_1", displayName: "X", genus: "X", genusDataDir: "x", criteria: {} },
    exomasteryVarietyHints: [{ label: "h" }],
    otherMatchDetailCards: [{ id: "c1" }, { id: "c2" }],
    presenceProbabilityPercent: 40,
  } as Record<string, unknown>;
}

describe("attachLazyDetail", () => {
  it("builds once, on the first read, and a copy carries the built value", () => {
    const m = row();
    const build = vi.fn(() => detail);
    attachLazyDetail(m, build, true);
    expect(build).not.toHaveBeenCalled();
    expect(m.exomasteryDetail).toBe(detail);
    expect(m.exomasteryDetail).toBe(detail);
    expect(build).toHaveBeenCalledTimes(1);
    expect({ ...m }.exomasteryDetail).toBe(detail);
    expect(JSON.parse(JSON.stringify(m)).exomasteryDetail).toEqual({ stats: [{ id: "a" }] });
    expect(lazyDetailOf(m)?.habitat).toBe(true);
  });
});

describe("the push and a lazy row", () => {
  it("stamps it without building it, keeps the stamp once built, and /api/match-detail builds it", () => {
    const m = row();
    const build = vi.fn(() => detail);
    attachLazyDetail(m, build, true);
    const body = { state: { key: "1:2" }, matches: [m] } as unknown as BodyComputed;
    const pushed = slimBodyForApp(body).matches[0] as unknown as Record<string, unknown>;
    expect(build).not.toHaveBeenCalled();
    expect(pushed.exomasteryDetail).toBeUndefined();
    expect(pushed.otherMatchDetailCards).toBeUndefined();
    const lazy = pushed.lazyDetail as { habitat: boolean; otherCards: number; v: string };
    expect(lazy).toMatchObject({ habitat: true, otherCards: 2 });
    const snap = { bodies: [body] } as unknown as AppSnapshot;
    expect(findMatchDetail(snap, "1:2", "x_1")?.exomasteryDetail).toBe(detail);
    expect(build).toHaveBeenCalledTimes(1);
    const again = slimBodyForApp(body).matches[0] as unknown as { lazyDetail: { v: string } };
    expect(again.lazyDetail.v).toBe(lazy.v);
  });
});
