import { TtlCache } from "./ttlCache";
import {
  COMMODITY_FDEV_ID_TO_MERGE_KEY,
  COMMODITY_NORM_KEYS_BY_SLUG_NORM,
  COMMODITY_SPANSH_SLUGS_BY_NORM_KEY,
} from "./commoditySpanshSlugs.gen";

/**
 * These two run inside needs × history × offers loops on every plan rebuild and once per resource row per
 * React render, over a vocabulary that is effectively fixed (commodity names and journal symbols), so the
 * same few hundred strings are normalised again and again. The cap exists only so that a pathological input
 * stream — a corrupt journal spraying unique names — cannot turn the cache into a leak.
 */
const KEY_CACHE_LIMIT = 4096;
/** Oldest-first eviction: any entry is as good as another to drop here. */
const NORM_KEY_CACHE = new TtlCache<string, string>({ max: KEY_CACHE_LIMIT });
const MERGE_BUCKET_CACHE = new TtlCache<string, string>({ max: KEY_CACHE_LIMIT });

function cachedDerive(cache: TtlCache<string, string>, key: string, derive: () => string): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = derive();
  cache.set(key, value);
  return value;
}

/** Test-only window onto the memo caches; nothing in the app should depend on cache state. */
export function commodityKeyCacheSizesForTest(): { normKey: number; mergeBucket: number; limit: number } {
  return { normKey: NORM_KEY_CACHE.size, mergeBucket: MERGE_BUCKET_CACHE.size, limit: KEY_CACHE_LIMIT };
}

/** Test-only: lets a test compare memoised output against a cold derivation of the same input. */
export function resetCommodityKeyCachesForTest(): void {
  NORM_KEY_CACHE.clear();
  MERGE_BUCKET_CACHE.clear();
}

function deriveCommodityNormKey(s: string): string {
  const folded = s.normalize("NFKD").replace(/\p{M}/gu, "");
  return folded.replace(/[^a-z0-9]+/g, "");
}

/**
 * Canonical key for matching commodities across Elite journal sources.
 * Strips case, separators, and non-alphanumeric junk so e.g. Agri-Medicines / agri_medicines align.
 */
export function commodityNormKey(raw: string | null | undefined): string {
  if (raw == null) return "";
  const s = String(raw).trim().toLowerCase();
  if (!s) return "";
  return cachedDerive(NORM_KEY_CACHE, s, () => deriveCommodityNormKey(s));
}

const AGRICULTURAL = "agricultural";

/**
 * All spellings we treat as the same SKU for lookups (closure / fixed point).
 * Covers:
 * - plural ↔ singular
 * - cargo/trade Type "agricultural…" ↔ construction/UI style "agri…" (Frontier uses both)
 */
export function expandCommodityKeys(norm: string): string[] {
  if (!norm) return [];
  const keys = new Set<string>([norm]);

  let grew = true;
  while (grew) {
    grew = false;
    for (const k of [...keys]) {
      if (k.length > 4 && k.endsWith("s")) {
        const sing = k.slice(0, -1);
        if (sing && !keys.has(sing)) {
          keys.add(sing);
          grew = true;
        }
      }
      if (!k.endsWith("s") && k.length > 3) {
        const plur = k + "s";
        if (!keys.has(plur)) {
          keys.add(plur);
          grew = true;
        }
      }
      if (k.startsWith(AGRICULTURAL)) {
        const short = "agri" + k.slice(AGRICULTURAL.length);
        if (short && !keys.has(short)) {
          keys.add(short);
          grew = true;
        }
      }
    }
  }

  return [...keys].filter((x) => x.length > 0);
}

/**
 * Strip journal cargo / market symbol wrappers so `$TerrainEnrichmentSystems_name` aligns with commodity.csv.
 * Mirrors `journalCommoditySymbolStem` — kept inline to avoid a circular dependency with commodityCategories.ts.
 */
function journalSymbolStemForMerge(raw: string): string {
  let s = String(raw).trim();
  if (!s) return "";
  if (s.endsWith(";")) s = s.slice(0, -1).trim();
  if (s.startsWith("$")) s = s.slice(1);
  s = s.replace(/_name$/i, "").trim();
  return s;
}

