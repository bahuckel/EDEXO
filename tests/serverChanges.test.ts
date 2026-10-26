/**
 * R2 (owner 2026-10-24): one events socket per page, opened while something listens (src/client/serverChanges.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(topics: string[]) {
    this.onmessage?.({ data: JSON.stringify({ type: "changed", topics }) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("onServerChange", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeSocket.all = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("window", { location: { protocol: "http:", host: "127.0.0.1:7111" } });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens one socket, says what it watches, and calls only that topic's listeners", async () => {
    const { onServerChange } = await import("../src/client/serverChanges");
    const route = vi.fn();
    const own = vi.fn();
    const stopRoute = onServerChange("galaxy-route", route);
    onServerChange("galaxy-own", own);
    expect(FakeSocket.all).toHaveLength(1);
    const ws = FakeSocket.all[0]!;
    expect(ws.url).toBe("ws://127.0.0.1:7111/ws?channel=events");
    ws.open();
    expect(ws.sent.at(-1)).toEqual({ type: "watch", topics: ["galaxy-route", "galaxy-own"] });
    // Once each on open (below), then only the topic that changed.
    expect(route).toHaveBeenCalledTimes(1);
    expect(own).toHaveBeenCalledTimes(1);
    ws.push(["galaxy-route"]);
    expect(route).toHaveBeenCalledTimes(2);
    expect(own).toHaveBeenCalledTimes(1);
    stopRoute();
    expect(ws.sent.at(-1)).toEqual({ type: "watch", topics: ["galaxy-own"] });
  });

  it("after a dropped connection, reconnects and calls every listener once", async () => {
    const { onServerChange } = await import("../src/client/serverChanges");
    const fn = vi.fn();
    onServerChange("neutron-live", fn);
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.open();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls every listener once when the socket first opens: a change made between the page's first read and its watch is not lost", async () => {
    const { onServerChange } = await import("../src/client/serverChanges");
    const mirror = vi.fn();
    onServerChange("ui-mirror", mirror);
    expect(mirror).not.toHaveBeenCalled();
    FakeSocket.all[0]!.open();
    expect(mirror).toHaveBeenCalledTimes(1);
  });

  it("closes the socket once nothing listens", async () => {
    const { onServerChange } = await import("../src/client/serverChanges");
    const stop = onServerChange("ui-mirror", () => {});
    FakeSocket.all[0]!.open();
    stop();
    // A drawer closing and another opening at once keeps it.
    const stop2 = onServerChange("ui-mirror", () => {});
    await vi.advanceTimersByTimeAsync(2500);
    expect(FakeSocket.all[0]!.closed).toBe(false);
    stop2();
    await vi.advanceTimersByTimeAsync(2500);
    expect(FakeSocket.all[0]!.closed).toBe(true);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
