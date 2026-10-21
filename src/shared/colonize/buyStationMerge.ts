import type { MaterialBuyStationHit } from "./materialBuyIndexTypes";
import { normStationName, normSystemName } from "./stationFilter";
import { nearerLy } from "./systemDistanceLy";
import type { CheckoutOfferSource } from "./types";

/** Same physical station — never key on marketId (Inara dumps have none; Spansh does). */
export function buyStationPlaceKey(hit: Pick<MaterialBuyStationHit, "systemName" | "stationName">): string {
  return `s:${normSystemName(hit.systemName)}:${normStationName(hit.stationName)}`;
}

function typeQuality(t: string | null | undefined): number {
  const s = t?.trim() ?? "";
  if (!s || s.toLowerCase() === "unknown") return 0;
  return 2;
}

function sourceRank(src: CheckoutOfferSource | undefined): number {
  if (src === "journal") return 4;
  if (src === "inara") return 3;
  if (src === "spansh") return 2;
  return 1;
}

function buyStationHitInfoScore(h: MaterialBuyStationHit): number {
  let n = 0;
  n += typeQuality(h.stationType) * 8;
  if (h.isPlanetaryOrGround === true) n += 4;
  if (h.pad?.trim()) n += 3;
  if (h.bodyName?.trim()) n += 3;
  if (h.marketId?.trim()) n += 2;
  if (h.supply != null && h.supply > 0) n += 2;
  if (h.buyPrice != null && h.buyPrice > 0) n += 1;
  n += sourceRank(h.dataSource);
  return n;
}

function pickSource(a: MaterialBuyStationHit, b: MaterialBuyStationHit): CheckoutOfferSource {
  return sourceRank(a.dataSource) >= sourceRank(b.dataSource) ? a.dataSource : b.dataSource;
}

/** One station row with the union of fields — keep type/pad/ground from Spansh, stock/price from Inara, etc. */
export function mergeBuyStationHits(a: MaterialBuyStationHit, b: MaterialBuyStationHit): MaterialBuyStationHit {
  const primary = buyStationHitInfoScore(a) >= buyStationHitInfoScore(b) ? a : b;
  const other = primary === a ? b : a;
  const newer = Date.parse(a.foundAtIso) >= Date.parse(b.foundAtIso) ? a : b;
  const typeWinner = typeQuality(a.stationType) >= typeQuality(b.stationType) ? a : b;
  const supply =
    a.supply != null && b.supply != null ? Math.max(a.supply, b.supply) : (a.supply ?? b.supply);
  return {
    ...primary,
    systemName: primary.systemName || other.systemName,
    stationName: primary.stationName || other.stationName,
    marketId: primary.marketId?.trim() || other.marketId?.trim() || "",
    distanceLy: nearerLy(a.distanceLy, b.distanceLy),
    buyPrice: newer.buyPrice ?? primary.buyPrice ?? other.buyPrice,
    supply,
    spanshCommodity: primary.spanshCommodity || other.spanshCommodity,
    dataSource: pickSource(a, b),
    stationType: typeWinner.stationType?.trim() || other.stationType || primary.stationType || null,
    isPlanetaryOrGround: Boolean(a.isPlanetaryOrGround || b.isPlanetaryOrGround),
    pad: primary.pad?.trim() || other.pad?.trim() || null,
    bodyName: primary.bodyName?.trim() || other.bodyName?.trim() || null,
    marketUpdatedAt: newer.marketUpdatedAt ?? primary.marketUpdatedAt ?? other.marketUpdatedAt,
    foundAtIso: newer.foundAtIso,
    purchaseProven: Boolean(a.purchaseProven || b.purchaseProven),
  };
}

/** Collapse Inara/Spansh/journal copies of the same station. */
export function dedupeBuyStationHits(hits: MaterialBuyStationHit[]): MaterialBuyStationHit[] {
  const byKey = new Map<string, MaterialBuyStationHit>();
  for (const h of hits) {
    const k = buyStationPlaceKey(h);
    const prev = byKey.get(k);
    byKey.set(k, prev ? mergeBuyStationHits(prev, h) : h);
  }
  return [...byKey.values()];
}
