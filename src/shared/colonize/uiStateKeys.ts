/**
 * The Colonize window's settings and progress that live on the server (1.3.0 phase 5, `colonize/ui-state.json`),
 * so the app window, a browser tab and the next start all see the same: trip ticks, the trade party, banned stations,
 * planner settings, the wing's claims, the hold override, the carriers switched on, filters and pinned hubs.
 *
 * Caches stay in the browser (shop history, the last plan, distances), and so does what belongs to one window (its
 * tab). A key not listed here is never stored on the server.
 */

/*
  Each key once, by name: the window, the phone view and the HUD summary spelled some of them out in up to four
  places (audit 2026-10-22).
*/
export const KEY_TRIP_PLAN = "edexo-colonize-trip-plan-snapshot-v3";
export const KEY_TRADE_PARTY = "edexo-colonize-trade-party-v1";
export const KEY_BANNED_STATIONS = "edexo-colonize-banned-stations-v1";
export const KEY_PLANNER_SETTINGS = "edexo-colonize-planner-settings-v1";
export const KEY_WING_MANIFEST = "edexo-colonize-wing-manifest-v1";
export const KEY_CARGO_CAPACITY = "edexo-colonize-cargo-capacity-v1";
export const KEY_CARRIER_HAUL = "edexo-colonize-carrier-haul-v1";
export const KEY_CHECKOUT_FILTERS = "edexo-colonize-checkout-filters-v1";
export const KEY_CHECKOUT_ROUTING = "edexo-colonize-checkout-routing-v1";
export const KEY_DEPOT_REF_PINS = "edexo-colonize-depot-ref-pins-v1";
/** Each site's own plan rules and "systems per material" (discuss item 1, projectSettings.ts). */
export const KEY_PROJECTS = "edexo-colonize-projects-v1";
/** The site the HUD follows when not docked at one: its market id (discuss item 9). */
export const KEY_HUD_FOLLOW = "edexo-colonize-hud-follow-v1";

/*
  The basket (basket-v2, auto-basket-v1) and the shopping run (shopping-run-v1) left the list with their state in
  1.3.0 (audit 2026-10-22): nothing showed them. A server file that still holds them drops them as it loads
  (cleanUiStateSet), and the window removes its own copies (state/persisted.ts RETIRED_KEYS).
*/
export const COLONIZE_SYNCED_KEYS = [
  KEY_TRIP_PLAN,
  KEY_TRADE_PARTY,
  KEY_BANNED_STATIONS,
  KEY_PLANNER_SETTINGS,
  KEY_WING_MANIFEST,
  KEY_CARGO_CAPACITY,
  KEY_CARRIER_HAUL,
  KEY_CHECKOUT_FILTERS,
  KEY_CHECKOUT_ROUTING,
  KEY_DEPOT_REF_PINS,
  KEY_PROJECTS,
  KEY_HUD_FOLLOW,
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
