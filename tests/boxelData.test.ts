/**
 * The boxel tables as data (plan 2.1, 2026-10-11): `data/boxel/*.json`, read by the shared modules that
 * used to carry 2,700 lines of generated TypeScript (code review C9). Every mass code present, counts
 * that can be shares, golden rows of seven fields.
 */
import { describe, expect, it } from "vitest";
import { BOXEL_RATES } from "../src/shared/boxelRates.js";
import { BOXEL_BIO_GOLDEN, BOXEL_BIO_RATES } from "../src/shared/boxelBioRates.js";
import { BOXEL_POSITION_GOLDEN } from "../src/shared/boxelPositionGolden.js";

const CODES = [..."abcdefgh"];

describe("boxel tables from data/boxel", () => {
  it("has every mass code, with hits no larger than the systems counted", () => {
    for (const table of [BOXEL_RATES, BOXEL_BIO_RATES]) {
      expect(Object.keys(table).sort()).toEqual(CODES);
      for (const m of CODES) {
        for (const part of ["all", "aaA"] as const) {
          const c = table[m]![part];
          expect(c.n).toBeGreaterThanOrEqual(0);
          for (const v of Object.values(c.hits)) expect(v).toBeLessThanOrEqual(c.n);
        }
        expect(table[m]!.all.n).toBeGreaterThan(0);
      }
    }
    expect(BOXEL_RATES.a!.heliumRichBodies).toBeGreaterThanOrEqual(0);
  });

  it("keeps the golden rows' seven fields", () => {
    expect(BOXEL_BIO_GOLDEN.length).toBeGreaterThan(0);
    expect(BOXEL_POSITION_GOLDEN.length).toBe(34);
    for (const g of [...BOXEL_BIO_GOLDEN, ...BOXEL_POSITION_GOLDEN]) {
      expect(g).toHaveLength(7);
      expect(CODES).toContain(g[1]);
      expect(g[4]).toBeLessThanOrEqual(g[3]);
    }
  });
});
