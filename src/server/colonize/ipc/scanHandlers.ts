/** Background Spansh scans that fill the buy index: status, scheduling, and "are we done yet". */
import { itemLabel } from "../../../shared/colonize/commodityKey";
import { getMaterialBuyScanStatus } from "../materialBuyScanHub";
import {
  cancelPassiveMaterialBuyScan,
  scheduleActiveMaterialBuyScan,
  schedulePassiveMaterialBuyScan,
  setBasketBlocksPassiveScan,
} from "../materialBuyScanner";
import { errMessage, type ColonizeHandlers, type IpcContext } from "./handlerTypes";
import { asRecord, parseCheckoutItems, parseConstructionDepots, parseSystemNames } from "./payload";

const itemRows = (items: ReturnType<typeof parseCheckoutItems>) =>
  items.map((it) => ({ id: it.id, label: itemLabel(it) }));

export function scanHandlers({ store, buyIndex }: IpcContext) {
  return {
    getMaterialBuyScanStatus: () => getMaterialBuyScanStatus(),

    setBasketBlocksPassive: (payload) => {
      setBasketBlocksPassiveScan(asRecord(payload).block === true);
      return { ok: true as const };
    },

    scheduleActiveBasketScan: async (payload) => {
      if (!payload || typeof payload !== "object") return { ok: false as const, err: "Invalid payload." };
      const p = asRecord(payload);
      const ref = typeof p.referenceSystem === "string" ? p.referenceSystem.trim() : "";
      if (!ref) return { ok: false as const, err: "Reference system required." };
      const items = parseCheckoutItems(p.items);
      if (!items.length) return { ok: false as const, err: "No basket items." };
      try {
        scheduleActiveMaterialBuyScan({
          index: buyIndex(),
          referenceSystem: ref,
          items,
          constructionDepots: parseConstructionDepots(store.getSnapshot().activeDepots ?? []),
        });
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, err: errMessage(e) };
      }
    },

    plannerMaterialsAtCap: async (payload) => {
      if (!payload || typeof payload !== "object") return { ok: false as const, err: "Invalid payload." };
      const p = asRecord(payload);
      const maxSystems =
        typeof p.maxSystemsPerMaterial === "number" && p.maxSystemsPerMaterial > 0
          ? Math.floor(p.maxSystemsPerMaterial)
          : 0;
      const referenceSystems = parseSystemNames(p.referenceSystems);
      const items = itemRows(parseCheckoutItems(p.items));
      const constructionDepots = parseConstructionDepots(p.constructionDepots);
      if (!referenceSystems.length || !items.length) return { ok: true as const, atCap: false, allFound: false };
      try {
        const index = buyIndex();
        await index.load();
        const allFound = index.allMaterialsHaveBuyStations(referenceSystems, items, constructionDepots);
        const atCap = maxSystems
          ? index.allMaterialsAtSystemCap(referenceSystems, items, maxSystems, constructionDepots)
          : false;
        return { ok: true as const, atCap, allFound };
      } catch (e) {
        return { ok: false as const, err: errMessage(e) };
      }
    },

    schedulePlannerMaterialScan: async (payload) => {
      if (!payload || typeof payload !== "object") return { ok: false as const, err: "Invalid payload." };
      const p = asRecord(payload);
      const maxSystems =
        typeof p.maxSystemsPerMaterial === "number" && p.maxSystemsPerMaterial > 0
          ? Math.floor(p.maxSystemsPerMaterial)
          : null;
      const referenceSystems = parseSystemNames(p.referenceSystems);
      const items = parseCheckoutItems(p.items);
      const constructionDepots = parseConstructionDepots(p.constructionDepots);
      if (!referenceSystems.length || !items.length) {
        return { ok: false as const, err: "No reference systems or materials." };
      }
      try {
        const index = buyIndex();
        await index.load();
        const rows = itemRows(items);
        const force = p.force === true;
        if (!force && index.allMaterialsHaveBuyStations(referenceSystems, rows, constructionDepots)) {
          cancelPassiveMaterialBuyScan();
          return { ok: true as const, scheduled: false, atCap: true, allFound: true };
        }
        if (!force && maxSystems != null && index.allMaterialsAtSystemCap(referenceSystems, rows, maxSystems, constructionDepots)) {
          cancelPassiveMaterialBuyScan();
          return { ok: true as const, scheduled: false, atCap: true, allFound: false };
        }
        const seen = new Set<string>();
        for (const ref of referenceSystems) {
          const k = ref.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          schedulePassiveMaterialBuyScan({
            index,
            referenceSystem: ref,
            items,
            maxSystemsPerMaterial: maxSystems,
            constructionDepots,
          });
        }
        return { ok: true as const, scheduled: true, atCap: false, allFound: false };
      } catch (e) {
        return { ok: false as const, err: errMessage(e) };
      }
    },
  } satisfies Partial<ColonizeHandlers>;
}
