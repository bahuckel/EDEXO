/**
 * Inara in the EDEXO Browser (1.3.0, C5; owner 2026-10-22): Colonize's Inara links open Inara's commodity search in
 * the app's own Browser tab, and an EDEXO pop-up on that page ("EDEXO — Read" / "Cancel") takes the sellers it shows
 * into the saved sellers, as an Inara import. Only the page the commander opened, only when asked: nothing is fetched
 * or crawled (electron/browserTabs.cjs `openInara`, `inaraOfferScript`). Where there is no EDEXO Browser (a system
 * browser, a phone), the links open a normal browser tab as before.
 *
 * Which pages the pop-up reads is the main process's call alone (browserTabs.cjs `isInaraCommodityPage`, tested in
 * tests/browserTabs.test.ts); the copy that lived here was used by nothing but its test (audit 2026-10-22).
 *
 * The "open this address in the Browser tab" part is in tabs/browserOpen.ts, so Compare's Browser tab does not load
 * this module (and Colonize's request map behind it) until a page is read. Re-exported for Colonize's views.
 */
import { inaraCommodityNormForPa1 } from "../../shared/colonize/inaraCommodityIds";
import { parseInaraBuyResultsHtml } from "../../shared/colonize/inaraScrapeParse";
import { INARA_INDEX_REF, type InaraImportFile } from "../../shared/colonize/inaraImportTypes";
import { colonizeApi } from "./api";

export { onBrowserUrlRequest, openInEdexoBrowser, takePendingBrowserUrl } from "../tabs/browserOpen";

/** What the main process read from the page (browserTabs.cjs readInaraPage). */
export type InaraPageRead = { url: string; table: string; near: string; commodities: string[] };

/**
 * The page as an Inara import file (inaraImportTypes.ts), or why not. One commodity at a time: a search for several
 * mixes their sellers in one table, with nothing in a row to say which commodity it is.
 */
export function inaraImportFromPage(read: InaraPageRead, now = new Date()): InaraImportFile | { err: string } {
  let commodities = read.commodities.map((c) => c.trim()).filter(Boolean);
  let near = read.near.trim();
  try {
    const q = new URL(read.url).searchParams;
    if (!commodities.length) {
      const ids = q.getAll("pa1[]").map(Number).filter(Number.isFinite);
      commodities = ids.map(inaraCommodityNormForPa1).filter((x): x is string => !!x);
      if (!commodities.length && q.get("search")) commodities = [q.get("search")!.trim()];
    }
    if (!near) near = q.get("ps1")?.trim() ?? "";
  } catch {
    /* the address is the main process's own; a bad one leaves what the page said */
  }
  if (commodities.length !== 1) {
    return { err: commodities.length ? "Search for one commodity at a time on Inara, then read the page." : "Pick a commodity in Inara's search first." };
  }
  const stations = parseInaraBuyResultsHtml(read.table);
  if (!stations.length) return { err: "No sellers in the table on this page." };
  return {
    version: 1,
    source: "inara",
    scrapedAt: now.toISOString(),
    nearSystem: near || INARA_INDEX_REF,
    commodityLabel: commodities[0]!,
    stations,
  };
}

/** What an Inara pop-up's "EDEXO — Read" took, saved with the sellers as an Inara import; the line to show. */
export async function importInaraRead(read: InaraPageRead): Promise<{ ok: boolean; text: string }> {
  const doc = inaraImportFromPage(read);
  if ("err" in doc) return { ok: false, text: doc.err };
  const res = await colonizeApi.importInaraFile({ fileName: "inara-browser.json", text: JSON.stringify(doc) });
  if (!res.ok) return { ok: false, text: res.err };
  return {
    ok: true,
    text: `${res.commodityLabel}: ${res.merged.toLocaleString("en-US")} seller${res.merged === 1 ? "" : "s"} read into Colonize${
      res.nearSystem && res.nearSystem !== INARA_INDEX_REF ? ` (near ${res.nearSystem})` : ""
    }.`,
  };
}
