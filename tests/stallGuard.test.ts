/** Review 2026-11-10 C9: downloads with no clock of their own waited undici's five minutes on a dead connection. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { stallGuard } from "../src/server/stallGuard.js";

afterEach(() => vi.useRealTimers());

describe("stallGuard", () => {
  it("aborts with no answer, and with no bytes once streaming; not while bytes come", () => {
    vi.useFakeTimers();
    const silent = stallGuard("a.bin", 1000, 2000);
    vi.advanceTimersByTime(999);
    expect(silent.signal.aborted).toBe(false);
    vi.advanceTimersByTime(2);
    expect((silent.signal.reason as Error).message).toBe("a.bin: no answer in 1 s");

    const flowing = stallGuard("b.bin", 1000, 2000);
    for (let i = 0; i < 5; i++) {
      flowing.touch();
      vi.advanceTimersByTime(1500);
    }
    expect(flowing.signal.aborted).toBe(false);
    vi.advanceTimersByTime(600);
    expect((flowing.signal.reason as Error).message).toBe("b.bin: no data for 2 s");

    const finished = stallGuard("c.bin", 1000, 2000);
    finished.done();
    vi.advanceTimersByTime(10_000);
    expect(finished.signal.aborted).toBe(false);
  });
});
