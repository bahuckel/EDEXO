import economyJson from "./data/economyProduction.json";
import economyProduceCanon from "./data/economyProduceNameCanon.json";
import { getResourceTradeCategory, journalCommoditySymbolStem } from "./commodityCategories";
import { COMMODITY_SPANSH_SLUGS_BY_NORM_KEY } from "./commoditySpanshSlugs.gen";
import type { ResourceRow } from "./types";
import { commodityNormKey, expandCommodityKeys } from "./commodityKey";

type EconomyBlock = {
  /** Legacy labelled rows `(Name) (Economy)` */
  exports?: string[];
  market_commodities_produced?: string[];
  rare_commodities_produced?: string[];
  engineering_materials_produced?: Record<string, string[]>;
  odyssey_on_foot_resources?: { goods?: string[]; assets?: string[]; data?: string[] };
};

const ECONOMY_KEY_LABEL: Record<string, string> = {
  extraction: "Extraction",
  refinery: "Refinery",
  industrial: "Industrial",
  high_tech: "High Tech",
  agriculture: "Agriculture",
  tourism: "Tourism",
  military: "Military",
  colony: "Colony",
  service: "Service",
  contraband: "Contraband",
  powerplay: "Powerplay",
};

/**
 * Frontier market category → typical station economies producing that flavour of good.
 * Used only when catalogue + Spansh key expansion still finds no row (engineering mats,
 * odd journal spellings).
 */
const CATEGORY_FALLBACK_ECONOMIES: Record<string, readonly string[]> = {
  Metals: ["Extraction", "Refinery"],
  Minerals: ["Extraction"],
  Chemicals: ["Refinery", "Industrial"],
  "Industrial Materials": ["Industrial", "Refinery"],
  Foods: ["Agriculture"],
  Textiles: ["Industrial", "Agriculture"],
  Medicines: ["High Tech"],
  "Legal Drugs": ["Agriculture", "Tourism"],
  Machinery: ["Industrial"],
  Technology: ["High Tech"],
  Weapons: ["Military", "High Tech"],
  "Consumer Items": ["Industrial", "Tourism", "High Tech"],
  Waste: ["Industrial", "Service", "Tourism"],
  Slavery: ["Contraband"],
  Salvage: ["Industrial", "Colony"],
  NonMarketable: ["Industrial", "Military", "High Tech", "Colony"],
  Other: ["Extraction", "Refinery", "Industrial", "High Tech", "Agriculture", "Colony"],
};

/** Lowercase typo or alias → canonical Frontier-style spelling (`economyProduceNameCanon.json`). */
const CANON_PRODUCE_NAME = (() => {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(economyProduceCanon as Record<string, string>)) {
    if (k.startsWith("_")) continue;
    m.set(k.toLowerCase(), v.trim());
  }
  return m;
})();

/**
 * Norm keys that share the same commodity.csv slug row collapse to one equivalence class.
 * Lets `$Fruit_and_Veg_name` ⇄ `Fruit and Vegetables` ⇄ `fruitandvegetables` all hit catalogue rows.
 *
 * Built on first use, not at import: this module lands in both the main and the renderer bundle, and the
 * expansion runs key expansion over every slug row, which is wasted work in a process that never asks for
 * a production hint.
 */
let spanshNormExpand: Map<string, Set<string>> | null = null;

function spanNormEquivalence(): Map<string, Set<string>> {
  if (!spanshNormExpand) spanshNormExpand = buildSpanNormEquivalence();
  return spanshNormExpand;
}

function buildSpanNormEquivalence(): Map<string, Set<string>> {
  const memberToMerged = new Map<string, Set<string>>();
  for (const [primaryNk, slugs] of Object.entries(COMMODITY_SPANSH_SLUGS_BY_NORM_KEY)) {
    const bundle = new Set<string>();
    function add(norm: string) {
      const n = commodityNormKey(norm);
      if (!n) return;
      for (const k of expandCommodityKeys(n)) bundle.add(k);
    }
    add(primaryNk);
    for (const slug of slugs ?? []) {
      add(String(slug));
    }
    for (const k of bundle) memberToMerged.set(k, bundle);
  }
  return memberToMerged;
}

/** Expand one normKey with its Spansh slug-row siblings (often empty for non-trade mats). */
function expandSpanNorm(normKey: string): Set<string> {
  const extras = spanNormEquivalence().get(normKey);
  if (!extras?.size) return new Set<string>(expandCommodityKeys(normKey));
  const out = new Set<string>();
  for (const k of extras) out.add(k);
  return out;
}

