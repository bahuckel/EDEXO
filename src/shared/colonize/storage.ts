/**
 * The Colonize window's browser storage, in one place: localStorage, guarded (a browser with site data blocked throws
 * on access), and for the keys in uiStateKeys.ts also the server (`setColonizeStorageSink`, set by the window's
 * client once it has loaded the server's copy). Every Colonize module reads and writes through here, never
 * `localStorage` directly, so nothing that should reach the server can miss it.
 */
import { isColonizeSyncedKey, type ColonizeSyncedKey } from "./uiStateKeys";

type Sink = (key: ColonizeSyncedKey, value: string | null) => void;
let sink: Sink | null = null;

/** Where a synced key's changes go (the client's batched PUT); null in tests and before the server copy loaded. */
export function setColonizeStorageSink(next: Sink | null): void {
  sink = next;
}

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function storageGet(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Only localStorage, never the server: for a value that came from the server. */
export function storageSetLocal(key: string, value: string | null): void {
  try {
    const s = store();
    if (!s) return;
    if (value == null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* storage full or blocked: the session goes on without it */
  }
}

export function storageSet(key: string, value: string): void {
  if (storageGet(key) === value) return;
  storageSetLocal(key, value);
  if (sink && isColonizeSyncedKey(key)) sink(key, value);
}

export function storageRemove(key: string): void {
  if (storageGet(key) == null) return;
  storageSetLocal(key, null);
  if (sink && isColonizeSyncedKey(key)) sink(key, null);
}
