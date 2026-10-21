import { describe, expect, it, beforeEach } from "vitest";
import {
  commodityCatalogNormKeys,
  commodityKeyCacheSizesForTest,
  commodityMergeBucket,
  commodityNormKey,
  expandCommodityKeys,
  resetCommodityKeyCachesForTest,
  resourceNeedId,
  commoditySlugAliasesForKeys,
} from "../../src/shared/colonize/commodityKey";
import {
  COMMODITY_NORM_KEYS_BY_SLUG_NORM,
  COMMODITY_SPANSH_SLUGS_BY_NORM_KEY,
} from "../../src/shared/colonize/commoditySpanshSlugs.gen";

/** One row per shape the journal actually throws at us, so a memo bug shows up as a changed bucket. */
const REPRESENTATIVE_INPUTS: string[] = [
  "$TerrainEnrichmentSystems_name;",
  "Land Enrichment Systems",
  "$Steel_name;",
  "Steel",
  "steel",
  "  Steel  ",
  "$CMMComposite_name;",
  "CMM Composite",
  "$InsulatingMembrane_name;",
  "Insulating Membrane",
  "Agri-Medicines",
  "agricultural medicines",
  "AgriculturalMedicines",
  "H.E. Suits",
  "HazardousEnvironmentSuits",
  "$HazardousEnvironmentSuits_name;",
  "Semiconductors",
  "Semiconductor",
  "Water Purifiers",
  "Water Purifier",
  "128049152",
  "128049204",
  "Liquid Oxygen",
  "liquid oxygen",
  "Fruit and Vegetables",
  "Café Latté",
  "not a real commodity at all",
  "",
  "   ",
];

describe("commodityKey memoisation", () => {
  beforeEach(() => {
    resetCommodityKeyCachesForTest();
  });

  it("returns the same bucket and norm key warm as it does cold", () => {
    const cold = REPRESENTATIVE_INPUTS.map((raw) => {
      resetCommodityKeyCachesForTest();
      return { raw, bucket: commodityMergeBucket(raw), norm: commodityNormKey(raw) };
    });

    // Second pass runs entirely out of the caches, and a third interleaved pass mixes hit and miss order.
    for (const row of cold) {
      expect(commodityMergeBucket(row.raw), `warm bucket for ${JSON.stringify(row.raw)}`).toBe(row.bucket);
      expect(commodityNormKey(row.raw), `warm norm for ${JSON.stringify(row.raw)}`).toBe(row.norm);
    }
    for (const row of [...cold].reverse()) {
      expect(commodityMergeBucket(row.raw)).toBe(row.bucket);
      expect(commodityNormKey(row.raw)).toBe(row.norm);
    }
  });

  it("keeps the merges and the non-merges that callers depend on", () => {
    const merges: Array<[string, string]> = [
      ["$TerrainEnrichmentSystems_name;", "Land Enrichment Systems"],
      ["$Steel_name;", "Steel"],
      ["Agri-Medicines", "agricultural medicines"],
      ["Agri-Medicines", "AgriculturalMedicines"],
      ["H.E. Suits", "HazardousEnvironmentSuits"],
      ["H.E. Suits", "$HazardousEnvironmentSuits_name;"],
      ["Semiconductors", "Semiconductor"],
      ["Liquid Oxygen", "liquid oxygen"],
      ["$CMMComposite_name;", "CMM Composite"],
      ["$InsulatingMembrane_name;", "Insulating Membrane"],
    ];
    for (const [a, b] of merges) {
      const ba = commodityMergeBucket(a);
      expect(ba, `${a} should resolve`).not.toBe("");
      expect(commodityMergeBucket(b), `${a} vs ${b}`).toBe(ba);
    }

    const distinct = [
      "Gold",
      "Silver",
      "Steel",
      "Titanium",
      "Beer",
      "Wine",
      "Water",
      "Water Purifiers",
      "Basic Medicines",
      "Agri-Medicines",
      "Semiconductors",
      "Superconductors",
    ];
    const buckets = distinct.map((x) => commodityMergeBucket(x));
    expect(new Set(buckets).size, `unrelated commodities collapsed: ${buckets.join(",")}`).toBe(
      distinct.length,
    );
  });

  it("resolves numeric FDev ids through the catalogue", () => {
    expect(commodityMergeBucket("128049152")).toBe(commodityMergeBucket("Platinum"));
    expect(resourceNeedId({ name: "128049152", nameLocalised: "Platinum" })).toBe(
      commodityMergeBucket("Platinum"),
    );
  });

  it("falls back to the norm key when nothing in the catalogue resolves", () => {
    // `resourceNeedId`'s third arm is the only thing keeping unknown rows out of the "" bucket.
    const row = { name: "totally unknown widget", nameLocalised: "" };
    expect(resourceNeedId(row)).toBe(commodityNormKey("totally unknown widget"));
    expect(resourceNeedId({ name: "", nameLocalised: "" })).toBe("");
  });

  it("bounds both caches no matter how many unique inputs arrive", () => {
    const { limit } = commodityKeyCacheSizesForTest();
    for (let i = 0; i < limit * 2 + 500; i++) {
      const raw = `Synthetic Commodity Number ${i}`;
      commodityMergeBucket(raw);
      commodityNormKey(raw);
    }
    const sizes = commodityKeyCacheSizesForTest();
    expect(sizes.mergeBucket).toBeLessThanOrEqual(limit);
    expect(sizes.normKey).toBeLessThanOrEqual(limit);
    // Eviction must not cost correctness: a string pushed out earlier still derives the same bucket.
    expect(commodityMergeBucket("$Steel_name;")).toBe("steel");
  });

  it("serves repeat calls from the cache instead of regrowing it", () => {
    for (const raw of REPRESENTATIVE_INPUTS) commodityMergeBucket(raw);
    const afterFirstPass = commodityKeyCacheSizesForTest().mergeBucket;
    for (let i = 0; i < 50; i++) {
      for (const raw of REPRESENTATIVE_INPUTS) commodityMergeBucket(raw);
    }
    expect(commodityKeyCacheSizesForTest().mergeBucket).toBe(afterFirstPass);
  });
});

