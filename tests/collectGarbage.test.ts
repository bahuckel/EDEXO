/**
 * One full collection after a big job (owner, 2026-10-26: memory). A cached start left ~255 MB for two minutes until
 * V8's idle reducer ran; one `gc()` a few seconds after the journal boot brings it to ~125 MB within seconds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectGarbageSoon } from "../src/server/collectGarbage.js";

describe("collectGarbageSoon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collects once, a few seconds later, however often it is asked in between", () => {
    const gc = vi.fn();
    collectGarbageSoon(gc);
    collectGarbageSoon(gc);
    expect(gc).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(gc).toHaveBeenCalledTimes(1);
    // A later job asks again: another collection.
    collectGarbageSoon(gc);
    vi.advanceTimersByTime(3000);
    expect(gc).toHaveBeenCalledTimes(2);
  });

  it("does nothing where gc cannot be had", () => {
    expect(() => collectGarbageSoon(null)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("switches gc on at run time (no V8 flag needed at start)", () => {
    collectGarbageSoon();
    expect(vi.getTimerCount()).toBe(1);
    expect(() => vi.advanceTimersByTime(3000)).not.toThrow();
  });
});
