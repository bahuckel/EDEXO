/**
 * The Colonize window's settings and progress, kept on the server (1.3.0 phase 5; keys in uiStateKeys.ts,
 * server in src/server/colonize/uiState.ts).
 *
 * Before the window draws, `loadColonizeUiState` copies the server's values into this browser's localStorage, where
 * the window's state reads them. The first window ever (the server holds nothing yet) uploads what its browser has,
 * so settings made before 1.3.0's server copy are kept. After that the server's copy wins: a key it does not hold was
 * cleared elsewhere and is cleared here too. Then every write of a listed key goes up, batched, and another window's
 * saves come down on the socket (`onRemoteUiState`).
 */
import { colonizeApi } from "./api";
import { setColonizeStorageSink, storageGet, storageSetLocal } from "../../shared/colonize/storage";
import { COLONIZE_SYNCED_KEYS, type ColonizeSyncedKey, type ColonizeUiStateSet } from "../../shared/colonize/uiStateKeys";

const URL = "/api/colonize/ui-state";
const SAVE_DELAY_MS = 250;
const RETRY_MS = 5_000;
/** This window, so its own saves coming back on the socket are not applied twice. */
export const COLONIZE_WINDOW_ID = Math.random().toString(36).slice(2, 12);

let pending: ColonizeUiStateSet = {};
let timer: ReturnType<typeof setTimeout> | null = null;

async function put(set: ColonizeUiStateSet, keepalive = false): Promise<boolean> {
  try {
    const r = await fetch(URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ set, from: COLONIZE_WINDOW_ID }),
      keepalive,
    });
    return r.ok;
  } catch {
    return false;
  }
}

function flushSoon(delay = SAVE_DELAY_MS): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const set = pending;
    pending = {};
    if (!Object.keys(set).length) return;
    void put(set).then((ok) => {
      if (ok) return;
      // Not saved (server restarting): try again, newer values for the same key winning.
      pending = { ...set, ...pending };
      flushSoon(RETRY_MS);
    });
  }, delay);
}

function queue(key: ColonizeSyncedKey, value: string | null): void {
  pending[key] = value;
  flushSoon();
}

const remoteSubs = new Set<(keys: ColonizeSyncedKey[]) => void>();
/** Another window saved something, already in this browser's storage; the listener decides how to show it. */
export function onRemoteUiState(fn: (keys: ColonizeSyncedKey[]) => void): () => void {
  remoteSubs.add(fn);
  return () => remoteSubs.delete(fn);
}

let loaded: Promise<"server" | "local"> | null = null;

/**
 * Copies the server's values in (or seeds the server), then turns on saving. "local" when the server could not be
 * asked: the window then runs on this browser's storage alone and saves nothing to the server.
 */
export function loadColonizeUiState(): Promise<"server" | "local"> {
  return (loaded ??= (async () => {
    let values: Record<string, unknown>;
    let seeded: boolean;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4_000);
      const r = await fetch(URL, { signal: ctl.signal }).finally(() => clearTimeout(t));
      const j = (await r.json()) as { ok?: boolean; values?: Record<string, unknown>; seeded?: boolean };
      if (!r.ok || !j.ok || !j.values) return "local";
      values = j.values;
      seeded = j.seeded === true;
    } catch {
      return "local";
    }
    const upload: ColonizeUiStateSet = {};
    for (const key of COLONIZE_SYNCED_KEYS) {
      const server = values[key];
      if (typeof server === "string") storageSetLocal(key, server);
      else if (seeded) storageSetLocal(key, null);
      else {
        const local = storageGet(key);
        if (local != null) upload[key] = local;
      }
    }
    if (Object.keys(upload).length) await put(upload);
    setColonizeStorageSink(queue);
    colonizeApi.onUiState(({ set, from }) => {
      if (from === COLONIZE_WINDOW_ID) return;
      const keys = Object.keys(set) as ColonizeSyncedKey[];
      for (const k of keys) storageSetLocal(k, set[k] ?? null);
      for (const fn of remoteSubs) fn(keys);
    });
    // Closing the window inside the batching delay still saves the last tick.
    window.addEventListener("pagehide", () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (Object.keys(pending).length) void put(pending, true);
      pending = {};
    });
    return "server";
  })());
}
