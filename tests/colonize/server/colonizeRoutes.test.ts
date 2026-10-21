/**
 * The Colonize window's routes (1.3.0): one per contract method, read-only ones for a paired phone, the service
 * started by the first request with EDEXO's journal folder, and its pushes on the `colonize` socket channel only.
 */
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createHttpServer } from "../../../src/server/httpServer.js";
import { colonizeMethodAccess, COLONIZE_LAN_READ } from "../../../src/server/routes/colonizeRoutes.js";
import { colonizeServiceRunning, stopColonizeService } from "../../../src/server/colonize/colonizeService";
import { COLONIZE_EVENTS, COLONIZE_INVOKE } from "../../../src/shared/colonize/ipc/contract";
import type { AppSnapshot } from "../../../src/shared/types.js";

const journalDir = mkdtempSync(path.join(tmpdir(), "colonize-routes-j-"));
// Its own user-data folder: the saved settings (ui-state.json) must start empty on every run.
const savedUserData = process.env.EDEXO_USER_DATA_DIR;
const userData = mkdtempSync(path.join(tmpdir(), "colonize-routes-u-"));
process.env.EDEXO_USER_DATA_DIR = userData;
afterAll(async () => {
  await stopColonizeService();
  if (savedUserData === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = savedUserData;
  rmSync(journalDir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

describe("the Colonize contract", () => {
  it("names exactly these methods and events (the window's client is built from the same list)", () => {
    expect(Object.keys(COLONIZE_INVOKE).sort()).toEqual(
      [
        "checkoutBasket",
        "checkoutBasketMulti",
        "clearSavedBuyData",
        "debugSpanshSystem",
        "getBuyIndexStationCatalog",
        "getDebugJson",
        "getDepotMaterialListings",
        "getInaraImportDir",
        "getMaterialBuyScanStatus",
        "getSnapshot",
        "importInaraFile",
        "lookUpPartyCarriers",
        "lookupSiteNeeds",
        "openInaraImportDir",
        "plannerMaterialsAtCap",
        "readMarketSupplyBrief",
        "replayWeek",
        "resolveSystemCoords",
        "resolveSystemDistances",
        "scheduleActiveBasketScan",
        "schedulePlannerMaterialScan",
        "searchBuyIndexMaterial",
        "searchBuyIndexMaterialStations",
        "searchBuyIndexStationsForMaterials",
        "searchBuyIndexSystem",
        "searchConstructionSites",
        "setBasketBlocksPassive",
        "setDepotArchived",
        "setInaraImportDir",
        "syncWingCargoFromEdsm",
      ].sort(),
    );
    expect(Object.keys(COLONIZE_EVENTS).sort()).toEqual(["onInaraImport", "onMaterialBuyScanStatus", "onUiState", "onUpdate"]);
  });

  it("lets a paired phone read, and keeps writes, network look-ups and files to the PC", () => {
    expect(colonizeMethodAccess("getSnapshot")).toBe("lan");
    expect(colonizeMethodAccess("searchBuyIndexMaterial")).toBe("lan");
    for (const m of ["setDepotArchived", "checkoutBasket", "lookupSiteNeeds", "importInaraFile", "setInaraImportDir", "syncWingCargoFromEdsm", "getDebugJson"])
      expect(colonizeMethodAccess(m)).toBe("local");
    expect(colonizeMethodAccess("windowClose")).toBe("unknown");
    expect(colonizeMethodAccess("__proto__")).toBe("unknown");
    for (const m of COLONIZE_LAN_READ) expect(m.startsWith("get") || m.startsWith("search") || m.startsWith("read")).toBe(true);
  });
});

describe("the routes and the socket", () => {
  it("starts on the first request, uses EDEXO's journal folder, and pushes to Colonize sockets only", async () => {
    const { server, listening } = createHttpServer({
      port: 0,
      bindHost: "127.0.0.1",
      getSnapshot: () => ({ port: 1, commanderName: "Test", bodies: [] }) as unknown as AppSnapshot,
      getStatus: () => ({}) as never,
      getCommanderPosition: () => null,
      getCommanderSystem: () => null,
      getJournalDir: () => journalDir,
      getJournalStore: () =>
        ({ ownAssets: { colonies: [{ name: "Swoilz KI-E b4-9", addr: 20464042518049, at: "2026-05-15T19:04:23Z" }] } }) as never,
    });
    await listening;
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const sockets: WebSocket[] = [];
    try {
      const open = async (channel: string) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        sockets.push(ws);
        const msgs: Record<string, unknown>[] = [];
        ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
        await new Promise((r) => ws.once("open", r));
        ws.send(JSON.stringify({ type: "hello", channel }));
        return msgs;
      };
      const colonize = await open("colonize");
      const app = await open("app");

      expect(colonizeServiceRunning()).toBe(false);
      const unknown = await fetch(`${base}/api/colonize/rpc/windowClose`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      expect(unknown.status).toBe(404);

      const r = await fetch(`${base}/api/colonize/rpc/getSnapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ args: [] }),
      });
      const j = (await r.json()) as { ok: boolean; result: { journalDir: string; activeDepots: unknown[] } };
      expect(j.ok).toBe(true);
      expect(j.result.journalDir).toBe(journalDir);
      // The commander's colonies come from EDEXO's journal store (shared/ownAssets.ts).
      expect((j.result as unknown as { ownColonies: unknown }).ownColonies).toEqual([
        { name: "Swoilz KI-E b4-9", systemAddress: 20464042518049, claimedAt: "2026-05-15T19:04:23Z" },
      ]);
      expect(colonizeServiceRunning()).toBe(true);

      // The background start ends with a snapshot push (debounced ~0.9 s).
      for (let i = 0; i < 40 && !colonize.some((m) => m.type === "colonize"); i++) await new Promise((r) => setTimeout(r, 100));
      expect(colonize.find((m) => m.type === "colonize")).toMatchObject({ event: "onUpdate" });
      expect(app.some((m) => m.type === "colonize")).toBe(false);
      // The Colonize socket's state is the small slice, not the app's snapshot.
      const state = colonize.filter((m) => m.type === "state" && m.channel === "colonize").at(-1);
      expect(Object.keys((state?.payload as object) ?? {}).sort()).toEqual(expect.arrayContaining(["commanderName", "port"]));
      expect((state?.payload as Record<string, unknown>).bodies).toBeUndefined();

      // Settings and progress (phase 5): saved, read back, pushed to the other windows with who saved them.
      const TRIPS = "edexo-colonize-trip-plan-snapshot-v3";
      const ui0 = (await (await fetch(`${base}/api/colonize/ui-state`)).json()) as { ok: boolean; values: object; seeded: boolean };
      expect(ui0).toEqual({ ok: true, values: {}, seeded: false });
      const put = await fetch(`${base}/api/colonize/ui-state`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ set: { [TRIPS]: "ticks", "not-a-key": "x" }, from: "w1" }),
      });
      expect(await put.json()).toEqual({ ok: true, changed: 1 });
      const ui1 = (await (await fetch(`${base}/api/colonize/ui-state`)).json()) as { values: object; seeded: boolean };
      expect(ui1).toMatchObject({ values: { [TRIPS]: "ticks" }, seeded: true });
      for (let i = 0; i < 20 && !colonize.some((m) => m.event === "onUiState"); i++) await new Promise((r) => setTimeout(r, 50));
      expect(colonize.find((m) => m.event === "onUiState")?.payload).toEqual({ set: { [TRIPS]: "ticks" }, from: "w1" });
      expect(app.some((m) => m.event === "onUiState")).toBe(false);
    } finally {
      for (const ws of sockets) ws.close();
      await new Promise((r) => server.close(() => r(null)));
    }
  });
});
