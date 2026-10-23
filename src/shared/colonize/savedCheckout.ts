import type { BasketCheckoutBundle } from "./types";
import { parseSavedCheckout } from "./storageValidation";
import { storageGet, storageSet, storageRemove } from "./storage";

const LAST_CHECKOUT_KEY = "edexo-colonize-last-checkout-v1";

/**
 * The sellers the plan last routed against, and when they were gathered. (It also held a single-site `result`, a
 * leftover of EDEXO-Colonize's checkout dialog that 1.3.0 only ever saved as null; an old payload's is ignored.)
 */
export type SavedCheckout = {
  savedAt: string;
  bundle: BasketCheckoutBundle | null;
};

/** In-memory copy — checkout payloads run 50–500 KB; re-parsing on every panel mount stalls tab switches. */
let savedCheckoutCache: SavedCheckout | null | undefined;

export function loadSavedCheckout(): SavedCheckout | null {
  if (savedCheckoutCache !== undefined) return savedCheckoutCache;
  try {
    const raw = storageGet(LAST_CHECKOUT_KEY);
    const j = raw ? parseSavedCheckout(JSON.parse(raw)) : null;
    savedCheckoutCache = j;
  } catch {
    savedCheckoutCache = null;
  }
  return savedCheckoutCache;
}

function saveCheckoutSnapshot(snapshot: SavedCheckout): void {
  try {
    savedCheckoutCache = snapshot;
    storageSet(LAST_CHECKOUT_KEY, JSON.stringify(snapshot));
  } catch {
    /* */
  }
}

export function clearSavedCheckout(): void {
  savedCheckoutCache = null;
  try {
    storageRemove(LAST_CHECKOUT_KEY);
  } catch {
    /* */
  }
}

let pendingSave: SavedCheckout | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced persist — checkout payloads run 50–500 KB and stringify+write blocks the UI thread. The time stamped
 * here is when the sellers were gathered: the plan's "Sellers last gathered" reads it, so only new sellers save.
 */
export function scheduleSaveCheckoutSnapshot(bundle: BasketCheckoutBundle | null, debounceMs = 450): void {
  const snapshot: SavedCheckout = { savedAt: new Date().toISOString(), bundle };
  savedCheckoutCache = snapshot;
  pendingSave = snapshot;
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const next = pendingSave;
    pendingSave = null;
    if (next) saveCheckoutSnapshot(next);
  }, debounceMs);
}
