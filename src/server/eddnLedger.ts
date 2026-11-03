/**
 * The EDDN collector's codex ledger, when the commander runs one (owner, 2026-10-04, plan O-G: "only if
 * the user is running our EDDN ledger, auto-detected").
 *
 * [CODEX FIRST] knows what EDSM's nightly dump and EDAstro's file know; anything logged after the dump
 * is invisible to it. The collector (eddn-bio-collector, port 7121) records every codex entry players'
 * tools relay on EDDN, so its rows since the dump close that gap. Asked on start and every half hour
 * with one local GET; when nothing answers, nothing changes and nothing is shown.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { regionJoinKey } from "../shared/regionMap.js";
import { writeFileAtomic } from "./atomicWrite.js";
import { codexFirstDataDate, setEddnLedgerIds } from "./codexFirst.js";
import { resolveUserSettingsJsonPath } from "./paths.js";

export const EDDN_COLLECTOR_URL = "http://127.0.0.1:7121";

export interface EddnLedgerStatus {
  /** The collector answered on the last check. */
  found: boolean;
  /** Plant sightings it holds since `since`, the EDSM dump's date. */
  plantRows: number;
  since: string | null;
  checkedAt: string | null;
}

let status: EddnLedgerStatus = { found: false, plantRows: 0, since: null, checkedAt: null };

export function eddnLedgerStatus(): EddnLedgerStatus {
  return status;
}

/** `$Codex_Ent_Aleoids_01_A_Name;` → `codex_ent_aleoids_01_a`, EDSM's id for the same entry. */
export function ledgerTokenToCodexId(token: string): string {
  return token
    .trim()
    .toLowerCase()
    .replace(/^\$/, "")
    .replace(/_name;?$/, "");
}

/** One string field of a ledger row, unescaped only when it has to be. */
function field(line: string, re: RegExp): string | null {
  const m = re.exec(line);
  if (!m) return null;
  const raw = m[1]!;
  if (!raw.includes("\\")) return raw;
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return null;
  }
}
const TOKEN = /"token":"((?:[^"\\]|\\.)*)"/;
const REGION = /"region":"((?:[^"\\]|\\.)*)"/;
const CATEGORY = /"category":"((?:[^"\\]|\\.)*)"/;
const FIRST_SEEN = /"firstSeen":"([^"\\]*)"/;

/** The latest `firstSeen` of the plant rows read: where the next read can start. */
interface Cursor {
  latest: string | null;
}
/**
 * Add the plant rows of some whole JSONL lines to `out` as `region|codexId` keys.
 *
 * The owner's collector answers with 43 MB and 85,000 rows. Read whole with `text()`, split into lines and parsed
 * row by row on the server's thread, that was 2.5 s of buffer copying and a 2.3 s garbage-collection stall
 * (2026-10-19, measured in the desktop app: the launcher's first data waited for it). Lines are walked in place,
 * rows that are not biology are skipped before anything is built, and only the three fields are read.
 */
function addLedgerKeys(text: string, out: Set<string>, cursor?: Cursor): void {
  let at = 0;
  while (at < text.length) {
    let end = text.indexOf("\n", at);
    if (end < 0) end = text.length;
    if (text.startsWith('{"kind":"codex"', at)) {
      const line = text.slice(at, end);
      const category = field(line, CATEGORY);
      if (category && /biolog/i.test(category)) {
        const token = field(line, TOKEN);
        const region = field(line, REGION);
        if (token && region) out.add(`${regionJoinKey(region)}|${ledgerTokenToCodexId(token)}`);
        if (cursor) {
          const seen = FIRST_SEEN.exec(line)?.[1];
          if (seen && (cursor.latest == null || seen > cursor.latest)) cursor.latest = seen;
        }
      }
    }
    at = end + 1;
  }
}

/** The ledger's JSONL as `region|codexId` keys for its plant rows. */
export function parseLedger(text: string): Set<string> {
  const out = new Set<string>();
  addLedgerKeys(text, out);
  return out;
}

const MANIFEST = '{"kind":"manifest"';

function parseLedgerChecked(text: string, out: Set<string>, cursor: Cursor): Set<string> {
  if (!text.startsWith(MANIFEST)) throw new Error("not a codex ledger");
  addLedgerKeys(text, out, cursor);
  return out;
}

/**
 * Read the ledger as it streams in, one network chunk at a time: no 43 MB string, and the thread is handed back
 * between chunks. Throws when the answer does not start with the ledger's manifest.
 */
async function readLedgerStream(body: ReadableStream<Uint8Array>, out: Set<string>, cursor: Cursor): Promise<Set<string>> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let rest = "";
  let checked = false;
  for (;;) {
    const { done, value } = await reader.read();
    const text = rest + (done ? dec.decode() : dec.decode(value, { stream: true }));
    if (!checked && (done || text.length >= MANIFEST.length)) {
      if (!text.startsWith(MANIFEST)) {
        await reader.cancel().catch(() => {});
        throw new Error("not a codex ledger");
      }
      checked = true;
    }
    const cut = done ? text.length : text.lastIndexOf("\n") + 1;
    addLedgerKeys(text.slice(0, cut), out, cursor);
    rest = text.slice(cut);
    if (done) return out;
  }
}

