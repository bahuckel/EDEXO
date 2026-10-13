/**
 * The game's own list of every system the account has visited (plan 6.1, owner 2026-10-12/13): for a commander
 * whose journals are incomplete — lost in a reinstall, a new PC — `VisitedStarsCache.dat` still knows. It holds
 * system addresses only (no names, positions, dates or bodies), so it never feeds biology, first footfalls or any
 * statistic: imported systems go only where "visited" matters, the galaxy map's own systems, Find, and the
 * expedition planner's visits. The owner's copy: 5,467 systems, 675 of them not in his journals.
 *
 * Where: `%LOCALAPPDATA%\Frontier Developments\Elite Dangerous\<account id>\VisitedStarsCache.dat` (on Linux the
 * same folder inside the game's Proton prefix, beside `Options`). Format (read on his file): "VisitedStars"
 * magic, a 0x30-byte header with the record count at 0x18 and the record size at 0x1C (16), records of
 * `id64 u64, visit count u32, day u32 since 1601-01-01`, a 4-byte footer. A rebuilt cache has every count 1
 * and one date, so only the addresses are read.
 *
 * The import is the ids in the app's own folder (`edexo-visited-cache.json`), never written into the journal
 * store; Remove deletes the file. The ids never leave the machine.
 */
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveUserSettingsJsonPath } from "./paths.js";
import { optionsDirForJournalDir } from "./protonJournals.js";
import type { BioIndex } from "./bioIndex.js";
import { id64Boxel } from "../shared/id64.js";

const MAGIC = "VisitedStars";
const HEADER = 0x30;
export const VISITED_CACHE_FILE = "VisitedStarsCache.dat";

/** The system addresses in a VisitedStarsCache.dat; throws on anything that is not one. */
export function parseVisitedCache(buf: Buffer): bigint[] {
  if (buf.length < HEADER || buf.toString("latin1", 0, MAGIC.length) !== MAGIC)
    throw new Error("not a VisitedStarsCache.dat");
  const count = buf.readUInt32LE(0x18);
  const size = buf.readUInt32LE(0x1c);
  if (size < 8 || size > 256) throw new Error(`unexpected record size ${size}`);
  if (HEADER + count * size > buf.length) throw new Error(`${count} records run past the end of the file`);
  const out: bigint[] = [];
  for (let i = 0; i < count; i++) out.push(buf.readBigUInt64LE(HEADER + i * size));
  return out;
}

/** The game's per-account folders: on Windows under %LOCALAPPDATA%, elsewhere in the journal folder's prefix. */
export function eliteAccountsRoot(journalDir?: string | null, platform = process.platform): string {
  const override = process.env.EDEXO_ELITE_LOCAL_DIR?.trim();
  if (override) return override;
  const options = platform !== "win32" && journalDir ? optionsDirForJournalDir(journalDir) : null;
  if (options) return path.dirname(options);
  return path.join(process.env.LOCALAPPDATA || "", "Frontier Developments", "Elite Dangerous");
}

export interface VisitedCacheFile {
  /** The folder's name: the account's number. What an import asks for (never a path). */
  account: string;
  path: string;
  modifiedAt: string;
  systems: number;
  /** Of them, systems the journals do not have. */
  notInJournals: number;
}

export function findVisitedCacheFiles(root: string, known: ReadonlySet<number>): VisitedCacheFile[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const out: VisitedCacheFile[] = [];
  for (const account of names) {
    if (!/^\d+$/.test(account)) continue;
    const file = path.join(root, account, VISITED_CACHE_FILE);
    try {
      const ids = parseVisitedCache(readFileSync(file));
      out.push({
        account,
        path: file,
        modifiedAt: statSync(file).mtime.toISOString(),
        systems: ids.length,
        notInJournals: ids.filter((id) => !known.has(Number(id))).length,
      });
    } catch {
      /* no file there, or not one: not offered */
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export interface VisitedImport {
  version: 1;
  account: string;
  importedAt: string;
  fileModifiedAt: string;
  ids: string[];
}

export function visitedImportPath(): string {
  return path.join(path.dirname(resolveUserSettingsJsonPath()), "edexo-visited-cache.json");
}

let cache: { file: string; value: VisitedImport | null } | null = null;

export function loadVisitedImport(file = visitedImportPath()): VisitedImport | null {
  if (cache?.file === file) return cache.value;
  let value: VisitedImport | null = null;
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as VisitedImport;
    if (j?.version === 1 && Array.isArray(j.ids))
      value = { ...j, ids: j.ids.filter((s) => /^\d+$/.test(String(s))).map(String) };
  } catch {
    value = null;
  }
  cache = { file, value };
  return value;
}

/** Import one account's list (replacing an earlier import). The account must be one `findVisitedCacheFiles` found. */
export function importVisitedCache(
  root: string,
  account: string,
  file = visitedImportPath(),
  now = new Date(),
): VisitedImport {
  if (!/^\d+$/.test(account)) throw new Error("not an account folder");
  const src = path.join(root, account, VISITED_CACHE_FILE);
  if (!existsSync(src)) throw new Error("no VisitedStarsCache.dat for that account");
  const ids = parseVisitedCache(readFileSync(src));
  const value: VisitedImport = {
    version: 1,
    account,
    importedAt: now.toISOString(),
    fileModifiedAt: statSync(src).mtime.toISOString(),
    ids: [...new Set(ids.map(String))],
  };
  writeFileSync(file, JSON.stringify(value), "utf8");
  cache = { file, value };
  return value;
}

export function removeVisitedImport(file = visitedImportPath()): boolean {
  cache = { file, value: null };
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

export interface ImportedSystem {
  addr: number;
  name: string;
  x: number;
  y: number;
  z: number;
  /** True when the position is the galaxy index's; false when it is the boxel's centre from the address. */
  exact: boolean;
}

/**
 * The imported systems the journals do not have, placed: the galaxy index's position and name when it has the
 * system (only an index already in memory is asked: this never loads it), else the centre of its boxel, read
 * from the address, and no name (a name worked out from the address would be wrong for the hand-named systems
 * the bubble is full of).
 */
export function importedSystems(
  imp: VisitedImport | null,
  known: ReadonlySet<number>,
  index: BioIndex | null,
): ImportedSystem[] {
  if (!imp) return [];
  const out: ImportedSystem[] = [];
  for (const s of imp.ids) {
    const addr = Number(s);
    if (known.has(addr)) continue;
    const id = BigInt(s);
    const hit = index?.lookup(id) ?? null;
    if (hit) {
      out.push({ addr, name: hit.name, x: hit.x, y: hit.y, z: hit.z, exact: true });
      continue;
    }
    const b = id64Boxel(id);
    if (!b) continue;
    out.push({ addr, name: "", ...b.center, exact: false });
  }
  return out;
}

/** For tests. */
export function clearVisitedImportCache(): void {
  cache = null;
}
