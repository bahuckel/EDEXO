import { compareBuyStationHits } from "./buyStationSort";
import { bestGalaxyLyFromSites, galaxyLyFromSite, isKnownLy } from "./systemDistanceLy";
import type { MaterialBuyListing } from "./materialBuyIndexTypes";
import type { BasketCheckoutBundle } from "./types";
import type { ShopHistoryEntry } from "./shopHistory";

const GALAXY_DISTANCE_TARGET_CAP = 400;

/** Systems that need Milky Way Ly from construction refs (shops + indexed buy stations). */
export function collectGalaxyDistanceTargets(args: {
  shopHistory: ShopHistoryEntry[];
  checkoutBundle?: BasketCheckoutBundle | null;
  constructionRefs?: string[];
  cap?: number;
  /** Extra seller systems (e.g. Search tab material hits). */
  extraSellerSystems?: string[];
}): string[] {
  const cap = args.cap ?? GALAXY_DISTANCE_TARGET_CAP;
  const sellers = new Set<string>();
  const shops = new Set<string>();

  for (const plan of args.checkoutBundle?.plans ?? []) {
    for (const mat of plan.materialListings ?? []) {
      for (const hit of mat.stations) {
        const s = hit.systemName.trim();
        if (s) sellers.add(s);
      }
    }
    for (const g of plan.groups ?? []) {
      const s = g.systemName.trim();
      if (s) sellers.add(s);
    }
    for (const e of plan.catalogStations ?? []) {
      const s = e.systemName.trim();
      if (s) sellers.add(s);
    }
  }
  for (const h of args.shopHistory) {
    const s = h.systemName.trim();
    if (s) shops.add(s);
  }
  for (const raw of args.extraSellerSystems ?? []) {
    const s = raw.trim();
    if (s) sellers.add(s);
  }

  const out: string[] = [];
  for (const s of sellers) {
    if (out.length >= cap) return out;
    out.push(s);
  }
  for (const s of shops) {
    if (out.length >= cap) return out;
    if (!sellers.has(s)) out.push(s);
  }
  return out;
}

/** Seller systems that still lack a cached construction-site → seller Ly pair. */
export function filterUnresolvedGalaxyDistanceTargets(
  constructionRefs: string[],
  targets: string[],
  distanceMap: Record<string, number>,
): string[] {
  const refs = constructionRefs.map((s) => s.trim()).filter(Boolean);
  if (!refs.length) return [];
  const out: string[] = [];
  for (const raw of targets) {
    const t = raw.trim();
    if (!t) continue;
    const d = bestGalaxyLyFromSites(t, refs, distanceMap);
    if (!isKnownLy(d)) out.push(t);
  }
  return out;
}

/**
 * Set distanceLy only from 3D galaxy coords (colonization site → seller).
 * Spansh/index Ly is never shown — unknown stays null until EDSM coords resolve.
 */
export function enrichMaterialListingsGalaxyLy(
  listings: MaterialBuyListing[],
  constructionSite: string,
  distanceMap: Record<string, number>,
  shopHistory: ShopHistoryEntry[] = [],
): MaterialBuyListing[] {
  const site = constructionSite.trim();
  if (!site || !Object.keys(distanceMap).length) return listings;
  return listings.map((mat) => ({
    ...mat,
    stations: [...mat.stations]
      .map((hit) => {
        const galaxy = galaxyLyFromSite(hit.systemName, site, distanceMap);
        if (galaxy == null) return hit;
        return galaxy === hit.distanceLy ? hit : { ...hit, distanceLy: galaxy };
      })
      .sort((a, b) => compareBuyStationHits(a, b, shopHistory, site, distanceMap)),
  }));
}
