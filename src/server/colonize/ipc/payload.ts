/**
 * Parsing for what the window sends. Everything that crosses the bridge is untrusted: anything
 * unrecognised falls back to a safe default rather than reaching the checkout engine as-is.
 *
 * Plain Node, so all of it is testable on its own.
 */
import type { BasketCheckoutItem, CheckoutRoutingMode } from "../../../shared/colonize/types";
import { parseMinLandingPad, parseStationKindFilter } from "../../../shared/colonize/stationFilter";

/** The payload as a record, or an empty one. */
export function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

export function trimmedString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Non-empty trimmed strings from an array; anything else is dropped. */
export function parseSystemNames(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
    : [];
}

/** Distances arrive from the window's state; drop anything that is not a usable number. */
export function parseDistanceBySystem(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

export function parseConstructionDepots(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
    .map((x) => ({
      marketId: typeof x.marketId === "string" ? x.marketId : "",
      systemName: typeof x.systemName === "string" ? x.systemName.trim() : "",
      starSystem:
        typeof x.starSystem === "string"
          ? x.starSystem.trim()
          : typeof x.systemName === "string"
            ? x.systemName.trim()
            : "",
      stationName: typeof x.stationName === "string" ? x.stationName.trim() : "",
      constructionSiteLabel:
        typeof x.constructionSiteLabel === "string" ? x.constructionSiteLabel.trim() : null,
      label: typeof x.label === "string" ? x.label.trim() : null,
    }))
    .filter((x) => x.marketId || (x.systemName && x.stationName));
}

export function parseCheckoutItems(raw: unknown): BasketCheckoutItem[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
    .map((x) => ({
      id: typeof x.id === "string" ? x.id : "",
      name: typeof x.name === "string" ? x.name : "",
      nameLocalised: typeof x.nameLocalised === "string" ? x.nameLocalised : "",
      quantityTons: typeof x.quantityTons === "number" && x.quantityTons > 0 ? x.quantityTons : 1,
    }))
    .filter((x) => Boolean(x.id || x.name || x.nameLocalised));
}

const ROUTING_MODES: readonly CheckoutRoutingMode[] = ["fewest_stops", "nearest", "cheapest"];

function parseRoutingMode(v: unknown): CheckoutRoutingMode {
  return typeof v === "string" && (ROUTING_MODES as readonly string[]).includes(v)
    ? (v as CheckoutRoutingMode)
    : "fewest_stops";
}

/** Shared payload parsing for checkoutBasket / checkoutBasketMulti. */
export function parseCheckoutRequest(p: Record<string, unknown>) {
  const journalDir = typeof p.journalDir === "string" && p.journalDir.trim() ? p.journalDir.trim() : null;
  const filtersRaw = p.filters && typeof p.filters === "object" ? (p.filters as Record<string, unknown>) : {};
  const includePlanetaryAndGround =
    typeof filtersRaw.includePlanetaryAndGround === "boolean"
      ? filtersRaw.includePlanetaryAndGround
      : p.includePlanetaryAndGround === true;
  const skipCache = p.skipCache === true;
  const forceLiveScan = p.forceLiveScan === true;
  /** Local JSON index + journal markets unless user explicitly requests live Spansh. */
  const cacheOnly = forceLiveScan ? false : p.cacheOnly !== false;
  const routingMode = parseRoutingMode(p.routingMode);

  const constructionSystems = Array.isArray(filtersRaw.constructionSystems)
    ? filtersRaw.constructionSystems.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const dockedRaw = filtersRaw.dockedStation;
  const dockedStation =
    dockedRaw &&
    typeof dockedRaw === "object" &&
    typeof (dockedRaw as { systemName?: unknown }).systemName === "string" &&
    typeof (dockedRaw as { stationName?: unknown }).stationName === "string"
      ? {
          systemName: (dockedRaw as { systemName: string }).systemName.trim(),
          stationName: (dockedRaw as { stationName: string }).stationName.trim(),
        }
      : null;
  const knownRaw = filtersRaw.knownShopStations;
  const knownShopStations =
    cacheOnly || !Array.isArray(knownRaw)
      ? []
      : knownRaw
          .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
          .map((x) => ({
            systemName: typeof x.systemName === "string" ? x.systemName.trim() : "",
            stationName: typeof x.stationName === "string" ? x.stationName.trim() : "",
          }))
          .filter((x) => x.systemName && x.stationName);
  const minLandingPad = parseMinLandingPad(filtersRaw.minLandingPad, filtersRaw.largePadOnly === true);
  const stationKind = parseStationKindFilter(filtersRaw.stationKind);
  const filters = {
    includePlanetaryAndGround,
    maxDistanceLy:
      typeof filtersRaw.maxDistanceLy === "number" && filtersRaw.maxDistanceLy > 0
        ? filtersRaw.maxDistanceLy
        : null,
    minSupply:
      typeof filtersRaw.minSupply === "number" && filtersRaw.minSupply > 0 ? filtersRaw.minSupply : null,
    largePadOnly: minLandingPad === "L",
    minLandingPad,
    stationKind,
    excludeFleetCarriers: filtersRaw.excludeFleetCarriers === true,
    constructionSystems,
    dockedStation: dockedStation?.systemName && dockedStation.stationName ? dockedStation : null,
    knownShopStations,
    constructionDepots: parseConstructionDepots(filtersRaw.constructionDepots),
    maxSystemsPerMaterial:
      typeof filtersRaw.maxSystemsPerMaterial === "number" && filtersRaw.maxSystemsPerMaterial > 0
        ? Math.floor(filtersRaw.maxSystemsPerMaterial)
        : null,
    shopMarketSnapshots:
      cacheOnly || !Array.isArray(filtersRaw.shopMarketSnapshots)
        ? []
        : (filtersRaw.shopMarketSnapshots as unknown[])
            .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
            .map((x) => ({
              systemName: typeof x.systemName === "string" ? x.systemName.trim() : "",
              stationName: typeof x.stationName === "string" ? x.stationName.trim() : "",
              marketId: typeof x.marketId === "string" ? x.marketId : undefined,
              constructionDistanceLy:
                typeof x.constructionDistanceLy === "number" && Number.isFinite(x.constructionDistanceLy)
                  ? x.constructionDistanceLy
                  : null,
              offers: Array.isArray(x.offers)
                ? (x.offers as unknown[])
                    .filter((o): o is Record<string, unknown> => Boolean(o && typeof o === "object"))
                    .map((o) => ({
                      commodityId: typeof o.commodityId === "string" ? o.commodityId : "",
                      label: typeof o.label === "string" ? o.label : "",
                      supply: typeof o.supply === "number" && o.supply > 0 ? o.supply : 0,
                      buyPrice: typeof o.buyPrice === "number" ? o.buyPrice : null,
                    }))
                    .filter((o) => o.commodityId && o.supply > 0 && o.buyPrice != null && o.buyPrice > 0)
                : [],
            }))
            .filter((x) => x.systemName && x.stationName && x.offers.length > 0),
  };

  return { journalDir, filters, routingMode, skipCache, forceLiveScan, cacheOnly };
}
