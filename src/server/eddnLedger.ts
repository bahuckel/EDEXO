/**
 * The EDDN collector's codex ledger, when the commander runs one (owner, 2026-10-04, plan O-G: "only if
 * the user is running our EDDN ledger, auto-detected").
 *
 * [CODEX FIRST] knows what EDSM's nightly dump and EDAstro's file know; anything logged after the dump
 * is invisible to it. The collector (eddn-bio-collector, port 7121) records every codex entry players'
 * tools relay on EDDN, so its rows since the dump close that gap. Asked on start and every half hour
 * with one local GET; when nothing answers, nothing changes and nothing is shown.
 */
import { regionJoinKey } from "../shared/regionMap.js";
import { codexFirstDataDate, setEddnLedgerIds } from "./codexFirst.js";

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
/**
 * Add the plant rows of some whole JSONL lines to `out` as `region|codexId` keys.
 *
 * The owner's collector answers with 43 MB and 85,000 rows. Read whole with `text()`, split into lines and parsed
 * row by row on the server's thread, that was 2.5 s of buffer copying and a 2.3 s garbage-collection stall
 * (2026-10-19, measured in the desktop app: the launcher's first data waited for it). Lines are walked in place,
 * rows that are not biology are skipped before anything is built, and only the three fields are read.
 */
function addLedgerKeys(text: string, out: Set<string>): void {
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

function parseLedgerChecked(text: string): Set<string> {
  if (!text.startsWith(MANIFEST)) throw new Error("not a codex ledger");
  return parseLedger(text);
}

/**
 * Read the ledger as it streams in, one network chunk at a time: no 43 MB string, and the thread is handed back
 * between chunks. Throws when the answer does not start with the ledger's manifest.
 */
async function readLedgerStream(body: ReadableStream<Uint8Array>): Promise<Set<string>> {
  const out = new Set<string>();
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
    addLedgerKeys(text.slice(0, cut), out);
    rest = text.slice(cut);
    if (done) return out;
  }
}

/**
 * Ask the collector for its plant rows since the EDSM dump. Quiet on every failure: a commander who
 * does not run the collector must never see a warning about it.
 */
export async function refreshEddnLedger(
  projectRoot: string,
  fetchImpl: typeof fetch = fetch,
  base = EDDN_COLLECTOR_URL,
): Promise<EddnLedgerStatus> {
  const since = codexFirstDataDate(projectRoot);
  const checkedAt = new Date().toISOString();
  try {
    const url = `${base}/api/export/codex${since ? `?since=${encodeURIComponent(since)}` : ""}`;
    // 4 s for the collector to answer at all; the body itself (tens of MB) gets a minute.
    const ctl = new AbortController();
    const answerTimer = setTimeout(() => ctl.abort(), 4000);
    const bodyTimer = setTimeout(() => ctl.abort(), 60_000);
    let ids: Set<string>;
    try {
      const r = await fetchImpl(url, { signal: ctl.signal });
      clearTimeout(answerTimer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      ids = r.body ? await readLedgerStream(r.body) : parseLedgerChecked(await r.text());
    } finally {
      clearTimeout(answerTimer);
      clearTimeout(bodyTimer);
    }
    setEddnLedgerIds(ids);
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
