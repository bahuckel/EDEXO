/**
 * A way for a second reader of the journals (Colonize, 1.3.0) to follow EDEXO's own journal reading instead of
 * running a watcher of its own: one folder, one tail, one set of file handles.
 *
 * - `live`: every line the live tail applies, with the byte it ends at in its file (journalWatcher.ts
 *   processLineBytes). A listener that read the same file itself skips the lines that end at or before where it
 *   stopped.
 * - `reread`: the journals were read again from disk (a new journal file, a folder change, a resync). Lines that
 *   came in that way never pass through `live`, so a listener catches up on the files itself.
 *
 * Listeners are called inside EDEXO's own handlers; one that throws is logged and skipped, never allowed to stop
 * the line from reaching the rest of the app.
 */
import type { JournalLine } from "../shared/types.js";
import type { JournalLineAt } from "./journalWatcher.js";

type LiveListener = (line: JournalLine, at: JournalLineAt) => void;
type RereadListener = () => void;

const live = new Set<LiveListener>();
const reread = new Set<RereadListener>();

/** Follow the live lines; returns the unsubscribe. */
export function onLiveJournalLine(fn: LiveListener): () => void {
  live.add(fn);
  return () => live.delete(fn);
}

/** Be told when the journals were read again from disk; returns the unsubscribe. */
export function onJournalReread(fn: RereadListener): () => void {
  reread.add(fn);
  return () => reread.delete(fn);
}

/** Called by the bootstrap for each live line. */
export function emitLiveJournalLine(line: JournalLine, at: JournalLineAt): void {
  for (const fn of live) {
    try {
      fn(line, at);
    } catch (e) {
      console.error("[journalTap] live listener failed:", e);
    }
  }
}

/** Called by the bootstrap after the journals were read again from disk. */
export function emitJournalReread(): void {
  for (const fn of reread) {
    try {
      fn();
    } catch (e) {
      console.error("[journalTap] reread listener failed:", e);
    }
  }
}
