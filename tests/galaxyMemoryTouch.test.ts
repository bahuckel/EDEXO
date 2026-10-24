/**
 * Which galaxy requests keep the map's memory alive (code review, 2026-10-14). The map's route and
 * own-assets polls reset the idle clock every 30-60 s, so with a map tab open, in front or behind
 * others, the bio index, overview and tile index were never let go. Requests that read only the
 * journal store (or the download's status) no longer touch it; those that read a registered cache do.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerGalaxyRoutes } from "../src/server/routes/galaxyRoutes.js";
import { galaxyMemoryState } from "../src/server/galaxyMemory.js";
import { loadBioIndex } from "../src/server/bioIndex.js";

let server: Server;
let base: string;
beforeAll(async () => {
  /*
    /mine/system reads the bio index before asking the store (audit 2026-10-22). Held as "none" here, so a test
    never reads the 245 MB file where a clone has it.
  */
  loadBioIndex(path.join(tmpdir(), "edexo-no-such-bio-index.bin"));
  const app = express();
  const store = { systemPositions: new Map(), ownAssets: { carrier: null, colonies: [] } };
  registerGalaxyRoutes(
    app,
    {
      getSessionRoute: () => ({ route: [], position: null, mineRev: 0 }),
      getVisitedSystems: () => ({ systems: [] }),
      getMySystems: () => ({ systems: [] }),
      getMySystem: () => null,
      getCommanderSectors: () => ({ sectors: [] }),
      getJournalStore: () => store,
    } as never,
    { watchTopic: () => {}, topicsMayHaveChanged: () => {} } as never,
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const touchedBy = async (p: string) => {
  const before = galaxyMemoryState().lastTouch;
  await new Promise((r) => setTimeout(r, 5));
  await (await fetch(base + p)).arrayBuffer();
  return galaxyMemoryState().lastTouch !== before;
};

describe("the galaxy map's idle clock", () => {
  it("is not reset by the journal-only polls", async () => {
    for (const p of ["/api/galaxy/route", "/api/galaxy/own", "/api/galaxy/visited", "/api/galaxy/mine", "/api/galaxy/my-sectors"]) {
      expect(await touchedBy(p), p).toBe(false);
    }
  });

  it("is reset by the requests that read the map's data", async () => {
    // (Neither reads the index: it is held as "none" above.)
    for (const p of ["/api/galaxy/mine/system?addr=1", "/api/galaxy/layers?kind=poi"]) {
      expect(await touchedBy(p), p).toBe(true);
    }
  });
});
