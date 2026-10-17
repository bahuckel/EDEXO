"use strict";

/**
 * Write a file whole or not at all (code review 2026-10-10, A3): a temporary file beside it, renamed over
 * it, so a crash mid-write leaves the previous window, launcher or HUD layout rather than a torn one that
 * reads back as "no layout". Same as src/server/atomicWrite.ts; throws like fs.writeFileSync.
 *
 * 1.2.19 review: flushed to disk before the rename, and the rename tried again for a moment when Windows reports the
 * file busy (antivirus or the indexer holding the new file for a few milliseconds).
 */
const fs = require("fs");

const BUSY = new Set(["EPERM", "EBUSY", "EACCES"]);

function renameWithRetry(from, to, tries = 5) {
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (i >= tries || !BUSY.has(e && e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * i);
    }
  }
}

function writeFileAtomic(file, data, options = "utf8") {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeFileSync(fd, data, options);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renameWithRetry(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing left to tidy */
    }
    throw e;
  }
}

module.exports = { writeFileAtomic, renameWithRetry };