describe("generated slug reverse index", () => {
  /**
   * `commodityCatalogNormKeys` now trusts the generator's reverse index instead of re-normalising every
   * slug at runtime. That is only safe while the generator's normaliser agrees with `commodityNormKey`,
   * so rebuild the index the slow way and demand an exact match.
   */
  it("matches an index rebuilt with commodityNormKey", () => {
    const rebuilt = new Map<string, string[]>();
    for (const [normKey, slugs] of Object.entries(COMMODITY_SPANSH_SLUGS_BY_NORM_KEY)) {
      for (const slug of slugs) {
        const slugNorm = commodityNormKey(slug);
        let arr = rebuilt.get(slugNorm);
        if (!arr) {
          arr = [];
          rebuilt.set(slugNorm, arr);
        }
        if (!arr.includes(normKey)) arr.push(normKey);
      }
    }

    const generated = new Map(Object.entries(COMMODITY_NORM_KEYS_BY_SLUG_NORM));
    expect(generated.size).toBe(rebuilt.size);
    for (const [slugNorm, normKeys] of rebuilt) {
      expect(generated.get(slugNorm), `slug norm ${slugNorm}`).toEqual(normKeys);
    }
  });

  it("yields the same keys in the same order as the catalogue scan it replaced", () => {
    // `spanshCommodity` spreads this Set into an array and treats the order as a preference order, so
    // reproducing the old scan's insertion order is part of the contract, not an implementation detail.
    const byScan = (...raws: string[]): string[] => {
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
      for (const [normKey, slugs] of Object.entries(COMMODITY_SPANSH_SLUGS_BY_NORM_KEY)) {
        if (out.has(normKey)) continue;
        for (const slug of slugs) {
          if (labelNorms.has(commodityNormKey(slug))) {
            out.add(normKey);
            break;
          }
        }
      }
      return [...out];
    };

    const pairs: Array<[string, string]> = [
      ["$HazardousEnvironmentSuits_name;", "H.E. Suits"],
      ["$TerrainEnrichmentSystems_name;", "Land Enrichment Systems"],
      ["Agri-Medicines", "agricultural medicines"],
      ["$Steel_name;", "Steel"],
      ["128049152", "Platinum"],
      ["Water", "Water Purifiers"],
      ["Fruit and Vegetables", "$Fruit_and_Veg_name;"],
      ["not a real commodity at all", ""],
    ];
    for (const [a, b] of pairs) {
      expect([...commodityCatalogNormKeys(a, b)], `${a} | ${b}`).toEqual(byScan(a, b));
    }
  });

  it("still links journal symbols to display names through the catalogue", () => {
    const keys = commodityCatalogNormKeys("$HazardousEnvironmentSuits_name;", "H.E. Suits");
    expect(keys.has("hazardousenvironmentsuits")).toBe(true);
    expect(keys.has("hesuits")).toBe(true);
  });
});

describe("expandCommodityKeys", () => {
  it("still reaches its fixed point for plural and agri forms", () => {
    expect(new Set(expandCommodityKeys("agriculturalmedicines"))).toEqual(
      new Set(["agriculturalmedicines", "agriculturalmedicine", "agrimedicines", "agrimedicine"]),
    );
    expect(expandCommodityKeys("")).toEqual([]);
  });
});

describe("commoditySlugAliasesForKeys", () => {
  it("survives a commodity name that collides with an Object prototype member", () => {
    // These keys index a plain object, so an unguarded lookup returns an inherited function
    // and the caller then tries to iterate it.
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(() => commoditySlugAliasesForKeys(new Set([name]))).not.toThrow();
      expect(commoditySlugAliasesForKeys(new Set([name])).size).toBe(0);
    }
  });
});
