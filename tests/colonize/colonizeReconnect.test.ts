// @vitest-environment jsdom
/**
 * Colonize asks for its snapshot again when its socket comes back (review 2026-11-10 F1): the server pushes only on
 * change, so what changed while the phone slept or the server restarted never arrived.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send() {}
  close() {
    this.onclose?.();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the Colonize socket", () => {
  it("tells its listeners when it reconnects, not when it first opens", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    const { onColonizeReconnect } = await import("../../src/client/colonize/api");
    const seen = vi.fn();
    const off = onColonizeReconnect(seen);
    FakeSocket.all[0]!.onopen?.();
    expect(seen).not.toHaveBeenCalled();
    // Dropped, then back after the retry wait.
    FakeSocket.all[0]!.close();
    await vi.advanceTimersByTimeAsync(1_000);
    FakeSocket.all.at(-1)!.onopen?.();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    FakeSocket.all.at(-1)!.close();
    await vi.advanceTimersByTimeAsync(2_000);
    FakeSocket.all.at(-1)!.onopen?.();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
