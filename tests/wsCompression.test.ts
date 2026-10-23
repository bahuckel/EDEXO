/**
 * Compression only where it pays (load-time and RAM audits, 2026-10-22): this PC's own windows get neither gzip nor
 * permessage-deflate (loopback, where both are pure cost), the LAN keeps both for big answers and frames, and a
 * small frame goes raw (ws's `threshold` never did that with context takeover on).
 */
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createHttpServer } from "../src/server/httpServer.js";
import { GZIP_MIN_BYTES, sendJson } from "../src/server/routes/httpHelpers.js";
import { dropDeflateOfferFromThisPc, frameSendOptions } from "../src/server/wsCompression.js";
import type { AppSnapshot } from "../src/shared/types.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

const offer = (remoteAddress: string) =>
  ({
    socket: { remoteAddress },
    headers: { "sec-websocket-extensions": "permessage-deflate; client_max_window_bits" },
  }) as unknown as http.IncomingMessage;

describe("the deflate offer", () => {
  it("is dropped for this PC's own windows", () => {
    for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      const req = offer(a);
      dropDeflateOfferFromThisPc(req);
      expect(req.headers["sec-websocket-extensions"], a).toBeUndefined();
    }
  });

  it("is kept for a phone on the LAN", () => {
    for (const a of ["192.168.0.23", "10.0.0.5", "::ffff:192.168.0.23"]) {
      const req = offer(a);
      dropDeflateOfferFromThisPc(req);
      expect(req.headers["sec-websocket-extensions"], a).toContain("permessage-deflate");
    }
  });

  it("leaves small frames raw and deflates big ones where it was agreed", () => {
    expect(frameSendOptions("x".repeat(GZIP_MIN_BYTES - 1))).toEqual({ compress: false });
    expect(frameSendOptions("x".repeat(GZIP_MIN_BYTES))).toEqual({ compress: true });
  });
});

function fakeRes() {
  const headers: Record<string, string> = {};
  let body: Buffer | null = null;
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const res = {
    writableEnded: false,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    end: (b: Buffer) => {
      body = b;
      res.writableEnded = true;
      resolve();
    },
  };
  return { res, headers, done, body: () => body! };
}

describe("JSON answers", () => {
  const big = JSON.stringify({ rows: Array.from({ length: 2000 }, (_, i) => ({ i, name: `row ${i}` })) });

  it("go gzipped to a LAN client that accepts it", async () => {
    const r = fakeRes();
    const req = {
      headers: { "accept-encoding": "gzip, deflate" },
      socket: { remoteAddress: "192.168.0.23" },
    };
    sendJson(req as never, r.res as never, big);
    await r.done;
    expect(r.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(r.body()).toString("utf8")).toBe(big);
  });

  it("go raw to this PC's own windows", async () => {
    const r = fakeRes();
    const req = {
      headers: { "accept-encoding": "gzip, deflate" },
      socket: { remoteAddress: "::ffff:127.0.0.1" },
    };
    sendJson(req as never, r.res as never, big);
    await r.done;
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.body().toString("utf8")).toBe(big);
  });
});

describe("a window on this PC", () => {
  it("agrees no deflate, and still gets big frames and /api/state whole", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ starSystem: `S ${i}`, systemAddress: i }));
    let snap = { journalSystems: rows, n: 0 } as unknown as AppSnapshot;
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
    // The ws client offers permessage-deflate by default, as Chromium does.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    closers.unshift(async () => ws.close());
    const messages: Record<string, unknown>[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(String(d))));
    await new Promise((r) => ws.once("open", r));
    expect(ws.extensions).toBe("");
    const next = async (n: number) => {
      for (let i = 0; i < 100 && messages.length < n; i++) await new Promise((r) => setTimeout(r, 10));
      return messages[n - 1]!;
    };
    const first = await next(1);
    expect((first.payload as { journalSystems: unknown[] }).journalSystems).toHaveLength(1500);
    snap = { journalSystems: rows, n: 1 } as unknown as AppSnapshot;
    broadcast(snap);
    expect(((await next(2)).payload as { n: number }).n).toBe(1);

    const res = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { "Accept-Encoding": "gzip" } });
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(((await res.json()) as { journalSystems: unknown[] }).journalSystems).toHaveLength(1500);
  });
});
