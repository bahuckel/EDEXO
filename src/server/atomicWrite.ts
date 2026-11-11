/**
 * Write a file whole or not at all (code review 2026-10-10, A3): into a temporary file beside it, then
 * renamed over it, so a crash or power cut mid-write leaves the previous file, never half of the new one.
 * Ten user-data files were written in place; a torn settings, notices or prediction file was read back as
 * unreadable and replaced with defaults. Throws like `writeFileSync` does: callers keep their own catch.
 *
 * 1.2.19 review: the temporary file is flushed to disk before the rename (without it a power cut could leave an empty
 * file in place of both), and the rename is tried again for a moment when Windows reports the file busy — antivirus
 * or the search indexer opening the new file for a few milliseconds made a save fail outright.
 */
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync, type WriteFileOptions } from "node:fs";

const BUSY = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Wait `ms` without an event loop turn: a save is synchronous for its callers. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function renameWithRetry(from: string, to: string, tries = 5): void {
  for (let i = 1; ; i++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      if (i >= tries || !BUSY.has((e as NodeJS.ErrnoException)?.code ?? "")) throw e;
      pause(40 * i);
    }
  }
}

export function writeFileAtomic(file: string, data: string | NodeJS.ArrayBufferView, options: WriteFileOptions = "utf8"): void {
  const tmp = `${file}.tmp-${process.pid}`;
  // A `mode` in the options is the new file's (the temporary file is opened here, so writeFileSync would ignore it).
  const mode = typeof options === "object" && options?.mode != null ? options.mode : undefined;
  try {
    const fd = openSync(tmp, "w", mode);
    try {
      writeFileSync(fd, data, options);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameWithRetry(tmp, file);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* nothing left to tidy */
    }
    throw e;
  }
}

/**
 * A user-data file that no longer reads is moved aside as `<name>.unreadable-<time>`, not left for the next save to
 * replace with what is in memory (review 2026-11-10 C6): bookmarks, saved boxels, gas-giant marks and the foot
 * catalog started empty over a torn or empty file, and the next change wrote that emptiness over his data. The copy
 * is for recovering by hand. Best-effort: the path of the copy, or null when it could not be moved.
 */
export function setAsideUnreadable(file: string): string | null {
  const aside = `${file}.unreadable-${Date.now()}`;
  try {
    renameWithRetry(file, aside);
    return aside;
  } catch {
    return null;
  }
}
