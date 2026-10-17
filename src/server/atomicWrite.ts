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

export function writeFileAtomic(file: string, data: string, options: WriteFileOptions = "utf8"): void {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    const fd = openSync(tmp, "w");
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
