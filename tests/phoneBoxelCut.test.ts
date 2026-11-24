/**
 * A saved boxel's systems are dropped on the PC running the app only (review 2026-11-10 C3; owner 2026-11-13: the
 * phone is a window). The cut was guarded; "-n+1 isn't in the map" (`lastIs`) below the end drops the systems after it
 * the same way and was not (lan write-route audit 2026-11-24). Another device asks through the assembled server, its
 * socket's address set to a LAN one as in lanAuthAssembled.test.ts.
 */
import type { AddressInfo } from "node:net";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer } from "../src/server/httpServer.js";
import { LAN_KEY_HEADER } from "../src/server/lanAuth.js";
import { createSavedBoxels } from "../src/server/savedBoxels.js";
import type { AppSnapshot } from "../src/shared/types.js";

const KEY = "test-lan-key-0123456789";
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function start(fromPhone: boolean) {
  const boxels = createSavedBoxels({ filePath: null });
  const { id } = boxels.add("Eol Prou AB-C d1-9")!;
  const { server, listening } = createHttpServer({
    port: 0,
    bindHost: "127.0.0.1",
    lanKey: KEY,
    savedBoxels: boxels,
    getSnapshot: () => ({ port: 7111 }) as unknown as AppSnapshot,
    getStatus: () => ({ ok: true }) as never,
    getCommanderPosition: () => null,
    getCommanderSystem: () => null,
  });
  if (fromPhone)
    server.prependListener("connection", (s) => Object.defineProperty(s, "remoteAddress", { value: "192.168.1.50" }));
  await listening;
  closers.push(() => new Promise((r) => server.close(() => r())));
  const port = (server.address() as AddressInfo).port;
  const patch = (body: unknown) =>
    new Promise<number>((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method: "PATCH",
          path: `/api/boxels/${id}`,
          headers: { Host: `127.0.0.1:${port}`, "Content-Type": "application/json", [LAN_KEY_HEADER]: KEY },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(data);
    });
  const end = () => boxels.list([])[0]!.end;
  return { patch, end };
}

describe("a saved boxel's end, from a paired phone", () => {
  it("cannot be moved below the end, by a cut or by the galaxy-map probe", async () => {
    const { patch, end } = await start(true);
    expect(await patch({ cutFrom: 5 })).toBe(403);
    expect(await patch({ lastIs: 5 })).toBe(403);
    expect(end()).toBe(9);
  });

  it("can still confirm the end the probe's button sends, and skip a system", async () => {
    const { patch, end } = await start(true);
    expect(await patch({ lastIs: 9 })).toBe(200);
    expect(await patch({ skip: 3 })).toBe(200);
    expect(end()).toBe(9);
  });
});

describe("a saved boxel's end, on the PC", () => {
  it("moves below the end with the probe", async () => {
    const { patch, end } = await start(false);
    expect(await patch({ lastIs: 5 })).toBe(200);
    expect(end()).toBe(5);
  });
});
