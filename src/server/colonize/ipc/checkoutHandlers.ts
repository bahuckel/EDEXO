/** The buying list: checkout over the buy index, per-material listings, and distances. */
import { resolveCoordMapForSystems, resolveSystemDistanceMap } from "../galaxySystemCoords";
import { buildPlanMaterialListingsFromIndex } from "../planMaterialListings";
import { runBasketCheckout } from "../spanshCheckout";
import { errMessage, type ColonizeHandlers, type IpcContext } from "./handlerTypes";
import {
  asRecord,
  parseCheckoutItems,
  parseCheckoutRequest,
  parseConstructionDepots,
  parseDistanceBySystem,
  parseSystemNames,
} from "./payload";

/** Same bound as a distance request: a cold look-up of this many is a few EDSM batches. */
const COORDS_REQUEST_CAP = 400;

export function checkoutHandlers({ store, buyIndex }: IpcContext) {
  return {
    resolveSystemDistances: async (payload) => {
      if (!payload || typeof payload !== "object") return { ok: false as const, err: "Invalid payload." };
      const p = asRecord(payload);
      /** Untrimmed on purpose, as before: the pair keys are built from the names as sent. */
      const names = (raw: unknown) =>
        Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
      const fromSystems = names(p.fromSystems);
      const toSystems = names(p.toSystems);
      if (!fromSystems.length || !toSystems.length) {
        return { ok: true as const, distances: {} as Record<string, number> };
      }
      try {
        const distances = await resolveSystemDistanceMap(fromSystems, toSystems);
        if (Object.keys(distances).length) store.applyJournalShopDistances(distances, fromSystems);
        return { ok: true as const, distances };
      } catch (e) {
        return { ok: false as const, err: errMessage(e) };
      }
    },

    /** S-13: the planner measures seller-to-seller legs from these. */
    resolveSystemCoords: async (payload) => {
      const systems = parseSystemNames(asRecord(payload).systems).slice(0, COORDS_REQUEST_CAP);
      try {
        const coords = await resolveCoordMapForSystems(systems);
        return { ok: true as const, coords: Object.fromEntries(coords) };
      } catch (e) {
        return { ok: false as const, err: errMessage(e) };
      }
    },

    getDepotMaterialListings: async (payload) => {
      if (!payload || typeof payload !== "object") return { ok: false as const, err: "Invalid payload." };
      const p = asRecord(payload);
      const referenceSystem = typeof p.referenceSystem === "string" ? p.referenceSystem.trim() : "";
      const distanceOrigin = typeof p.distanceOrigin === "string" ? p.distanceOrigin.trim() : referenceSystem;
      const needsRaw = Array.isArray(p.needs) ? p.needs : [];
      const needs = needsRaw
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const r = row as { id?: unknown; label?: unknown; quantityTons?: unknown };
          const id = typeof r.id === "string" ? r.id.trim() : "";
          const label = typeof r.label === "string" ? r.label.trim() : id;
          const quantityTons =
            typeof r.quantityTons === "number" && Number.isFinite(r.quantityTons)
              ? Math.max(1, Math.ceil(r.quantityTons))
              : 1;
          if (!id) return null;
          return { id, label, quantityTons };
        })
        .filter((n): n is { id: string; label: string; quantityTons: number } => n != null);
      if (!referenceSystem || !needs.length) {
        return { ok: false as const, err: "Reference system and materials required." };
      }
      const constructionDepots = parseConstructionDepots(p.constructionDepots);
      const distanceBySystem = parseDistanceBySystem(p.distanceBySystem);
      try {
        const index = buyIndex();
        await index.load();
        index.sanitizeSellHits();
        if (constructionDepots.length) index.purgeConstructionDepotStations(constructionDepots);
        const listings = buildPlanMaterialListingsFromIndex({
          index,
          journalShops: store.getJournalShopRecords(),
          needs,
          referenceSystem,
          distanceOrigin,
          distanceBySystem,
          constructionDepots,
        });
        return { ok: true as const, listings };
      } catch (e) {
        return { ok: false as const, err: errMessage(e) };
      }
    },

    /** Batched cache-only checkout: one request for all construction refs (instead of one per ref). */
    checkoutBasketMulti: async (payload) => {
      if (!payload || typeof payload !== "object") return { ok: false as const, err: "Invalid payload." };
      const p = asRecord(payload);
      const { journalDir, filters, routingMode, skipCache, forceLiveScan, cacheOnly } = parseCheckoutRequest(p);
      const refs = parseSystemNames(p.referenceSystems);
      if (!refs.length) return { ok: false as const, err: "No reference systems." };
      const items = parseCheckoutItems(p.items);
      if (items.length === 0) return { ok: false as const, err: "Basket is empty." };
      const index = buyIndex();
      try {
        const plans: Awaited<ReturnType<typeof runBasketCheckout>>[] = [];
        for (const ref of refs) {
          plans.push(
            await runBasketCheckout({
              referenceSystem: ref,
              items,
              journalDir,
              filters,
              routingMode,
              skipCache,
              forceLiveScan,
              cacheOnly,
              materialIndex: index,
            }),
          );
          // Keep the event loop breathing between refs.
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        return { ok: true as const, bundle: { plans } };
      } catch (e) {
        return { ok: false as const, err: errMessage(e) };
      }
    },
  } satisfies Partial<ColonizeHandlers>;
}