/*
  The keys read before, kept on disk (review 2026-10-19 follow-up: the whole 43 MB export was read at every start and
  every half hour, ~2 s of the server's CPU each time). The next read asks only for rows first seen since the latest
  one kept, less two days: a row's firstSeen is the game's time, and a sighting relayed late can carry an earlier
  one. A new EDSM dump, or a week since the last whole read, reads it all again, so nothing missed stays missed.
*/
const LEDGER_CACHE_VERSION = 1;
const FULL_READ_EVERY_MS = 7 * 86_400_000;
const OVERLAP_MS = 2 * 86_400_000;

interface LedgerCache {
  version: number;
  /** The EDSM dump date the keys count from. */
  since: string | null;
  /** When the export was last read whole. */
  fullAt: string;
  latest: string | null;
  keys: string[];
}

export function eddnLedgerCachePath(): string {
  return path.join(path.dirname(resolveUserSettingsJsonPath()), "edexo-eddn-ledger.json");
}

function readCache(file: string, since: string | null, now: number): LedgerCache | null {
  try {
    if (!existsSync(file)) return null;
    const c = JSON.parse(readFileSync(file, "utf8")) as LedgerCache;
    if (c.version !== LEDGER_CACHE_VERSION || c.since !== since || !Array.isArray(c.keys) || !c.latest) return null;
    const fullAt = Date.parse(c.fullAt);
    if (!Number.isFinite(fullAt) || now - fullAt > FULL_READ_EVERY_MS || fullAt > now) return null;
    return c;
  } catch {
    return null;
  }
}

/** Where an incremental read starts: two days before the latest row kept. */
function sinceCursor(latest: string): string | null {
  const t = Date.parse(latest);
  return Number.isFinite(t) ? new Date(t - OVERLAP_MS).toISOString() : null;
}

/**
 * Ask the collector for its plant rows since the EDSM dump. Quiet on every failure: a commander who
 * does not run the collector must never see a warning about it.
 */
export async function refreshEddnLedger(
  projectRoot: string,
  fetchImpl: typeof fetch = fetch,
  base = EDDN_COLLECTOR_URL,
  cacheFile: string | null = eddnLedgerCachePath(),
): Promise<EddnLedgerStatus> {
  const since = codexFirstDataDate(projectRoot);
  const now = Date.now();
  const checkedAt = new Date(now).toISOString();
  try {
    const kept = cacheFile ? readCache(cacheFile, since, now) : null;
    const from = kept?.latest ? sinceCursor(kept.latest) : null;
    // Never before the dump: what it holds is not the ledger's to add.
    const ask = from && (!since || from > since) ? from : since;
    const url = `${base}/api/export/codex${ask ? `?since=${encodeURIComponent(ask)}` : ""}`;
    const out = new Set<string>(kept && from ? kept.keys : []);
    const cursor: Cursor = { latest: kept && from ? kept.latest : null };
    // 4 s for the collector to answer at all; the body itself (tens of MB) gets a minute.
    const ctl = new AbortController();
    const answerTimer = setTimeout(() => ctl.abort(), 4000);
    const bodyTimer = setTimeout(() => ctl.abort(), 60_000);
    let ids: Set<string>;
    try {
      const r = await fetchImpl(url, { signal: ctl.signal });
      clearTimeout(answerTimer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      ids = r.body ? await readLedgerStream(r.body, out, cursor) : parseLedgerChecked(await r.text(), out, cursor);
    } finally {
      clearTimeout(answerTimer);
      clearTimeout(bodyTimer);
    }
    setEddnLedgerIds(ids);
    if (cacheFile) {
      try {
        const cache: LedgerCache = {
          version: LEDGER_CACHE_VERSION,
          since,
          fullAt: kept && from ? kept.fullAt : checkedAt,
          latest: cursor.latest,
          keys: [...ids],
        };
        writeFileAtomic(cacheFile, JSON.stringify(cache));
      } catch {
        /* the next read is a whole one: nothing lost */
      }
    }
    status = { found: true, plantRows: ids.size, since, checkedAt };
  } catch {
    if (status.found) setEddnLedgerIds(null);
    status = { found: false, plantRows: 0, since, checkedAt };
  }
  return status;
}

/**
 * Check once `after` settles (the journal boot: the first check downloads the whole export, and the boot is what
 * every window is waiting for), then every half hour; the timer never keeps the process alive.
 */
export function startEddnLedgerWatch(projectRoot: string, after: Promise<unknown> = Promise.resolve()): () => void {
  let stopped = false;
  let t: ReturnType<typeof setInterval> | null = null;
  void after
    .catch(() => {})
    .then(() => {
      if (stopped) return;
      void refreshEddnLedger(projectRoot);
      t = setInterval(() => void refreshEddnLedger(projectRoot), 30 * 60 * 1000);
      if (typeof t.unref === "function") t.unref();
    });
  return () => {
    stopped = true;
    if (t) clearInterval(t);
  };
}
