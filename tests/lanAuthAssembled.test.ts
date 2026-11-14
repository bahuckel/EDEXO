/**
 * The access key, on the assembled server (review 2026-11-10 T6, plan 1.2): removing the key guard from the HTTP
 * middleware or from the WebSocket upgrade left every test green. Here another device asks, over HTTP and over the
 * socket, with and without the key.
 *
 * Another device without a LAN bind (which would raise a firewall prompt): the server-side socket's `remoteAddress` is
 * set to a LAN address as each connection arrives, before Express or `ws` read it.
 */
import type { AddressInfo } from "node:net";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createHttpServer } from "../src/server/httpServer.js";
import { LAN_KEY_HEADER } from "../src/server/lanAuth.js";
import type { AppSnapshot } from "../src/shared/types.js";

const KEY = "test-lan-key-0123456789";
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function start(lanKey: string | null = KEY, spoof = true) {
  const { server, listening } = createHttpServer({
    port: 0,
    bindHost: "127.0.0.1",
    lanKey,
    getSnapshot: () => ({ port: 7111 }) as unknown as AppSnapshot,
    getStatus: () => ({ ok: true }) as never,
    getCommanderPosition: () => null,
    getCommanderSystem: () => null,
  });
  if (spoof) server.prependListener("connection", (s) => Object.defineProperty(s, "remoteAddress", { value: "192.168.1.50" }));
  await listening;
  closers.push(() => new Promise((r) => server.close(() => r())));
  return (server.address() as AddressInfo).port;
}

function request(port: number, method: string, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(method === "POST" ? "{}" : undefined);
  });
}

function socket(url: string): Promise<"open" | number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    closers.unshift(async () => ws.terminate());
    ws.once("open", () => resolve("open"));
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.once("error", () => resolve(0));
  });
}

describe("another device on the assembled server", () => {
  it("gets nothing over HTTP without the key; the header, the pairing link and the cookie let it in", async () => {
    const port = await start();
    expect((await request(port, "GET", "/api/status")).status).toBe(401);
    expect((await request(port, "GET", "/api/status", { [LAN_KEY_HEADER]: "wrong-key-wrong-key" })).status).toBe(401);
    expect((await request(port, "GET", "/api/status", { [LAN_KEY_HEADER]: KEY })).status).toBe(200);
    const paired = await request(port, "GET", `/api/status?k=${KEY}`);
    expect(paired.status).toBe(200);
    const cookie = String(paired.headers["set-cookie"] ?? "").split(";")[0]!;
    expect(cookie).toContain(encodeURIComponent(KEY));
    expect((await request(port, "GET", "/api/status", { Cookie: cookie })).status).toBe(200);
  });

  it("opens no socket without the key", async () => {
    const port = await start();
    expect(await socket(`ws://127.0.0.1:${port}/ws`)).toBe(401);
    expect(await socket(`ws://127.0.0.1:${port}/ws?channel=events`)).toBe(401);
    expect(await socket(`ws://127.0.0.1:${port}/ws?k=${KEY}`)).toBe("open");
  });

  it("with the key still cannot reach a route kept on this PC", async () => {
    const port = await start();
    expect((await request(port, "POST", "/api/launcher/lan-access", { [LAN_KEY_HEADER]: KEY, "Content-Type": "application/json" })).status).toBe(403);
    expect((await request(port, "POST", "/api/scan-route/netlog", { [LAN_KEY_HEADER]: KEY, "Content-Type": "application/json" })).status).toBe(403);
  });
});

/*
  Review 2026-11-10 C2: a tunnel or reverse proxy on this PC (the Cloudflare tunnel service) connects over loopback.
  A request that names its real client in a proxy header is another device, whatever socket carried it.
*/
describe("a request relayed by a proxy on this PC", () => {
  it("needs the key and reaches no route kept on this PC", async () => {
    const port = await start(KEY, false);
    expect((await request(port, "GET", "/api/status")).status).toBe(200);
    for (const h of ["X-Forwarded-For", "CF-Connecting-IP", "Forwarded", "X-Real-IP"]) {
      const via = { [h]: h === "Forwarded" ? "for=203.0.113.9" : "203.0.113.9" };
      // Refused outright, before the key is asked for (owner 2026-11-13: never through a tunnel; was 401).
      expect([h, (await request(port, "GET", "/api/status", via)).status]).toEqual([h, 403]);
      const keyed = { ...via, [LAN_KEY_HEADER]: KEY, "Content-Type": "application/json" };
      expect([h, (await request(port, "POST", "/api/launcher/lan-access", keyed)).status]).toEqual([h, 403]);
      // Not even with the key (owner 2026-11-13: never through a tunnel); it was served before.
      expect([h, (await request(port, "GET", "/api/status", keyed)).status]).toEqual([h, 403]);
    }
  });

  it("gets nothing at all while LAN access is off", async () => {
    const port = await start(null, false);
    expect((await request(port, "GET", "/api/status")).status).toBe(200);
    expect((await request(port, "GET", "/api/status", { "CF-Connecting-IP": "203.0.113.9" })).status).toBe(403);
    expect(await socket(`ws://127.0.0.1:${port}/ws`)).toBe("open");
    const relayed = await new Promise<"open" | number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { "X-Forwarded-For": "203.0.113.9" } });
      closers.unshift(async () => ws.terminate());
      ws.once("open", () => resolve("open"));
      ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("error", () => resolve(0));
    });
    expect(relayed).toBe(403); // refused as relayed, before the key (was 401)
  });
});
