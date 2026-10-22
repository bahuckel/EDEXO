/**
 * Inara in the EDEXO Browser (1.3.0, C5): the page "Read into Colonize" reads becomes an Inara import file, one
 * commodity at a time, its near star from the form or the address.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inaraImportFromPage, isInaraCommodityPage } from "../../src/client/colonize/inaraBrowser";
import { parseInaraImportFile } from "../../src/shared/colonize/inaraImportTypes";

const table = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/inara-buy-results.html"), "utf8");
const URL_ = "https://inara.cz/elite/commodities/?formbrief=1&pi1=1&pa1%5B%5D=140&ps1=Sol";
const NOW = new Date("2026-10-22T10:00:00Z");

describe("inaraImportFromPage", () => {
  it("makes an import file the server takes: the form's commodity and near star, the table's sellers", () => {
    const doc = inaraImportFromPage({ url: URL_, table, near: "Swoilz BY-D c1-13", commodities: ["CMM Composite"] }, NOW);
    if ("err" in doc) throw new Error(doc.err);
    expect(doc.commodityLabel).toBe("CMM Composite");
    expect(doc.nearSystem).toBe("Swoilz BY-D c1-13");
    expect(doc.scrapedAt).toBe(NOW.toISOString());
    expect(doc.stations[0]!.stationName).toBe("Broot's Prospect");
    expect(parseInaraImportFile(JSON.parse(JSON.stringify(doc)))).not.toBeNull();
  });

  it("falls back to the address for the commodity and the near star", () => {
    const doc = inaraImportFromPage({ url: URL_, table, near: "", commodities: [] }, NOW);
    if ("err" in doc) throw new Error(doc.err);
    expect(doc.commodityLabel).toMatch(/^cmmcomposites?$/);
    expect(doc.nearSystem).toBe("Sol");
  });

  it("says why when it cannot: several commodities, none, or no sellers", () => {
    expect(inaraImportFromPage({ url: URL_, table, near: "Sol", commodities: ["Steel", "Aluminium"] }, NOW)).toEqual({
      err: "Search for one commodity at a time on Inara, then read the page.",
    });
    expect(inaraImportFromPage({ url: "https://inara.cz/elite/commodities/", table, near: "", commodities: [] }, NOW)).toEqual({
      err: "Pick a commodity in Inara's search first.",
    });
    expect(inaraImportFromPage({ url: URL_, table: "<table></table>", near: "Sol", commodities: ["Steel"] }, NOW)).toEqual({
      err: "No sellers in the table on this page.",
    });
  });
});

describe("isInaraCommodityPage", () => {
  it("is Inara's commodity search over https, nothing else", () => {
    expect(isInaraCommodityPage(URL_)).toBe(true);
    expect(isInaraCommodityPage("https://www.inara.cz/elite/commodities")).toBe(true);
    expect(isInaraCommodityPage("http://inara.cz/elite/commodities/")).toBe(false);
    expect(isInaraCommodityPage("https://inara.cz/elite/stations/")).toBe(false);
    expect(isInaraCommodityPage("https://inara.cz.evil.example/elite/commodities/")).toBe(false);
    expect(isInaraCommodityPage("not a url")).toBe(false);
  });
});
