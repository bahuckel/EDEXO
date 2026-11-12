/** Plan 2026-11-10 Phase 7.1: the snapshot push's window, pinned now that it is out of startEdexo. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPushScheduler } from "../src/server/pushScheduler.js";

afterEach(() => vi.useRealTimers());

describe("createPushScheduler", () => {
  it("pushes at once when idle, then at most once a window while pushes stream in", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const broadcast = vi.fn();
    const { push } = createPushScheduler(broadcast, 250);
    push();
    expect(broadcast).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    push();
    push();
    push();
    expect(broadcast).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(149);
    expect(broadcast).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(broadcast).toHaveBeenCalledTimes(2);
    // A window after the deferred one: at once again.
    vi.advanceTimersByTime(250);
    push();
    expect(broadcast).toHaveBeenCalledTimes(3);
  });

  it("pushFlush sends now and drops the push waiting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const broadcast = vi.fn();
    const { push, pushFlush } = createPushScheduler(broadcast, 250);
    push();
    push();
    pushFlush();
    expect(broadcast).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });
});
