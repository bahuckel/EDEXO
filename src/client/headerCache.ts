import type { AppSnapshot } from "@shared/types";

/*
  The last header, kept for the next load of this window (UI ideas 2026-11-16 §4.8). A reload, or a phone tab the
  browser threw away in the background and loads again, drew "Connecting…" until the socket's first frame was in
  (~90 ms here, more over the LAN); now the header is drawn from this copy at once, shown offline, and the live state
  replaces it when it comes. sessionStorage: it belongs to this window and dies with it, so a new start of the app
  never shows yesterday's system.

  Kept without the big fields the header does not read, the ones the Colonize window's `shell` channel leaves out
  (server/wsChannels.ts SHELL_OMIT): about 20 KB instead of ~1 MB, written once when the page is hidden or left.
*/
const KEY = "edexo.headerSnapshot.v1";

/** SHELL_OMIT's fields, emptied (tests/headerCache.test.ts keeps the two lists equal), and the overlay's body. */
export const HEADER_CACHE_EMPTY = {
  footScannedEntries: [],
  journalSystems: [],
  bodies: [],
  organicPendingLines: [],
  systemMap: null,
  exoOverlayFocusBody: null,
} satisfies Partial<AppSnapshot>;

export function slimForHeader(snap: AppSnapshot): AppSnapshot {
  return { ...snap, ...HEADER_CACHE_EMPTY };
}

export function saveHeaderSnapshot(snap: AppSnapshot | null): void {
  // A booting journal draws the boot screen, not the header: nothing worth keeping.
  if (!snap || snap.journalBoot) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(slimForHeader(snap)));
  } catch {
    /* storage full or blocked: the next load waits for the socket, as before */
  }
}

export function loadHeaderSnapshot(): AppSnapshot | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as AppSnapshot;
    return snap && typeof snap === "object" && !snap.journalBoot ? { ...snap, ...HEADER_CACHE_EMPTY } : null;
  } catch {
    return null;
  }
}
