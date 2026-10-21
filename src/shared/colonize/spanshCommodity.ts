import {
  commodityCatalogNormKeys,
  commodityNormKey,
  commoditySlugAliasesForKeys,
} from "./commodityKey";
import { COMMODITY_FDEV_ID_TO_MERGE_KEY, COMMODITY_SPANSH_SLUGS_BY_NORM_KEY } from "./commoditySpanshSlugs.gen";

export type SpanshStationSearchCommodityFilter = {
  /** Spansh `stations/search` market filter field — display names use `name`, FDev symbols use `symbol`. */
  field: "name" | "symbol";
  value: string;
};

/** Prefer FDev commodity.csv slug order (Spansh aligns with Frontier `name` + `symbol`). */
function fdevSpanshSlugHints(name: string, nameLocalised: string, id = ""): string[] {
  const stemJournal = (s: string): string => {
    let x = s.trim();
    if (x.endsWith(";")) x = x.slice(0, -1).trim();
    if (x.startsWith("$")) x = x.slice(1);
    x = x.replace(/_name$/i, "").trim();
    return x;
  };

  const normKeys = new Set<string>();
  for (const raw of [id, nameLocalised, name]) {
    if (!raw?.trim()) continue;
    const t = raw.trim();
    if (/^\d+$/.test(t)) {
      const fromFdev = COMMODITY_FDEV_ID_TO_MERGE_KEY[t];
      if (fromFdev) normKeys.add(fromFdev);
    }
    normKeys.add(commodityNormKey(raw));
    normKeys.add(commodityNormKey(stemJournal(raw)));
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const pushSlug = (z: string | null | undefined): void => {
    const t = typeof z === "string" ? z.trim() : "";
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  for (const nk of normKeys) {
    const row = nk ? COMMODITY_SPANSH_SLUGS_BY_NORM_KEY[nk] : undefined;
    if (row) for (const slug of row) pushSlug(slug);
  }
  return out;
}

export function isFdevSymbolSlug(s: string): boolean {
  const t = s.trim();
  if (!t || t.includes(" ") || t.includes(".")) return false;
  return /^[A-Za-z]+(?:[A-Z][a-z0-9]*)+$/.test(t);
}

/**
 * Spansh station search filters — tries display names (`name`) and FDev symbols (`symbol`).
 * Symbols in the `name` field return zero hits (Spansh API quirk).
 */
export function spanshStationSearchCommodityFilters(
  name: string,
  nameLocalised: string,
  id = "",
): SpanshStationSearchCommodityFilter[] {
  const out: SpanshStationSearchCommodityFilter[] = [];
  const seen = new Set<string>();
  const push = (field: "name" | "symbol", value: string | null | undefined): void => {
    const t = typeof value === "string" ? value.trim() : "";
    if (!t) return;
    const key = `${field}\0${t.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ field, value: t });
  };

  const keys = commodityCatalogNormKeys(id, nameLocalised, name);
  const displayNames: string[] = [];
  const symbols: string[] = [];
  for (const alias of commoditySlugAliasesForKeys(keys)) {
    if (isFdevSymbolSlug(alias)) symbols.push(alias);
    else displayNames.push(alias);
  }
  for (const h of fdevSpanshSlugHints(name, nameLocalised, id)) {
    if (isFdevSymbolSlug(h)) symbols.push(h);
    else displayNames.push(h);
  }

  /**
   * Display names first, deliberately.
   *
   * Spansh answers a `name` filter reliably but returns HTTP 500 for a `symbol` filter much of
   * the time — measured over fourteen runs each, "Bioreducing Lichen" succeeded 14/14 by name
   * and 4/14 by symbol, "Grain" 14/14 by name and 7/14 by symbol. Symbols stay as a fallback
   * for anything the display name cannot resolve, but they must not be tried first.
   */
  for (const d of displayNames) push("name", d);
  for (const s of symbols) push("symbol", s);

  const stem = (s: string): string => {
    let x = s.trim();
    if (x.endsWith(";")) x = x.slice(0, -1).trim();
    if (x.startsWith("$")) x = x.slice(1);
    x = x.replace(/_name$/i, "").trim();
    return x;
  };
  for (const raw of [nameLocalised, name, stem(nameLocalised), stem(name)]) {
    if (!raw?.trim()) continue;
    const t = raw.trim();
    if (t.startsWith("$") || t.endsWith(";")) continue;
    if (isFdevSymbolSlug(t)) push("symbol", t);
    else push("name", t);
  }

  return out;
}

/** Fast checkout: one display-name search + one symbol search (Spansh polls are slow). */
export function spanshPrimaryStationSearchFilters(
  name: string,
  nameLocalised: string,
  id = "",
): SpanshStationSearchCommodityFilter[] {
  const all = spanshStationSearchCommodityFilters(name, nameLocalised, id);
  let primaryName: SpanshStationSearchCommodityFilter | undefined;
  let primarySymbol: SpanshStationSearchCommodityFilter | undefined;
  for (const f of all) {
    if (f.field === "name" && !primaryName) primaryName = f;
    else if (f.field === "symbol" && !primarySymbol) primarySymbol = f;
    if (primaryName && primarySymbol) break;
  }
  return [primaryName, primarySymbol].filter((f): f is SpanshStationSearchCommodityFilter => f != null);
}

/**
 * A Spansh commodity label as a comparison key: trimmed, lower-case, one space, underscores as
 * spaces. Not `commodityNormKey` — that maps names onto the catalogue; this only makes two
 * spellings of the same Spansh label compare equal.
 */
export function spanshLabelKey(s: string | null | undefined): string {
  return (typeof s === "string" ? s : "").trim().toLowerCase().replace(/\s+/g, " ").replace(/_/g, " ");
}
