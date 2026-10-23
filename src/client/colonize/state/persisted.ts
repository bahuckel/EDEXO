/**
 * Every browser-storage key the window's UI state owns, in one place.
 *
 * These were previously spelled out as string constants beside whichever component
 * happened to need them, each with its own hand-rolled try/catch around `localStorage`.
 * That made two things impossible to see: which keys exist at all, and what happens to an
 * old one when its shape changes. Both matter, because storage survives upgrades.
 *
 * The `-vN` suffix is the schema version. Bump it when the stored shape changes in a way
 * the parser cannot absorb; the old key is then simply ignored and the default applies.
 */
import { storageGet, storageRemove, storageSet, storageSetLocal } from "../../../shared/colonize/storage";
import {
  KEY_CARRIER_HAUL,
  KEY_CHECKOUT_FILTERS,
  KEY_CHECKOUT_ROUTING,
  KEY_DEPOT_REF_PINS,
  KEY_HUD_FOLLOW,
  KEY_PROJECTS,
} from "../../../shared/colonize/uiStateKeys";

export const STORAGE_KEYS = {
  checkoutFilters: KEY_CHECKOUT_FILTERS,
  checkoutRouting: KEY_CHECKOUT_ROUTING,
  depotRefPins: KEY_DEPOT_REF_PINS,
  projects: KEY_PROJECTS,
  hudFollow: KEY_HUD_FOLLOW,
  /** Which carriers the commander has switched on for hauling, by CarrierID. */
  carrierHaul: KEY_CARRIER_HAUL,
} as const;

/**
 * Keys nothing reads any more (audit 2026-10-22): EDEXO-Colonize's app mode, basket (both versions), auto-basket
 * switch and shopping run, none of them shown in 1.3.0, and a debug system nothing ever read. Removed from this
 * browser once per start; the server's copy drops the synced ones on its own (uiStateKeys.ts).
 */
export const RETIRED_KEYS = [
  "edexo-colonize-app-mode-v1",
  "edexo-colonize-basket-v1",
  "edexo-colonize-basket-v2",
  "edexo-colonize-auto-basket-v1",
  "edexo-colonize-shopping-run-v1",
  "edexo-colonize-debug-spansh-system-v1",
] as const;

let retiredCleared = false;
/** Local only: none of these is a synced key any more, so there is nothing to tell the server. */
export function clearRetiredKeys(): void {
  if (retiredCleared) return;
  retiredCleared = true;
  for (const key of RETIRED_KEYS) storageSetLocal(key, null);
}

/**
 * Storage can throw outright, not just return null: a browser with site data blocked
 * raises on access. Every read and write here is therefore guarded, and a failure means
 * the app runs with defaults rather than not running.
 */
export function readRaw(key: string): string | null {
  return storageGet(key);
}

/** Through shared/colonize/storage.ts, so a key that lives on the server (uiStateKeys.ts) reaches it. */
export function writeRaw(key: string, value: string): void {
  storageSet(key, value);
}

export function removeRaw(key: string): void {
  storageRemove(key);
}

/** Read and parse, falling back whenever the value is absent, corrupt or the wrong shape. */
export function readJson<T>(key: string, parse: (raw: unknown) => T | null, fallback: T): T {
  const raw = readRaw(key);
  if (raw == null) return fallback;
  try {
    return parse(JSON.parse(raw) as unknown) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeRaw(key, JSON.stringify(value));
  } catch {
    /* A value that cannot be serialised is a programming error, not a user-facing one. */
  }
}
