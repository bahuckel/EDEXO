/**
 * One-off copies left in the app's data folder (discuss item 24, owner 2026-10-23): a file kept "before" a rebuild or a
 * migration (`edexo-bio-bodies.bin.before-20261010-v1`), a `.bak`, a `.bak-corrupt`. About 1.5 GB on the owner's PC.
 * Options lists them with their sizes and removes them on the commander's word only, never on its own. Backups made
 * by the Backups feature live in their own folder and are not touched; neither is anything the pattern does not name.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { resolveUserSettingsJsonPath } from "./paths.js";

/** What counts as an old copy: `.bak`, `.bak-<anything>`, `.before-<date>[...]`, `.polluted-<date>...`. */
const OLD_COPY = /(\.bak$|\.bak-|\.before-\d{8}|\.polluted-\d{8})/i;
/** Folders not looked into: the browser's and Electron's own stores, caches, diagnostics. */
const SKIP_DIRS = new Set(["browser", "electron", ".edexo-cache", "diag", "documents", "downloads"]);
const MAX_DEPTH = 2;

export interface OldCopy {
  /** Relative to the data folder, with forward slashes. */
  path: string;
  bytes: number;
  modified: string;
}

export function isOldCopyName(name: string): boolean {
  return OLD_COPY.test(name);
}

function dataDir(): string {
  return path.dirname(resolveUserSettingsJsonPath());
}

export function listOldCopies(root = dataDir()): { files: OldCopy[]; bytes: number } {
  const files: OldCopy[] = [];
  const walk = (dir: string, rel: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      const r = rel ? `${rel}/${name}` : name;
      if (st.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(name.toLowerCase())) walk(full, r, depth + 1);
      } else if (isOldCopyName(name)) {
        files.push({ path: r, bytes: st.size, modified: st.mtime.toISOString() });
      }
    }
  };
  walk(root, "", 0);
  files.sort((a, b) => b.bytes - a.bytes);
  return { files, bytes: files.reduce((a, f) => a + f.bytes, 0) };
}

/**
 * Removes the named copies: each must still be an old copy by name, inside the data folder, and a file. Anything else
 * in the list is left alone. Returns what went and what did not.
 */
export function removeOldCopies(paths: unknown, root = dataDir()): { removed: string[]; skipped: string[] } {
  const removed: string[] = [];
  const skipped: string[] = [];
  const base = path.resolve(root);
  for (const p of Array.isArray(paths) ? paths : []) {
    if (typeof p !== "string" || !isOldCopyName(path.basename(p))) {
      skipped.push(String(p));
      continue;
    }
    const full = path.resolve(base, p);
    if (!full.startsWith(base + path.sep)) {
      skipped.push(p);
      continue;
    }
    try {
      if (!statSync(full).isFile()) throw new Error("not a file");
      rmSync(full);
      removed.push(p);
    } catch {
      skipped.push(p);
    }
  }
  return { removed, skipped };
}
