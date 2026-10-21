/**
 * The journal files in Colonize's 7-day window. Reading and following them is EDEXO's (journalWatcher.ts,
 * journalTap.ts) since 1.3.0; Colonize's own reader and tail were removed with the move.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function journalWindowCutoffUtcMs(): number {
  return Date.now() - WEEK_MS;
}

function isJournalFile(name: string): boolean {
  return name.startsWith("Journal.") && name.endsWith(".log");
}

function filenameUtcMs(name: string): number {
  const m = name.match(/^Journal\.(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})\./);
  if (!m) return 0;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function journalFileLogicalStartUtcMs(name: string, mtimeMs: number): number {
  const fromName = filenameUtcMs(name);
  return fromName > 0 ? fromName : mtimeMs;
}

export async function listJournalFilesChronological(
  journalDir: string,
  minFileStartUtcMs: number | null,
): Promise<string[]> {
  /**
   * A missing or unreadable folder is reported to the caller rather than swallowed: returning
   * an empty list left the app blank with no explanation of why nothing was found.
   */
  const names = await fs.readdir(journalDir);
  /**
   * PERF-M1. The tail's poll lists the folder every few seconds, and used to `stat` every journal
   * a long-time player has ever written before throwing away all but the last week. A dated name
   * already says when the file starts, so only files the name cannot date need their mtime.
   */
  const journals = names.filter((name) => {
    if (!isJournalFile(name)) return false;
    if (minFileStartUtcMs == null) return true;
    const fromName = filenameUtcMs(name);
    return fromName === 0 || fromName >= minFileStartUtcMs;
  });
  const stated = await Promise.all(
    journals.map(async (name) => {
      const p = path.resolve(path.join(journalDir, name));
      try {
        const st = await fs.stat(p);
        return { p, name, key: filenameUtcMs(name), mtime: st.mtimeMs };
      } catch {
        /** One file rotating away or locked mid-listing must not hide every other journal. */
        return null;
      }
    }),
  );
  const rows = stated.filter((r): r is NonNullable<typeof r> => r !== null);
  rows.sort((a, b) => a.key - b.key || a.mtime - b.mtime || a.name.localeCompare(b.name));
  return rows
    .filter((r) => {
      if (minFileStartUtcMs == null) return true;
      return journalFileLogicalStartUtcMs(r.name, r.mtime) >= minFileStartUtcMs;
    })
    .map((r) => r.p);
}
