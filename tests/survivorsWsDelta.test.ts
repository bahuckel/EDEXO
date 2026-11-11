/**
 * The "only what changed" pushes (review 2026-11-10 §4.9, plan 2.1): a socket that switched to the app channel got a
 * delta against a push it never had, and a field that left the snapshot was never pushed, with the suite green.
 */
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createHttpServer } from "../src/server/httpServer.js";
import type { AppSnapshot } from "../src/shared/types.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

const big = (tag: string) => Array.from({ length: 400 }, (_, i) => ({ starSystem: `${tag} ${i}`, systemAddress: i }));

async function start(initial: Record<string, unknown>) {
  let snap = initial as unknown as AppSnapshot;
  const { server, broadcast, listening } = createHttpServer({
    port: 0,
    bindHost: "127.0.0.1",
    getSnapshot: () => snap,
    getStatus: () => ({}) as never,
    getCommanderPosition: () => null,
    getCommanderSystem: () => null,
  });
  await listening;
  closers.push(() => new Promise((r) => server.close(() => r())));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    set: (s: Record<string, unknown>) => {
      snap = s as unknown as AppSnapshot;
      broadcast(snap);
    },
  };
}

async function client(port: number, channel?: string) {
  const messages: Record<string, unknown>[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${channel ? `?channel=${channel}` : ""}`);
  closers.unshift(async () => ws.close());
  ws.on("message", (d) => messages.push(JSON.parse(String(d))));
  await new Promise((r) => ws.once("open", r));
  const next = async (n: number) => {
    for (let i = 0; i < 200 && messages.length < n; i++) await new Promise((r) => setTimeout(r, 10));
    return messages[n - 1];
  };
  return { ws, messages, next };
}

describe("app-channel pushes", () => {
  it("are whole for a socket that just switched to the app channel", async () => {
    const t = await start({ journalSystems: big("A"), liveShipFuelRange: { ly: 10 } });
    const app = await client(t.port);
    await app.next(1);
    // Another page starts on the shell's channel and has had a push there (its connect-time whole frame is spent).
    const late = await client(t.port, "shell");
    await late.next(1);
    t.set({ journalSystems: big("A"), liveShipFuelRange: { ly: 11 } });
    await app.next(2);
    await late.next(2);
    // Then it asks for the app channel: the next app push must not be a delta against a push it never had.
    late.ws.send(JSON.stringify({ type: "hello", channel: "app" }));
    await late.next(3);
    t.set({ journalSystems: big("A"), liveShipFuelRange: { ly: 12 } });
    const frame = (await late.next(4))!;
    expect(frame.unchanged).toBeUndefined();
    expect((frame.payload as Record<string, unknown>).journalSystems).toHaveLength(400);
  });

  it("are whole after a push skipped for a socket still sending earlier frames", async () => {
    const t = await start({ journalSystems: big("A"), liveShipFuelRange: { ly: 10 } });
    const app = await client(t.port);
    await app.next(1);
    // One push first: the connect-time whole frame is spent.
    t.set({ journalSystems: big("A"), liveShipFuelRange: { ly: 9 } });
    await app.next(2);
    // The server's side of the socket reports a backlog for one push (a slow phone): that push is skipped.
    const real = Object.getOwnPropertyDescriptor(WebSocket.prototype, "bufferedAmount")!;
    let slow = true;
    Object.defineProperty(WebSocket.prototype, "bufferedAmount", {
      configurable: true,
      get(this: WebSocket & { _isServer?: boolean }) {
        return slow && this._isServer ? 64 * 1024 * 1024 : real.get!.call(this);
      },
    });
    try {
      t.set({ journalSystems: big("B"), liveShipFuelRange: { ly: 10 } });
      slow = false;
      // The next push changes only the fuel: a delta against the skipped push would leave the page on "A".
      t.set({ journalSystems: big("B"), liveShipFuelRange: { ly: 11 } });
      const frame = (await app.next(3))!;
      expect(frame.unchanged).toBeUndefined();
      const systems = (frame.payload as { journalSystems: { starSystem: string }[] }).journalSystems;
      expect(systems[0]!.starSystem).toBe("B 0");
    } finally {
      Object.defineProperty(WebSocket.prototype, "bufferedAmount", real);
    }
  });

  // A client only ever sends a hello (wsHub maxPayload 64 KiB): a bigger frame closes the socket, 1009.
  it("close a socket that sends a frame over 64 KiB", async () => {
    const t = await start({ journalSystems: big("A") });
    const app = await client(t.port);
    await app.next(1);
    const closed = new Promise<number>((r) => app.ws.once("close", (code) => r(code)));
    app.ws.send("x".repeat(65 * 1024));
    expect(await closed).toBe(1009);
  });

  it("go out when a field leaves the snapshot", async () => {
    const t = await start({ journalSystems: big("A"), liveShipFuelRange: { ly: 10 } });
    const app = await client(t.port);
    await app.next(1);
    t.set({ journalSystems: big("A"), liveShipFuelRange: { ly: 10 } });
    await app.next(2);
    t.set({ journalSystems: big("A") });
    expect(await app.next(3)).toBeDefined();
  });
});
