/**
 * What Colonize keeps (1.3.0 audit, owner 2026-10-22: "calculations, setup and everything should be saved", "a system
 * found once should be remembered"): Spansh's seller positions and spellings survive a restart, an unreadable file is
 * kept aside instead of erased, a clean-up is not taken for a fresh scan, and nothing is rewritten when nothing changed.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJsonKeepingCorrupt } from "../../../src/server/colonize/jsonFs";
import { MaterialBuyIndex } from "../../../src/server/colonize/materialBuyIndex";
import { ColonizeUiState } from "../../../src/server/colonize/uiState";
import { colonizeSnapshotNotifySig } from "../../../src/server/colonize/ipc/snapshotNotify";
import { pruneBuyIndexBySources } from "../../../src/shared/colonize/buyIndexClear";
import { applyShopDistanceLyToJournalRecords, type JournalShopRecord } from "../../../src/shared/colonize/journalShopHistory";
import { galaxyDistancePairKey } from "../../../src/shared/colonize/systemDistanceLy";
import type { MaterialBuyStationHit } from "../../../src/shared/colonize/materialBuyIndexTypes";
import type { ColonizeSnapshot } from "../../../src/shared/colonize/types";

let dir: string;
beforeEach(async () => {
  vi.resetModules();
  dir = await mkdtemp(path.join(tmpdir(), "remembered-"));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

describe("systems Spansh named once", () => {
  it("keeps a seller's position and Spansh's spelling across a restart, so neither is asked for again", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify([]), { status: 200 });
    });
    let mod = await import("../../../src/server/colonize/galaxySystemCoords");
    void mod.loadSystemCoordsCache(dir);
    mod.rememberSystemFromSpansh("HIP 12345", [1, 2, 3]);
    mod.rememberSystemFromSpansh("Col 285 Sector AB-C d1-2", ["x", 2, 3]); // a spelling without a position
    await mod.flushSystemCoordsCache();
    const saved = JSON.parse(await readFile(path.join(dir, "system-coords.json"), "utf8"));
    expect(saved.systems).toEqual({ "hip 12345": [1, 2, 3] });
    expect(saved.names).toEqual({ "hip 12345": "HIP 12345", "col 285 sector ab-c d1-2": "Col 285 Sector AB-C d1-2" });

    vi.resetModules();
    mod = await import("../../../src/server/colonize/galaxySystemCoords");
    void mod.loadSystemCoordsCache(dir);
    expect((await mod.resolveCoordMapForSystems(["hip 12345"])).get("hip 12345")).toEqual([1, 2, 3]);
    expect(await mod.resolveSpanshReferenceSystem("col 285 sector ab-c d1-2")).toBe("Col 285 Sector AB-C d1-2");
    expect(mod.resolveSpanshReferenceSystemLocal("hip 12345")).toBe("HIP 12345");
    expect(calls).toEqual([]);
    expect(mod.peekSystemCoords("HIP 12345")).toEqual([1, 2, 3]);
    expect(mod.peekSystemCoords("Nowhere")).toBeNull();
  });
});

describe("a file that does not parse", () => {
  it("is copied aside before starting empty; a missing file is not", async () => {
    const f = path.join(dir, "state.json");
    expect(await readJsonKeepingCorrupt(f, null)).toEqual({ value: null, corrupt: false });
    await writeFile(f, "{ torn");
    expect(await readJsonKeepingCorrupt(f, null)).toEqual({ value: null, corrupt: true });
    expect(await readFile(`${f}.bak-corrupt`, "utf8")).toBe("{ torn");
  });

  it("keeps the buy index's Inara imports and the window's ticks aside too", async () => {
    await writeFile(path.join(dir, "material-buy-index.json"), "{ torn index");
    const index = new MaterialBuyIndex(dir);
    await index.load();
    expect(index.allReferenceKeys()).toEqual([]);
    expect(await readFile(path.join(dir, "material-buy-index.json.bak-corrupt"), "utf8")).toBe("{ torn index");

    const ui = path.join(dir, "ui-state.json");
    await writeFile(ui, "{ torn ui");
    expect(new ColonizeUiState(ui).all()).toEqual({});
    expect(await readFile(`${ui}.bak-corrupt`, "utf8")).toBe("{ torn ui");

    // No file at all: nothing to keep.
    const empty = await mkdtemp(path.join(tmpdir(), "remembered-empty-"));
    await new MaterialBuyIndex(empty).load();
    expect((await readdir(empty)).filter((n) => n.includes("bak"))).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });
});

const hit = (source: MaterialBuyStationHit["dataSource"], station: string): MaterialBuyStationHit => ({
  systemName: "Sol",
  stationName: station,
  marketId: "",
  distanceLy: 10,
  buyPrice: 100,
  supply: 50,
  spanshCommodity: "Steel",
  dataSource: source,
  foundAtIso: "2026-08-26T00:00:00.000Z",
});

describe("cleaning saved sellers", () => {
  it("does not make an old row look freshly scanned", () => {
    const old = "2026-08-26T00:00:00.000Z";
    const { systems } = pruneBuyIndexBySources(
      { sol: { steel: { commodityId: "steel", label: "Steel", updatedAtIso: old, stations: [hit("spansh", "A"), hit("inara", "B")] } } },
      new Set(["spansh"]),
    );
    expect(systems.sol!.steel!.updatedAtIso).toBe(old);
  });
});

describe("work that changes nothing", () => {
  it("reports whether a shop's distance changed, so an unchanged batch saves nothing", () => {
    const shops = new Map<string, JournalShopRecord>([
      ["9", { marketId: "9", stationName: "Port", starSystem: "Far", stationType: null, visitedAt: "", purchases: [], marketItems: [], constructionDistanceLy: null } as unknown as JournalShopRecord],
    ]);
    const d = { [galaxyDistancePairKey("Home", "Far")]: 12.5 };
    expect(applyShopDistanceLyToJournalRecords(shops, d, ["Home"])).toBe(true);
    expect(applyShopDistanceLyToJournalRecords(shops, d, ["Home"])).toBe(false);
    expect(shops.get("9")!.constructionDistanceLy).toBe(12.5);
  });

  it("pushes a cargo change that came within the same second", () => {
    const base = {
      journalDir: null,
      navContext: { starSystem: null, systemAddress: null },
      activeDepots: [],
      liveDocked: null,
      shipCargoTimestamp: "2026-10-22T10:00:00Z",
      shipCargoCapacity: 80,
      dockMarket: null,
      journalShopHistory: [],
      replayBusy: false,
      wingRoster: [],
      carriers: [],
      lastError: null,
      ownColonies: [],
    };
    const a = { ...base, shipCargo: [{ name: "steel", nameLocalised: "Steel", count: 50 }] } as unknown as ColonizeSnapshot;
    const b = { ...base, shipCargo: [{ name: "steel", nameLocalised: "Steel", count: 100 }] } as unknown as ColonizeSnapshot;
    expect(colonizeSnapshotNotifySig(a)).not.toBe(colonizeSnapshotNotifySig(b));
  });
});
