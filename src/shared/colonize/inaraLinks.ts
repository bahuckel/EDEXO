/** Inara's API syncs commander profiles — it does not expose galaxy commodity search. Open the website for manual lookup. */

import { inaraCommodityPa1 } from "./inaraCommodityIds";

export type InaraBuySearchOptions = {
  /** Construction-site star — never the commander's current system. */
  nearSystem?: string | null;
  largePadOnly?: boolean;
  excludeFleetCarriers?: boolean;
};

/**
 * Buy-search URL that actually runs Inara's commodities form.
 * `formbrief=1` submits the search. `pi1=1` = I want to buy.
 * Commodity is `pa1[]` (TomSelect), not `pi2`. `ps1` = near star.
 * `edexo=1` lets the Chrome addon sync the form if Inara kept a previous commodity.
 */
export function inaraCommoditySearchUrl(
  commodityLabel: string,
  referenceSystem?: string | null,
  opts?: InaraBuySearchOptions,
): string {
  const q = commodityLabel.trim();
  const near = (opts?.nearSystem ?? referenceSystem)?.trim() || "";
  const base = "https://inara.cz/elite/commodities/";
  const params = new URLSearchParams();
  params.set("formbrief", "1");
  params.set("edexo", "1");
  params.set("pi1", "1");
  const pa1 = q ? inaraCommodityPa1(q) : null;
  if (pa1 != null) params.append("pa1[]", String(pa1));
  else if (q) params.set("search", q);
  if (near) params.set("ps1", near);
  if (opts?.largePadOnly) params.set("pi10", "3");
  if (opts?.excludeFleetCarriers) params.set("pi8", "0");
  return `${base}?${params.toString()}`;
}

export function inaraStationUrl(stationName: string, systemName: string): string {
  const params = new URLSearchParams();
  if (systemName.trim()) params.set("ps1", systemName.trim());
  if (stationName.trim()) params.set("search", stationName.trim());
  return `https://inara.cz/elite/stations/?${params.toString()}`;
}

export function spanshSystemUrl(systemName: string): string {
  return `https://spansh.co.uk/system?n=${encodeURIComponent(systemName.trim())}`;
}
