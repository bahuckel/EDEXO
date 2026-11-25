/**
 * The traits are handed out only when they were numbered by the bio-index that is held (2026-11-25). The galaxy-index
 * download carried the EDSM-merged index (5,406,581 systems) beside traits built for the one before (5,337,927): the
 * map's star and body ticks matched nothing while the drawer showed their counts, and the boxel table could read
 * another system's stars at the same ordinal.
 */
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listenLocal } from "./helpers/listenLocal.js";

const held = vi.hoisted(() => ({ index: null as { systemCount: number } | null }));
vi.mock("../src/server/bioIndex.js", async (original) => ({
  ...(await original<typeof import("../src/server/bioIndex.js")>()),
  peekBioIndex: () => held.index,
  loadBioIndexAsync: async () => held.index,
}));

const traitsMod = await import("../src/server/galaxyTraits.js");
const { clearSystemTraits, loadSystemTraits, loadSystemTraitsAsync, systemTraitsStale, TRAITS_MAGIC } = traitsMod;

/** A traits file of `n` systems (main star 0 for each), as scripts/build-system-traits.ts lays it out. */
function traitsFile(dir: string, n: number): string {
  const pad = (12 + n) % 4 ? 4 - ((12 + n) % 4) : 0;
  const buf = Buffer.alloc(12 + n + pad + n * 8);
  buf.write(TRAITS_MAGIC, 0, "ascii");
  buf.writeUInt32LE(n, 8);
  const f = path.join(dir, `traits-${n}.bin.gz`);
  writeFileSync(f, gzipSync(buf));
  return f;
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-traits-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  clearSystemTraits();
  held.index = null;
});

describe("traits and the bio-index they were made for", () => {
  it("are handed out when the held index has as many systems", async () => {
    held.index = { systemCount: 3 };
    const f = traitsFile(dir, 3);
    expect(loadSystemTraits(f)?.count).toBe(3);
    expect(systemTraitsStale()).toBe(false);
    clearSystemTraits();
    expect((await loadSystemTraitsAsync(f))?.count).toBe(3);
  });

  it("are withheld, and called stale, beside an index of another size", async () => {
    held.index = { systemCount: 4 };
    const f = traitsFile(dir, 3);
    expect(loadSystemTraits(f)).toBeNull();
    expect(systemTraitsStale()).toBe(true);
    clearSystemTraits();
    expect(await loadSystemTraitsAsync(f)).toBeNull();
  });

  it("follow the index held now: read before it loaded, checked again once it is there", () => {
    const f = traitsFile(dir, 3);
    expect(loadSystemTraits(f)?.count).toBe(3);
    held.index = { systemCount: 5 };
    expect(loadSystemTraits(f)).toBeNull();
    held.index = { systemCount: 3 };
    expect(loadSystemTraits(f)?.count).toBe(3);
  });
});

describe("/api/galaxy/traits", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const { registerGalaxyDataRoutes } = await import("../src/server/routes/galaxyDataRoutes.js");
    const app = express();
    registerGalaxyDataRoutes(app);
    ({ server, base } = await listenLocal(app));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("says stale, and offers no ticks, when the traits belong to another index", async () => {
    const spy = vi.spyOn(traitsMod, "systemTraitsStale").mockReturnValue(true);
    const load = vi.spyOn(traitsMod, "loadSystemTraits").mockReturnValue(null);
    try {
      const t = await (await fetch(`${base}/api/galaxy/traits`)).json();
      expect(t).toMatchObject({ available: false, reason: "stale", mainStars: [] });
    } finally {
      spy.mockRestore();
      load.mockRestore();
    }
  });
});