/** Every normalized key in a commodity.csv slug row → one canonical rep (prefers shortest). */
function buildCanonNormRepresentative(): Map<string, string> {
  const m = new Map<string, string>();
  for (const [primaryNk, slugs] of Object.entries(COMMODITY_SPANSH_SLUGS_BY_NORM_KEY)) {
    const bundle = new Set<string>();
    for (const k of expandCommodityKeys(primaryNk)) bundle.add(k);
    if (slugs && Array.isArray(slugs)) {
      for (const slug of slugs) {
        for (const k of expandCommodityKeys(commodityNormKey(String(slug)))) bundle.add(k);
      }
    }
    if (!bundle.size) continue;
    const canon = [...bundle].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]!;
    for (const k of bundle) {
      const prev = m.get(k);
      const pick =
        prev == null
          ? canon
          : [...new Set([prev, canon])].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]!;
      m.set(k, pick);
    }
  }
  return m;
}

/**
 * Built on first use rather than at import: this module is pulled into both the main and the renderer
 * bundle, and a process that never keys a commodity should not pay for the table.
 */
let canonRepByNorm: Map<string, string> | null = null;

function canonRep(): Map<string, string> {
  if (!canonRepByNorm) canonRepByNorm = buildCanonNormRepresentative();
  return canonRepByNorm;
}

/**
 * Slug-norm → catalogue norm keys, plus each norm key's position in the catalogue. The reverse index comes
 * straight out of the generator; the rank is what keeps `commodityCatalogNormKeys` handing back its keys in
 * catalogue order, which callers such as `spanshCommodity` treat as a preference order.
 */
let catalogIndex: { bySlugNorm: Map<string, readonly string[]>; rank: Map<string, number> } | null = null;

function catalogLookup(): { bySlugNorm: Map<string, readonly string[]>; rank: Map<string, number> } {
  if (!catalogIndex) {
    const rank = new Map<string, number>();
    let i = 0;
    for (const k of Object.keys(COMMODITY_SPANSH_SLUGS_BY_NORM_KEY)) rank.set(k, i++);
    catalogIndex = { bySlugNorm: new Map(Object.entries(COMMODITY_NORM_KEYS_BY_SLUG_NORM)), rank };
  }
  return catalogIndex;
}

/**
 * `$Thing_name` / `Thing_name` often becomes `Thingname` after norm (underscore disappears), so `_name`-suffix
 * stripping can't run. Recover when `…name` is a fused journal suffix onto a catalogue symbol.
 */
function addCanonCandidatesForGlueNameSuffix(normKey: string, repPool: Set<string>): void {
  if (normKey.length < 14 || !normKey.endsWith("name")) return;
  const base = normKey.slice(0, -4);
  if (base.length < 10) return;
  const canon = canonRep();
  for (const bk of expandCommodityKeys(base)) {
    const c = canon.get(bk);
    if (c) repPool.add(c);
  }
}

/**
 * All FDev / EDSM catalogue norm keys for journal labels (links e.g. hesuits ↔ hazardousenvironmentsuits).
 */
export function commodityCatalogNormKeys(...raws: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  const labelNorms = new Set<string>();
  for (const raw of raws) {
    if (!raw?.trim()) continue;
    const b = commodityMergeBucket(raw);
    if (b) out.add(b);
    const nk = commodityNormKey(raw);
    labelNorms.add(nk);
    for (const k of expandCommodityKeys(nk)) out.add(k);
  }
  /**
   * The generator emits the slug-norm → norm-key direction for us, so this is a handful of hash lookups
   * instead of a scan that re-normalised every slug of all ~340 catalogue rows on every call. Sorting the
   * hits by catalogue rank reproduces the insertion order the old scan produced.
   */
  const { bySlugNorm, rank } = catalogLookup();
  const matched = new Set<string>();
  for (const labelNorm of labelNorms) {
    const normKeys = bySlugNorm.get(labelNorm);
    if (normKeys) for (const normKey of normKeys) matched.add(normKey);
  }
  if (matched.size) {
    for (const normKey of [...matched].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))) {
      out.add(normKey);
    }
  }
  return out;
}

function normCommodityDisplayKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/_/g, " ");
}