function capitalizeFirst(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** e.g. "liquid oxygen" → "Liquid oxygen" — Spansh / journals sometimes drift. */
function sentenceCase(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Title-case each token. */
function titleCaseWords(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Strip redundant "(Economy)" suffix from catalogue rows — parent JSON key remains authority. */
function stripParenEconomySuffix(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/u, "").trim();
}

function canonEconomyProduceName(trimmedSansSuffix: string): string {
  if (!trimmedSansSuffix.trim()) return trimmedSansSuffix;
  return CANON_PRODUCE_NAME.get(trimmedSansSuffix.toLowerCase()) ?? trimmedSansSuffix;
}

/** Every surface form we derive norm keys from (mirrors spanshCheckout slug discovery). */
function textualSurfaceForms(s: string): string[] {
  const t = s.trim();
  if (!t) return [];
  const bare = stripParenEconomySuffix(t);
  const stemT = journalCommoditySymbolStem(t);
  const stemB = journalCommoditySymbolStem(bare);
  const rawSet = new Set<string>([t, bare, stemT, stemB].filter(Boolean));
  const expanded: string[] = [];
  for (const raw of rawSet) {
    const x = raw.trim();
    if (!x) continue;
    expanded.push(x, sentenceCase(x), titleCaseWords(x), capitalizeFirst(x));
  }
  return [...new Set(expanded.map((x) => x.trim()).filter(Boolean))];
}

/** Normalised SKU keys (+ Spansh row siblings) for one produce / journal label string. */
function deriveProduceNormKeys(displayLine: string): Set<string> {
  const stripped = stripParenEconomySuffix(displayLine.trim());
  const canonDisplay = canonEconomyProduceName(stripped);
  const keys = new Set<string>();
  for (const variant of new Set([displayLine.trim(), stripped, canonDisplay].filter(Boolean))) {
    if (!variant) continue;
    for (const surface of textualSurfaceForms(variant)) {
      const nkCore = commodityNormKey(surface);
      if (!nkCore) continue;
      for (const k of expandCommodityKeys(nkCore)) {
        for (const x of expandSpanNorm(k)) keys.add(x);
      }
    }
  }
  return keys;
}

function collectProducedNameStrings(block: Partial<EconomyBlock>): string[] {
  const all: string[] = [];
  const pushArr = (a: unknown) => {
    if (Array.isArray(a)) for (const x of a) if (typeof x === "string") all.push(x);
  };
  pushArr(block.exports);
  pushArr(block.market_commodities_produced);
  pushArr(block.rare_commodities_produced);

  const eng = block.engineering_materials_produced;
  if (eng && typeof eng === "object") {
    for (const arr of Object.values(eng)) pushArr(arr);
  }

  const o = block.odyssey_on_foot_resources;
  if (o && typeof o === "object") {
    pushArr(o.goods);
    pushArr(o.assets);
    pushArr(o.data);
  }

  return all;
}

/** normKey → unique producing economy labels (catalogue heuristic). */
function buildNormToEconomies(): Map<string, string[]> {
  const elites = economyJson.elite_dangerous_economies as Record<string, EconomyBlock | string>;
  const bucket = new Map<string, Set<string>>();

  function addEconomy(normKey: string, label: string) {
    if (!normKey) return;
    let s = bucket.get(normKey);
    if (!s) {
      s = new Set<string>();
      bucket.set(normKey, s);
    }
    s.add(label);
  }

  for (const [econKey, block] of Object.entries(elites)) {
    if (econKey.startsWith("_") || typeof block === "string") continue;
    const econLabel = ECONOMY_KEY_LABEL[econKey] ?? econKey.charAt(0).toUpperCase() + econKey.slice(1);
    const b = block as EconomyBlock;
    for (const line of collectProducedNameStrings(b)) {
      for (const nk of deriveProduceNormKeys(line)) addEconomy(nk, econLabel);
    }
  }

  const sorted = [...bucket.entries()].map(([normKey, set]) => [normKey, [...set].sort((a, b) => a.localeCompare(b))] as const);
  return new Map(sorted);
}

/** Same reasoning as `spanshNormExpand`: this walks every produced-name line × four case variants. */
let normToEconomies: Map<string, string[]> | null = null;

function economiesByNormKey(): Map<string, string[]> {
  if (!normToEconomies) normToEconomies = buildNormToEconomies();
  return normToEconomies;
}

/**
 * Produce-economies from catalogue data only (ordered list; join with `/` for UI).
 */
function producingEconomiesForTradeName(raw: string | null | undefined): string[] {
  if (raw == null || !String(raw).trim()) return [];
  const found = new Set<string>();
  const byNormKey = economiesByNormKey();
  for (const nk of deriveProduceNormKeys(raw)) {
    const labs = byNormKey.get(nk);
    if (labs) for (const l of labs) found.add(l);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

function mergeTradeHints(strings: Iterable<string>): string[] {
  const found = new Set<string>();
  for (const raw of strings) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    for (const e of producingEconomiesForTradeName(t)) found.add(e);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

/**
 * Always returns economies for UI: merges `Name_Localised`, raw `Name`, and symbol stems.
 * When still empty, falls back to FDev commodity category defaults.
 */
function economyProductionHintsForJournal(name?: string | null, nameLocalised?: string | null): string[] {
  const nm = typeof name === "string" ? name : "";
  const nl = typeof nameLocalised === "string" ? nameLocalised : "";
  const tries = new Set<string>([nl.trim(), nm.trim()]);
  tries.delete("");
  const fromCat = (): string[] => {
    const row: ResourceRow = {
      name: nm,
      nameLocalised: nl || nm,
      required: 0,
      provided: 0,
      payment: null,
    };
    const cat = getResourceTradeCategory(row);
    return [...(CATEGORY_FALLBACK_ECONOMIES[cat] ?? CATEGORY_FALLBACK_ECONOMIES.Other!)].sort((a, b) => a.localeCompare(b));
  };
  let xs = mergeTradeHints(tries);
  if (!xs.length) xs = fromCat();
  return xs;
}

/** Slash-separated producer economies, always non-empty thanks to category fallback. */
function economyProductionHintSlashSeparated(name?: string | null, nameLocalised?: string | null): string {
  return economyProductionHintsForJournal(name, nameLocalised).join("/");
}

/**
 * UI helper: `displayName` = what you show (`Name_Localised` or fallback); optional `journalName` = raw `Name` / symbol.
 */
export function formatProductionEconomiesParen(displayName: string, journalName?: string | null): string {
  const d = displayName?.trim() ?? "";
  const j = journalName?.trim() || d;
  return economyProductionHintSlashSeparated(j, d);
}
