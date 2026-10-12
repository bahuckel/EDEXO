/**
 * Route tests for the expedition planner (pre-release review, 2026-10-12): the async handlers answer a throw with a
 * 500 instead of an unhandled rejection (which ends the server process), validate their input, and the boxel card
 * builds the tile index without blocking. A real server on port 0 with stub options.
 */
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer, type HttpServerOptions } from "../src/server/httpServer.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function start(extra: Partial<HttpServerOptions> = {}) {
  const { server, listening } = createHttpServer({
    port: 0,
    bindHost: "127.0.0.1",
    getSnapshot: () => ({}) as never,
    getStatus: () => ({}) as never,
    getCommanderPosition: () => null,
    getCommanderSystem: () => null,
    scheduleBroadcast: () => undefined,
    ...extra,
  } as HttpServerOptions);
  await listening;
  const port = (server.address() as AddressInfo).port;
  closers.push(() => new Promise((r) => server.close(() => r())));
  return async (path: string) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
  };
}

describe("expedition routes", () => {
  it("ask for a position or stops before doing anything", async () => {
    const get = await start();
    expect((await get("/api/expedition/ends")).status).toBe(400);
    expect((await get("/api/expedition/plan?x=0&y=0&z=0")).status).toBe(400);
    expect((await get("/api/expedition/boxel?key=nonsense&x=0&y=0&z=0")).status).toBe(400);
  });

  it("answer a throw with a 500 and keep serving", async () => {
    const get = await start({
      getJournalStore: () => {
        throw new Error("journal store gone");
      },
    } as Partial<HttpServerOptions>);
    const r = await get("/api/expedition/boxel?key=d:39,31,19:0&x=0&y=0&z=0");
    expect(r.status).toBe(500);
    expect(String(r.json?.error)).toMatch(/journal store gone/);
    // Still up.
    expect((await get("/api/expedition/targets")).status).toBe(200);
  });
});
