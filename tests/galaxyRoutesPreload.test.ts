/**
 * A galaxy request waits for the tile index or the traits only when it reads them (2026-10-26). Every request used
 * to wait for both, so the sector map's search panel asking for its region list loaded ~360 MB it never read and
 * held it for five idle minutes (measured on a copy of the owner's profile: /regions 860 ms → 3 ms, nothing held).
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const loads = vi.hoisted(() => ({ tiles: 0, traits: 0 }));
vi.mock("../src/server/galaxyTiles.js", async (original) => ({
  ...(await original<typeof import("../src/server/galaxyTiles.js")>()),
  tileIndexAsync: async () => {
    loads.tiles++;
    return null;
  },
  tileIndex: () => null,
}));
vi.mock("../src/server/galaxyTraits.js", async (original) => ({
  ...(await original<typeof import("../src/server/galaxyTraits.js")>()),
  loadSystemTraitsAsync: async () => {
    loads.traits++;
    return null;
  },
  loadSystemTraits: () => null,
}));

const { registerGalaxyRoutes } = await import("../src/server/routes/galaxyRoutes.js");
const { loadBioIndex } = await import("../src/server/bioIndex.js");

let server: Server;
let base: string;
beforeAll(async () => {
  // Held as "none", so no request reads the 245 MB index where a clone has it.
  loadBioIndex(path.join(tmpdir(), "edexo-no-such-bio-index.bin"));
  const app = express();
  registerGalaxyRoutes(
    app,
    {
      getGalaxyRegions: () => ({ available: false, regions: [], systemCount: 0, bodyCount: 0, fileBytes: 0 }),
      getJournalStore: () => null,
    } as never,
    { watchTopic: () => {}, topicsMayHaveChanged: () => {} } as never,
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  loads.tiles = 0;
  loads.traits = 0;
});

const ask = async (p: string) => void (await (await fetch(base + p)).arrayBuffer());

describe("what a galaxy request waits for", () => {
  it("the region list loads neither the tile index nor the traits", async () => {
    await ask("/api/galaxy/regions");
    expect(loads).toEqual({ tiles: 0, traits: 0 });
  });

  it("the tile requests wait for the tile index, and only for it", async () => {
    for (const p of ["/api/galaxy/cells", "/api/galaxy/sector-names", "/api/galaxy/tile?c=0,0,0", "/api/galaxy/find?q=Sol"]) await ask(p);
    expect(loads).toEqual({ tiles: 4, traits: 0 });
  });

  it("the traits wait for the traits, and only for them", async () => {
    await ask("/api/galaxy/traits");
    expect(loads).toEqual({ tiles: 0, traits: 1 });
  });
});
