/**
 * Every browser-storage key the renderer owns, in one place.
 *
 * These were previously spelled out as string constants beside whichever component
 * happened to need them, each with its own hand-rolled try/catch around `localStorage`.
 * That made two things impossible to see: which keys exist at all, and what happens to an
 * old one when its shape changes. Both matter, because storage survives upgrades.
 *
 * The `-vN` suffix is the schema version. Bump it when the stored shape changes in a way
 * the parser cannot absorb; the old key is then simply ignored and the default applies.
 * `LEGACY_KEYS` lists keys previous versions wrote, so they can be cleaned up.
 */
export const STORAGE_KEYS = {
  appMode: "edexo-colonize-app-mode-v1",
  basket: "edexo-colonize-basket-v2",
  autoBasketSync: "edexo-colonize-auto-basket-v1",
  checkoutFilters: "edexo-colonize-checkout-filters-v1",
  checkoutRouting: "edexo-colonize-checkout-routing-v1",
  shoppingRun: "edexo-colonize-shopping-run-v1",
  depotRefPins: "edexo-colonize-depot-ref-pins-v1",
  debugSpanshSystem: "edexo-colonize-debug-spansh-system-v1",
  /** Which carriers the commander has switched on for hauling, by CarrierID. */
  carrierHaul: "edexo-colonize-carrier-haul-v1",
} as const;

/** Written by earlier versions. Read once for migration, then removed. */
export const LEGACY_KEYS = {
  basketV1: "edexo-colonize-basket-v1",
  /** Per-depot pinned hub, one key per market id: `edexo-colonize-depot-ref-<marketId>`. */
  depotRefPrefix: "edexo-colonize-depot-ref-",
} as const;

/**
 * Storage can throw outright, not just return null: a browser with site data blocked
 * raises on access. Every read and write here is therefore guarded, and a failure means
 * the app runs with defaults rather than not running.
 */
export function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage unavailable or full — the session continues without persistence. */
  }
}

export function removeRaw(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* As above. */
  }
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

/** All per-depot pin keys an older build left behind, so they can be folded into one record. */
export function readLegacyDepotRefPins(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LEGACY_KEYS.depotRefPrefix)) continue;
      const marketId = key.slice(LEGACY_KEYS.depotRefPrefix.length);
      const value = readRaw(key)?.trim();
      if (marketId && value) out[marketId] = value;
    }
  } catch {
    return out;
  }
  return out;
}

export function clearLegacyDepotRefPins(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LEGACY_KEYS.depotRefPrefix)) stale.push(key);
    }
    for (const key of stale) removeRaw(key);
  } catch {
    /* Leaving the old keys behind is harmless; they are simply ignored. */
  }
}