/** All FDev display names + symbol slugs for catalogue keys (e.g. H.E. Suits ↔ HazardousEnvironmentSuits). */
export function commoditySlugAliasesForKeys(keys: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const k of keys) {
    /**
     * Plain-object index, so a key like "constructor" or "valueOf" returns an inherited
     * prototype member rather than undefined, and the loop below then throws on a function.
     * Commodity keys come from user-facing names, so that input is reachable.
     */
    if (!Object.prototype.hasOwnProperty.call(COMMODITY_SPANSH_SLUGS_BY_NORM_KEY, k)) continue;
    const slugs = COMMODITY_SPANSH_SLUGS_BY_NORM_KEY[k];
    if (!Array.isArray(slugs)) continue;
    for (const slug of slugs) {
      const t = String(slug).trim();
      if (t) out.add(t);
    }
  }
  return out;
}

/** True when two commodity id strings name the same SKU (merge bucket). */
export function commodityIdsEquivalent(a: string, b: string): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  if (a === b) return true;
  const ba = commodityMergeBucket(a);
  const bb = commodityMergeBucket(b);
  return Boolean(ba && bb && ba === bb);
}

/** True when a market/dump label matches a basket need (journal id + display label). */
export function commodityNeedMatchesLabel(
  needId: string,
  needLabel: string,
  commodityLabel: string,
): boolean {
  const label = commodityLabel.trim();
  if (!label) return false;
  const keys = commodityCatalogNormKeys(needId, needLabel);
  const cNorm = commodityNormKey(label);
  const cKey = normCommodityDisplayKey(label);
  for (const k of keys) {
    if (commodityNormKey(k) === cNorm) return true;
    if (normCommodityDisplayKey(k) === cKey) return true;
  }
  for (const alias of commoditySlugAliasesForKeys(keys)) {
    if (commodityNormKey(alias) === cNorm) return true;
    if (normCommodityDisplayKey(alias) === cKey) return true;
  }
  return false;
}

/** True when two Spansh/EDSM/journal strings name the same SKU (display name vs FDev symbol). */
export function commodityLabelsEquivalent(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return false;
  if (left === right) return true;
  if (commodityNormKey(left) === commodityNormKey(right)) return true;
  if (normCommodityDisplayKey(left) === normCommodityDisplayKey(right)) return true;
  const keys = commodityCatalogNormKeys(left, left);
  for (const k of commodityCatalogNormKeys(right, right)) {
    if (keys.has(k)) return true;
  }
  const aliases = commoditySlugAliasesForKeys(keys);
  for (const alias of commoditySlugAliasesForKeys(commodityCatalogNormKeys(right, right))) {
    if (aliases.has(alias)) return true;
    if (commodityNormKey(alias) === commodityNormKey(right)) return true;
  }
  return false;
}

function deriveCommodityMergeBucket(trimmed: string): string {
  const canon = canonRep();

  /** Some journal/Cargo payloads use the numeric FDev row id instead of symbol text. */
  if (/^\d+$/.test(trimmed)) {
    const pref = COMMODITY_FDEV_ID_TO_MERGE_KEY[trimmed];
    if (pref) return canon.get(pref) ?? pref;
  }

  /** Symbol stem + literal string — Cargo.json often carries `$TerrainEnrichmentSystems_name` vs depot `Land Enrichment Systems`. */
  const surfaces = [...new Set([trimmed, journalSymbolStemForMerge(trimmed)])].filter(Boolean);
  const repPool = new Set<string>();
  for (const surf of surfaces) {
    const n = commodityNormKey(surf);
    for (const ek of expandCommodityKeys(n)) {
      repPool.add(canon.get(ek) ?? ek);
      addCanonCandidatesForGlueNameSuffix(ek, repPool);
    }
  }
  if (!repPool.size) return "";
  return [...repPool].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]!;
}

/** Stable id so two journal strings that differ only by these rules merge in inventory/sums. */
export function commodityMergeBucket(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  return cachedDerive(MERGE_BUCKET_CACHE, trimmed, () => deriveCommodityMergeBucket(trimmed));
}

/**
 * The one way to key a commodity-bearing row for needs, cargo and deliveries.
 *
 * This derivation existed in eleven places in two variants: some sites fell back to
 * `commodityNormKey`, others stopped after the two bucket attempts. A row that only
 * resolves through the fallback was therefore counted by the planner and dropped by
 * the logistics summary, so the two disagreed about what was still outstanding.
 *
 * Returns "" when nothing resolves; callers skip those rows.
 */
export function resourceNeedId(row: { name: string; nameLocalised?: string | null }): string {
  return (
    commodityMergeBucket(row.name) ||
    commodityMergeBucket(row.nameLocalised) ||
    commodityNormKey(row.name)
  );
}
