/**
 * The 248 MB bio index is read once, off the server's thread (audit 2026-10-22).
 *
 * The galaxy routes and their helpers used to end in the synchronous loader, which stopped every window for the
 * whole read, and read the file a second time when an async read was already under way. The routes now await
 * the async read first; the synchronous loader, still called behind them, finds the index held. When it does
 * overtake a read in flight, that read is stopped and its callers get the one index.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ sync: 0, async: [] as (AbortSignal | undefined)[] }));
const isIndex = (f: unknown) => String(f).endsWith("bio-index.bin");

vi.mock("node:fs", async (orig) => {
  const real = await orig<typeof import("node:fs")>();
  return {
    ...real,
    readFileSync: ((...a: Parameters<typeof real.readFileSync>) => {
      if (isIndex(a[0])) reads.sync++;
      return real.readFileSync(...a);
    }) as typeof real.readFileSync,
  };
});
vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  return {
    ...real,
    readFile: ((...a: Parameters<typeof real.readFile>) => {
      if (isIndex(a[0])) reads.async.push((a[1] as { signal?: AbortSignal } | undefined)?.signal);
      return real.readFile(...a);
    }) as typeof real.readFile,
  };
});

const { clearBioIndexCache, loadBioIndex, loadBioIndexAsync } = await import("../src/server/bioIndex.js");
const { registerGalaxyRoutes } = await import("../src/server/routes/galaxyRoutes.js");
const { resolveUserSettingsJsonPath } = await import("../src/server/paths.js");

/** Two systems in the layout scripts/build-bio-index.ts writes (tests/bioIndex.test.ts has the long form). */
function writeIndex(file: string): void {
  const json = Buffer.from(JSON.stringify({ species: ["aleoida_aleoida_arcus"] }), "utf8");
  const head = Buffer.alloc(20);
  head.write("EDEXOBIO", 0, "ascii");
  head.writeUInt16LE(3, 8);
  head.writeUInt16LE(1, 10);
  head.writeUInt32LE(2, 12);
  head.writeUInt32LE(json.length, 16);
  const table = Buffer.alloc(2 * 25);
  table.writeBigUInt64LE(100n, 0);
  table.writeUInt8(1, 21);
  table.writeBigUInt64LE(200n, 25);
  writeFileSync(file, Buffer.concat([head, json, table, Buffer.from([0])]));
}

let dir: string;
let file: string;
const savedUserData = process.env.EDEXO_USER_DATA_DIR;
beforeAll(() => {
  // A user-data folder of this file's own: the routes find the index beside the settings, and no other file sees it.
  dir = mkdtempSync(path.join(tmpdir(), "edexo-bio-single-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
  const galaxyDir = path.join(path.dirname(resolveUserSettingsJsonPath()), "galaxy");
  mkdirSync(galaxyDir, { recursive: true });
  file = path.join(galaxyDir, "bio-index.bin");
  writeIndex(file);
});
afterAll(() => {
  clearBioIndexCache();
  if (savedUserData === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = savedUserData;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  clearBioIndexCache();
  reads.sync = 0;
  reads.async.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("one read of the bio index", () => {
  it("is shared by every caller that asks while it runs, and the synchronous loader behind them finds it held", async () => {
    const [a, b] = await Promise.all([loadBioIndexAsync(file), loadBioIndexAsync(file)]);
    expect(a?.systemCount).toBe(2);
    expect(b).toBe(a);
    expect(loadBioIndex(file)).toBe(a);
    expect(reads.async).toHaveLength(1);
    expect(reads.sync).toBe(0);
  });

  it("stops a read in flight when the synchronous loader overtakes it, and both get the same index", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const inFlight = loadBioIndexAsync(file);
    const now = loadBioIndex(file);
    expect(now?.systemCount).toBe(2);
    expect(reads.async[0]?.aborted).toBe(true);
    expect(await inFlight).toBe(now);
    // Stopped is not unreadable.
    expect(warn).not.toHaveBeenCalled();
    expect(reads.sync).toBe(1);
  });

  it("does not stop a read from before a clear: that caller still gets its own answer", async () => {
    const before = loadBioIndexAsync(file);
    clearBioIndexCache();
    const after = loadBioIndex(file);
    expect(reads.async[0]?.aborted).toBe(false);
    const old = await before;
    expect(old?.systemCount).toBe(2);
    expect(old).not.toBe(after);
  });
});

describe("the galaxy routes", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const app = express();
    registerGalaxyRoutes(
      app,
      {
        // As the app's own: the detail reads the index synchronously (edexoBootstrap.ts).
        getMySystem: (addr: number) => {
          const index = loadBioIndex();
          return index ? ({ addr, systems: index.systemCount } as never) : null;
        },
      } as never,
      { watchTopic: () => {}, topicsMayHaveChanged: () => {} } as never,
    );
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("read the index off the thread before a handler that reads it synchronously", async () => {
    const res = await fetch(`${base}/api/galaxy/mine/system?addr=5`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ addr: 5, systems: 2 });
    expect(reads.async).toHaveLength(1);
    expect(reads.sync).toBe(0);
    // And held for the next one.
    await (await fetch(`${base}/api/galaxy/mine/system?addr=6`)).arrayBuffer();
    expect(reads.async).toHaveLength(1);
    expect(reads.sync).toBe(0);
  });
});
