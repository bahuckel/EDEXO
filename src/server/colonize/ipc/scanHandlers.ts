/** Background Spansh scans that fill the buy index: status, scheduling, and "are we done yet". */
import { basketItemId, itemLabel } from "../../../shared/colonize/commodityKey";
import { isConstructionDepotStation } from "../../../shared/colonize/constructionDepot";
import type { JournalShopRecord } from "../../../shared/colonize/journalShopHistory";
import { collectPlannerNeeds } from "../../../shared/colonize/planner/needs";
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

/**
 * The journal's markets worth reading whole (spanshStationMarket.ts): the ones that sold something the sites need,
 * then the rest, nearest to the sites first. Construction sites never sell.
 */
export function journalMarketIdsForScan(
  shops: JournalShopRecord[],
  items: ReturnType<typeof parseCheckoutItems>,
  depots: ReturnType<typeof parseConstructionDepots>,
): string[] {
  const wanted = new Set(items.map((it) => basketItemId(it)).filter(Boolean));
  const sold = (s: JournalShopRecord) =>
    s.purchases.some((p) => wanted.has(p.commodityId)) || (s.marketItems ?? []).some((o) => o.supply > 0 && wanted.has(o.commodityId));
  const ly = (s: JournalShopRecord) => (typeof s.constructionDistanceLy === "number" ? s.constructionDistanceLy : Number.POSITIVE_INFINITY);
  return shops
    .filter((s) => s.marketId && !isConstructionDepotStation(depots, { systemName: s.starSystem, stationName: s.stationName, marketId: s.marketId, stationType: s.stationType }))
    .sort((a, b) => Number(sold(b)) - Number(sold(a)) || ly(a) - ly(b))
    .map((s) => s.marketId);
}

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
        const active = store.getSnapshot().activeDepots ?? [];
        scheduleActiveMaterialBuyScan({
          index: buyIndex(),
          referenceSystem: ref,
          items,
          constructionDepots: parseConstructionDepots(active),
          // The answer for one material carries whole markets: keep everything the sites need from it.
          alsoFor: [...collectPlannerNeeds(active, new Map(), []).entries()].map(([id, n]) => ({
            id,
            name: n.label,
            nameLocalised: n.label,
            quantityTons: n.tons,
          })),
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
            // "Look now" asked for a look: it was dropped here, so a material with any journal seller nearby was never
            // searched and the index kept no Spansh seller at all (owner's profile, 2026-10-23).
            force,
            marketIds: journalMarketIdsForScan(store.getJournalShopRecords(), items, constructionDepots),
          });
        }
        return { ok: true as const, scheduled: true, atCap: false, allFound: false };
      } catch (e) {
        return { ok: false as const, err: errMessage(e) };
      }
    },
  } satisfies Partial<ColonizeHandlers>;
}
