import type { BasketCheckoutBundle, BasketCheckoutResult } from "./types";
import { parseSavedCheckout } from "./storageValidation";

const LAST_CHECKOUT_KEY = "edexo-colonize-last-checkout-v1";

export type SavedCheckout = {
  savedAt: string;
  result: BasketCheckoutResult | null;
  bundle: BasketCheckoutBundle | null;
};

/** In-memory copy — checkout payloads run 50–500 KB; re-parsing on every panel mount stalls tab switches. */
let savedCheckoutCache: SavedCheckout | null | undefined;

export function loadSavedCheckout(): SavedCheckout | null {
  if (savedCheckoutCache !== undefined) return savedCheckoutCache;
  try {
    const raw = localStorage.getItem(LAST_CHECKOUT_KEY);
    const j = raw ? parseSavedCheckout(JSON.parse(raw)) : null;
    savedCheckoutCache = j;
  } catch {
    savedCheckoutCache = null;
  }
  return savedCheckoutCache;
}

function saveCheckoutSnapshot(result: BasketCheckoutResult | null, bundle: BasketCheckoutBundle | null): void {
  try {
    const payload: SavedCheckout = { savedAt: new Date().toISOString(), result, bundle };
    savedCheckoutCache = payload;
    localStorage.setItem(LAST_CHECKOUT_KEY, JSON.stringify(payload));
  } catch {
    /* */
  }
}

export function clearSavedCheckout(): void {
  savedCheckoutCache = null;
  try {
    localStorage.removeItem(LAST_CHECKOUT_KEY);
  } catch {
    /* */
  }
}

let pendingSave: { result: BasketCheckoutResult | null; bundle: BasketCheckoutBundle | null } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced persist — checkout payloads run 50–500 KB and stringify+write blocks the UI thread. */
export function scheduleSaveCheckoutSnapshot(
  result: BasketCheckoutResult | null,
  bundle: BasketCheckoutBundle | null,
  debounceMs = 450,
): void {
  savedCheckoutCache = { savedAt: new Date().toISOString(), result, bundle };
  pendingSave = { result, bundle };
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const next = pendingSave;
    pendingSave = null;
    if (next) saveCheckoutSnapshot(next.result, next.bundle);
  }, debounceMs);
}
