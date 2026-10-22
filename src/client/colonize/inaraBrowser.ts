/**
 * Inara in the EDEXO Browser (1.3.0, C5; owner 2026-10-22): Colonize's Inara links open Inara's commodity search in
 * the app's own Browser tab, and "Read into Colonize" on that page takes the sellers it shows into the saved sellers,
 * as an Inara import. Only the page the commander opened, only when asked: nothing is fetched or crawled
 * (electron/browserTabs.cjs `readInara`). Where there is no EDEXO Browser (a system browser, a phone), the links open
 * a normal browser tab as before.
 */
import { inaraCommodityNormForPa1 } from "../../shared/colonize/inaraCommodityIds";
import { parseInaraBuyResultsHtml } from "../../shared/colonize/inaraScrapeParse";
import { INARA_INDEX_REF, type InaraImportFile } from "../../shared/colonize/inaraImportTypes";
import { BROWSER_AVAILABLE, tabStore } from "../tabs/tabStore";
import { colonizeApi } from "./api";

/** What the main process read from the page (browserTabs.cjs readInara). */
export type InaraPageRead = { url: string; table: string; near: string; commodities: string[] };

type Bridge = { readInara?: (id: number) => Promise<({ ok: true } & InaraPageRead) | { error: string }> };
const bridge = (): Bridge | null =>
  (window as unknown as { edexoElectron?: { browser?: Bridge } }).edexoElectron?.browser ?? null;

/** Inara's commodity search, the only page "Read into Colonize" reads (the main process checks it again). */
export function isInaraCommodityPage(url: string | null | undefined): boolean {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && /^(www\.)?inara\.cz$/i.test(u.hostname) && /^\/elite\/commodities\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

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

/** Reads the Inara page open in browser tab `id` into the saved sellers; the line to show the commander. */
export async function readInaraIntoColonize(id: number): Promise<{ ok: boolean; text: string }> {
  const b = bridge();
  if (!b?.readInara) return { ok: false, text: "Reading pages needs the desktop app." };
  const r = await b.readInara(id);
  if ("error" in r) return { ok: false, text: r.error };
  const doc = inaraImportFromPage(r);
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

/** An address waiting for the Browser tab to open (BrowserScreen takes it once its pages are ready). */
let pending: string | null = null;
const OPEN_EVENT = "edexo:browser-open-url";

/** The address BrowserScreen should open, taken once. */
export function takePendingBrowserUrl(): string | null {
  const u = pending;
  pending = null;
  return u;
}
/** BrowserScreen, while on screen: called with each address asked for. Returns an unsubscribe. */
export function onBrowserUrlRequest(cb: () => void): () => void {
  window.addEventListener(OPEN_EVENT, cb);
  return () => window.removeEventListener(OPEN_EVENT, cb);
}

/**
 * Opens `url` in the app's Browser tab when there is one (desktop app, tab view on), else in a new browser tab.
 * Returns false when it fell back to a normal link (the caller's `<a target=_blank>` does that by itself).
 */
export function openInEdexoBrowser(url: string): boolean {
  if (!BROWSER_AVAILABLE || !tabStore.get().on) return false;
  pending = url;
  tabStore.open("browser");
  window.dispatchEvent(new Event(OPEN_EVENT));
  return true;
}
