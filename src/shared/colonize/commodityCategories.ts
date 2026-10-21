import { commodityNormKey, expandCommodityKeys } from "./commodityKey";
import { COMMODITY_CATEGORY_BY_NORM_KEY } from "./commodityCategoryLookup.gen";
import type { ResourceRow } from "./types";

/** `$Steel_name;` → `Steel` symbol stem (then norm in caller). */
export function journalCommoditySymbolStem(raw: string | null | undefined): string {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (s.endsWith(";")) s = s.slice(0, -1).trim();
  if (s.startsWith("$")) s = s.slice(1);
  s = s.replace(/_name$/i, "");
  return s.trim();
}

function categoryForNormKey(norm: string): string | undefined {
  if (!norm) return undefined;
  for (const k of expandCommodityKeys(norm)) {
    const c = COMMODITY_CATEGORY_BY_NORM_KEY[k];
    if (c) return c;
  }
  return undefined;
}

/**
 * Frontier market category from FDevIDs `commodity.csv` (via generated lookup).
 * Unknown commodities → `"Other"`.
 */
export function getCommodityTradeCategory(name: string, nameLocalised?: string | null): string {
  return getResourceTradeCategory({
    name,
    nameLocalised: (nameLocalised ?? name).trim() || name,
    required: 0,
    provided: 0,
    payment: null,
  });
}

export function getResourceTradeCategory(row: ResourceRow): string {
  const tried = new Set<string>();
  for (const raw of [row.name, row.nameLocalised]) {
    if (!raw?.trim()) continue;
    for (const candidate of [commodityNormKey(raw), commodityNormKey(journalCommoditySymbolStem(raw))]) {
      if (!candidate || tried.has(candidate)) continue;
      tried.add(candidate);
      const c = categoryForNormKey(candidate);
      if (c) return c;
    }
  }
  return "Other";
}
