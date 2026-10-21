/** Search over saved sellers (the Search tab), a station's catalogue, and clearing saved data. */
import { promises as fs } from "node:fs";
import type { ClearBuyDataScope } from "../../../shared/colonize/buyIndexClear";
import { INARA_INDEX_REF } from "../../../shared/colonize/inaraImportTypes";
import {
  getBuyIndexStationCatalog as getMergedStationCatalog,
  searchBuyIndexMaterial,
  searchBuyIndexMaterialStations,
  searchBuyIndexStationsForMaterials,
  searchBuyIndexSystem,
} from "../buyIndexSearch";
import { deleteInaraImportJsonFiles, ensureInaraImportDir, watchedInaraImportDirs } from "../inaraImport";
import { cancelPassiveMaterialBuyScan } from "../materialBuyScanner";
import { spanshDebugJsonPath } from "./debugHandlers";
import { errMessage, type ColonizeHandlers, type IpcContext } from "./handlerTypes";
import { asRecord, trimmedString } from "./payload";

export function buyIndexHandlers({ store, buyIndex, userDataDir }: IpcContext) {
  /** Load the index, run a query over it, and turn a throw into the contract's failure shape. */
  const withIndex = async <T extends object>(run: (index: ReturnType<typeof buyIndex>) => T) => {
    try {
      const index = buyIndex();
      await index.load();
      return { ok: true as const, ...run(index) };
    } catch (e) {
      return { ok: false as const, err: errMessage(e) };
    }
  };

  const clearInaraDropFolders = async () => {
    for (const dir of await watchedInaraImportDirs(userDataDir)) {
      await ensureInaraImportDir(dir);
      await deleteInaraImportJsonFiles(dir);
    }
  };

  return {
    searchBuyIndexMaterial: async (payload) => {
      const q = trimmedString(asRecord(payload).query);
      if (!q) return { ok: false as const, err: "Enter a material name." };
      return withIndex((index) => ({ systems: searchBuyIndexMaterial(index, store.getJournalShopRecords(), q) }));
    },

    searchBuyIndexSystem: async (payload) => {
      const q = trimmedString(asRecord(payload).query);
      if (!q) return { ok: false as const, err: "Enter a system name." };
      return withIndex((index) => ({ stations: searchBuyIndexSystem(index, store.getJournalShopRecords(), q) }));
    },

    searchBuyIndexStationsForMaterials: async (payload) => {
      const p = asRecord(payload);
      const q = trimmedString(p.query);
      const systemName = trimmedString(p.systemName);
      if (!q) return { ok: false as const, err: "Enter a material name." };
      return withIndex((index) => ({
        stations: searchBuyIndexStationsForMaterials(index, store.getJournalShopRecords(), q, systemName || undefined),
      }));
    },

    searchBuyIndexMaterialStations: async (payload) => {
      if (!payload || typeof payload !== "object") return { ok: false as const, err: "Invalid payload." };
      const p = asRecord(payload);
      const systemName = trimmedString(p.systemName);
      const materialQuery = trimmedString(p.materialQuery);
      if (!systemName || !materialQuery) return { ok: false as const, err: "System and material required." };
      return withIndex((index) => ({
        stations: searchBuyIndexMaterialStations(index, store.getJournalShopRecords(), systemName, materialQuery),
      }));
    },

    getBuyIndexStationCatalog: async (payload) => {
      if (!payload || typeof payload !== "object") return { ok: false as const, err: "Invalid payload." };
      const p = asRecord(payload);
      const systemName = trimmedString(p.systemName);
      const stationName = trimmedString(p.stationName);
      const marketId = typeof p.marketId === "string" ? p.marketId : null;
      if (!systemName || !stationName) return { ok: false as const, err: "Station required." };
      return withIndex((index) => ({
        materials: getMergedStationCatalog(index, store.getJournalShopRecords(), systemName, stationName, marketId),
      }));
    },

    clearSavedBuyData: async (payload) => {
      /** No payload means everything — the default the preload used to supply. */
      const scopeRaw = payload && typeof payload === "object" ? asRecord(payload).scope : "all";
      const scope: ClearBuyDataScope =
        scopeRaw === "spansh" || scopeRaw === "visited" || scopeRaw === "inara" || scopeRaw === "all"
          ? scopeRaw
          : "all";
      try {
        const index = buyIndex();
        await index.load();
        if (scope === "all" || scope === "spansh") {
          cancelPassiveMaterialBuyScan();
          await fs.unlink(spanshDebugJsonPath()).catch(() => undefined);
        }
        if (scope === "all") {
          await index.clearAll();
          await store.clearJournalShopCache();
          await clearInaraDropFolders();
        } else if (scope === "spansh") {
          await index.clearBySources(["spansh"]);
        } else if (scope === "visited") {
          await store.clearJournalShopCache();
          await index.clearBySources(["journal"]);
        } else if (scope === "inara") {
          await index.clearBySources(["inara"], [INARA_INDEX_REF]);
          await clearInaraDropFolders();
        }
        return { ok: true as const, scope };
      } catch (e) {
        return { ok: false as const, err: errMessage(e) };
      }
    },
  } satisfies Partial<ColonizeHandlers>;
}
