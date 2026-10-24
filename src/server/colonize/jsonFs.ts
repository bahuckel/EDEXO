import { promises as fs } from "node:fs";
import path from "node:path";

let tmpCounter = 0;
/** A locked store file is asked again this often before it counts as unreadable (readJsonKeepingCorrupt). */
const READ_ATTEMPTS = 10;
const READ_RETRY_MS = 300;

/** Write JSON atomically via temp file + rename to avoid corruption on crash. */
export async function writeJsonAtomic(filePath: string, data: unknown, pretty = false): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const body = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  /**
   * The temp name is unique per call: two writers racing on one destination used to share
   * `${filePath}.tmp`, so the slower one renamed a file the faster one had already moved
   * (ENOENT) or renamed a half-written body into place.
   */
  const tmp = `${filePath}.${process.pid}.${++tmpCounter}.tmp`;
  try {
    await fs.writeFile(tmp, body, "utf8");
    await fs.rename(tmp, filePath);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  return (await readJsonKeepingCorrupt(filePath, fallback)).value;
}

/**
 * Like readJson, but a file that is there and does not parse (torn write, antivirus, a hand edit) is copied to
 * `<file>.bak-corrupt` before the caller starts empty and the next save replaces it. It used to be dropped silently,
 * and with it archived flags, carriers and Inara imports the journals cannot rebuild (audit 2026-10-22).
 */
export async function readJsonKeepingCorrupt<T>(filePath: string, fallback: T): Promise<{ value: T; corrupt: boolean }> {
  let raw: string | null = null;
  /*
    Only a missing file means "start empty". One held by antivirus or a sync client (EBUSY, EPERM) used to count as
    missing too, and the next save replaced the real one (review 2026-10-24): it is asked again for a few seconds, and
    if it still cannot be read it is copied aside like a corrupt one before the caller starts empty.
  */
  for (let attempt = 1; raw == null; attempt++) {
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return { value: fallback, corrupt: false };
      if (attempt >= READ_ATTEMPTS) {
        await backupUnreadableJson(filePath, "unreadable");
        return { value: fallback, corrupt: true };
      }
      await new Promise((r) => setTimeout(r, READ_RETRY_MS));
    }
  }
  try {
    return { value: JSON.parse(raw) as T, corrupt: false };
  } catch {
    await backupUnreadableJson(filePath, "corrupt");
    return { value: fallback, corrupt: true };
  }
}

/**
 * Set aside a store file this build cannot read, instead of letting the next write erase it.
 *
 * Both stores used to drop unrecognised data on the floor: a file written by a newer build,
 * or one corrupted mid-write, was replaced silently and whatever it held was gone. Keeping a
 * copy costs nothing and means a downgrade, or a bad migration, is recoverable by hand.
 *
 * Returns the backup path, or null when there was nothing to set aside.
 */
export async function backupUnreadableJson(filePath: string, label: string | number): Promise<string | null> {
  const safeLabel = String(label).replace(/[^\w.-]+/g, "_") || "unknown";
  const backupPath = `${filePath}.bak-${safeLabel}`;
  try {
    await fs.copyFile(filePath, backupPath);
    console.warn(`[edexo-colonize] kept a copy of unreadable ${path.basename(filePath)} at ${backupPath}`);
    return backupPath;
  } catch {
    /** Nothing to back up (no file yet), or the copy failed — either way, do not block startup. */
    return null;
  }
}
