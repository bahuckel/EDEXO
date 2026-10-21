/**
 * The Colonize window's settings and progress that live on the server (1.3.0 phase 5, `colonize/ui-state.json`),
 * so the app window, a browser tab and the next start all see the same: trip ticks, the trade party, banned stations,
 * planner settings, the wing's claims, the hold override, the carriers switched on, filters and pinned hubs.
 *
 * Caches stay in the browser (shop history, the last plan, distances, station colours, the debug system), and so does
 * what belongs to one window (its tab). A key not listed here is never stored on the server.
 */
export const COLONIZE_SYNCED_KEYS = [
  "edexo-colonize-trip-plan-snapshot-v3",
  "edexo-colonize-trade-party-v1",
  "edexo-colonize-banned-stations-v1",
  "edexo-colonize-planner-settings-v1",
  "edexo-colonize-wing-manifest-v1",
  "edexo-colonize-cargo-capacity-v1",
  "edexo-colonize-carrier-haul-v1",
  "edexo-colonize-basket-v2",
  "edexo-colonize-auto-basket-v1",
  "edexo-colonize-checkout-filters-v1",
  "edexo-colonize-checkout-routing-v1",
  "edexo-colonize-shopping-run-v1",
  "edexo-colonize-depot-ref-pins-v1",
] as const;

export type ColonizeSyncedKey = (typeof COLONIZE_SYNCED_KEYS)[number];

const SYNCED = new Set<string>(COLONIZE_SYNCED_KEYS);

export function isColonizeSyncedKey(key: string): key is ColonizeSyncedKey {
  return SYNCED.has(key);
}

/** One value at most this long (a trip plan with hundreds of ticks is ~50 kB); the whole file at most the sum. */
export const MAX_UI_STATE_VALUE_CHARS = 1_000_000;

/** A change: a key's new text, or null when it was removed. */
export type ColonizeUiStateSet = Partial<Record<ColonizeSyncedKey, string | null>>;

/** Pushed on the `colonize` socket when a window saved something; `from` is the window that did. */
export type ColonizeUiStateChange = { set: ColonizeUiStateSet; from: string | null };

/** The keys and values of a change that may be stored: listed keys, text no longer than the limit, or null. */
export function cleanUiStateSet(raw: unknown): ColonizeUiStateSet {
  const out: ColonizeUiStateSet = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isColonizeSyncedKey(k)) continue;
    if (v === null) out[k] = null;
    else if (typeof v === "string" && v.length <= MAX_UI_STATE_VALUE_CHARS) out[k] = v;
  }
  return out;
}
