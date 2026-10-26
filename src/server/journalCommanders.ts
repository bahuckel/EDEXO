/*
  Whose journal is this (per-commander profiles, 1.3.1; plan docs/plan-25102026-commander-profiles.md). A player with
  more than one account has every commander's logs in one folder; the app shows one commander at a time, built from
  that commander's files only.

  A journal file belongs to exactly one commander: the game writes `Commander` (and `LoadGame`) with the commander's
  FID within the first lines of a session, and a second account means quitting the game, so a new file. A file the
  game started part-way through a session (`Fileheader.part` 2 or more, after a `Continued`) has no Commander line of
  its own and belongs to the file before it. A file that names nobody otherwise is a session quit at the main menu
  (measured on the owner's 319 logs: 38 such files, 1–4 lines each): nothing in it is anyone's, and it stays in every
  commander's list so the journal caches made before 1.3.1 still match.

  The head of each file is read once: a file's commander never changes, so the answer is kept for the whole run; a
  file that names nobody yet (the game just started it) is read again when it grows.
*/
import { openSync, readSync, closeSync, statSync } from "node:fs";

export type JournalCommander = { fid: string; name: string };

type Head = { size: number; fid: string | null; name: string | null; part: number; shutdown: boolean };

/** How much of a file is read for its commander: the Commander line is the second, LoadGame a few after it. */
const HEAD_BYTES = 64 * 1024;
/** The end of a file, read for its last event (`Shutdown`: the game has closed this session). */
const TAIL_BYTES = 4 * 1024;

const heads = new Map<string, Head>();

function readSlice(file: string, start: number, length: number): string {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, start);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/**
 * A line's event name. The game writes `"event":"Name"`; a tool that rewrote the file may have put spaces round the
 * colon (a test journal written by Python's json did, 2026-10-25), and such a file is still somebody's.
 */
const EVENT_RE = /"event"\s*:\s*"(\w+)"/;

function parseHead(text: string): Pick<Head, "fid" | "name" | "part"> {
  let fid: string | null = null;
  let name: string | null = null;
  let part = 1;
  for (const line of text.split("\n")) {
    const ev = EVENT_RE.exec(line)?.[1];
    if (!ev) continue;
    if (ev === "Fileheader") {
      const m = /"part"\s*:\s*(\d+)/.exec(line);
      if (m) part = Number(m[1]);
      continue;
    }
    if (ev !== "Commander" && ev !== "LoadGame") continue;
    try {
      const j = JSON.parse(line) as Record<string, unknown>;
      const f = typeof j.FID === "string" && j.FID.trim() ? j.FID.trim() : null;
      if (!f) continue;
      fid = f;
      const n = j.event === "Commander" ? j.Name : j.Commander;
      name = typeof n === "string" && n.trim() ? n.trim() : name;
      if (name) break;
    } catch {
      /* a torn line: the next one may still say */
    }
  }
  return { fid, name, part };
}

/**
 * The commander a file names itself, its part number, and whether it ends with Shutdown; null if unreadable.
 * `settled`: an older file whose commander is already known is answered from memory without a stat (the watcher
 * lists the folder every few seconds, and ~300 stats each time was what code review D8 took out).
 */
export function readJournalHead(file: string, settled = false): Head | null {
  const cached = heads.get(file);
  if (settled && cached?.fid) return cached;
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return null;
  }
  const known = cached;
  // A commander once found is final; the Shutdown flag only matters for the newest file and is read again there.
  if (known && known.size === size) return known;
  try {
    const h = known?.fid ? { fid: known.fid, name: known.name, part: known.part } : parseHead(readSlice(file, 0, Math.min(size, HEAD_BYTES)));
    const tail = size > 0 ? readSlice(file, Math.max(0, size - TAIL_BYTES), Math.min(size, TAIL_BYTES)) : "";
    const lastLine = tail.trimEnd().split("\n").pop() ?? "";
    const head: Head = { size, ...h, shutdown: EVENT_RE.exec(lastLine)?.[1] === "Shutdown" };
    heads.set(file, head);
    return head;
  } catch {
    return null;
  }
}

/**
 * The owner of each file, oldest first: its own commander, a later part's the file before it, else null.
 * `files` must be in session order (listJournalFilesChronological).
 */
export function journalOwners(files: readonly string[]): (JournalCommander | null)[] {
  const out: (JournalCommander | null)[] = [];
  let prev: JournalCommander | null = null;
  files.forEach((f, i) => {
    const h = readJournalHead(f, i < files.length - 1);
    let owner: JournalCommander | null = null;
    if (h?.fid) owner = { fid: h.fid, name: h.name ?? h.fid };
    else if (h && h.part > 1 && prev) owner = prev;
    out.push(owner);
    prev = owner;
  });
  return out;
}

/** This commander's files and the ones that name nobody, in the same order (the journal lists' rule). */
export function filesOfCommander(files: readonly string[], fid: string): string[] {
  const owners = journalOwners(files);
  return files.filter((_f, i) => !owners[i] || owners[i]!.fid === fid);
}

/**
 * A live line's file names another commander. The lists leave other commanders' files out, but a file the game has
 * only just started names nobody until its Commander line: the live tail can be following it when that line arrives.
 * From then on its lines are not this run's (read again as the file grows, so the answer is current).
 */
export function isOtherCommandersJournal(file: string, fid: string): boolean {
  const h = readJournalHead(file);
  return !!h?.fid && h.fid !== fid;
}

export type CommanderSummary = JournalCommander & { files: number; lastFile: string };

/** Every commander the logs name, the one who played last first; their latest name (a commander can be renamed). */
export function listJournalCommanders(files: readonly string[]): CommanderSummary[] {
  const owners = journalOwners(files);
  const by = new Map<string, CommanderSummary & { at: number }>();
  owners.forEach((o, i) => {
    if (!o) return;
    const cur = by.get(o.fid);
    by.set(o.fid, { fid: o.fid, name: o.name, files: (cur?.files ?? 0) + 1, lastFile: files[i]!, at: i });
  });
  return [...by.values()].sort((a, b) => b.at - a.at).map(({ at: _at, ...c }) => c);
}

/**
 * The commander the game is playing right now: the owner of the newest file, while that file has not ended with
 * Shutdown. Null when the game is closed or the newest session never got past the main menu.
 */
export function gameCommander(files: readonly string[]): JournalCommander | null {
  if (!files.length) return null;
  const owners = journalOwners(files);
  const last = files.length - 1;
  const head = readJournalHead(files[last]!);
  if (!head || head.shutdown) return null;
  return owners[last] ?? null;
}

/** For tests: forget what was read. */
export function clearJournalHeads(): void {
  heads.clear();
}
