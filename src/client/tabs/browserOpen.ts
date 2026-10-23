/**
 * "Open this address in the Browser tab" (1.3.0, C5): Colonize's Inara links ask, BrowserScreen opens it.
 *
 * Split out of colonize/inaraBrowser.ts (audit 2026-10-22): BrowserScreen needs only this small part, and importing
 * it from there made Compare's Browser tab load Colonize's Inara reader with it (the Inara parsers, the commodity
 * tables, the whole Colonize request map and its socket). The reader is now loaded when "EDEXO — Read" is pressed.
 */
import { BROWSER_AVAILABLE, heldElsewhere, tabStore } from "./tabStore";

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
  /*
    The browser is on screen in the other app's window (one Browser tab across Compare and Colonize): the page opens
    there, and that window comes forward (owner, 2026-10-22: the Browser opened in Compare; the address was kept here,
    where no Browser tab took it).
  */
  const b = (window as unknown as { edexoElectron?: { browser?: { openInara?: (u: string) => Promise<unknown> } } }).edexoElectron
    ?.browser;
  if (!tabStore.get().tabs.includes("browser") && heldElsewhere("browser") && b?.openInara) {
    void b.openInara(url).catch(() => {});
    tabStore.open("browser");
    return true;
  }
  pending = url;
  tabStore.open("browser");
  window.dispatchEvent(new Event(OPEN_EVENT));
  return true;
}
