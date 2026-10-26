/*
  The commander this server run is for (per-commander profiles, 1.3.1). One per run: switching commander starts the
  server again (electron/serverChild.cjs), so every module that loads a commander's file at start simply loads the
  right one. Set once, at the very start of startEdexo, before anything reads a journal or a saved file.

  Chosen as: EDEXO_COMMANDER (the launcher's dropdown, passed by the desktop app; or --commander on the console
  server), else the commander of the newest journal — the one playing if the game is up, else the one who played last
  (owner, 2026-10-25).
*/
import { listJournalCommanders, type CommanderSummary, type JournalCommander } from "./journalCommanders.js";

let active: JournalCommander | null = null;

export function activeCommander(): JournalCommander | null {
  return active;
}

/** For tests and the start: whose data this run shows; null = no journals name anyone (nothing is filtered). */
export function setActiveCommander(c: JournalCommander | null): void {
  active = c;
}

/**
 * Pick the commander for this run from every journal (oldest first): `asked` matches an FID or, ignoring case, a
 * commander name; anything else, or nothing asked, falls back to the newest journal's commander.
 */
export function chooseCommander(allFiles: readonly string[], asked: string | undefined): CommanderSummary | null {
  const list = listJournalCommanders(allFiles);
  if (!list.length) return null;
  const want = asked?.trim();
  if (want) {
    const hit = list.find((c) => c.fid === want) ?? list.find((c) => c.name.toLowerCase() === want.toLowerCase());
    if (hit) return hit;
  }
  return list[0]!;
}
