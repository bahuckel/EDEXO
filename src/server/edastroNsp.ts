/**
 * Notable stellar phenomena near the commander, from EDAstro's codex file.
 *
 * The POI catalogue knows about thirty NSPs; the game has tens of thousands. EDAstro publishes the
 * codex as one file, `codex-data.csv` — every logged codex entry with the system and its coordinates
 * (855 MB, 4.9 million rows on 2026-09-29). There is no NSP-only file and no "entries near me" query,
 * so this is an **opt-in download the commander starts**, with the size said on the button (owner,
 * 2026-09-30, "a"). The file is read as it streams and never stored: only the phenomena are kept, a
 * few megabytes, and the next refresh asks with the ETag first so an unchanged file costs nothing.
 *
 * ### Which rows are phenomena
 *
 * By codex id, never by name — the name column is sometimes localised (a Russian row turned up in
 * the survey). Measured on a 120,000-row sample and the owner's own journal:
 * - `codex_ent_gas_clds_*`   Lagrange clouds and storms (his "Proto-Lagrange Cloud" is `_light`)
 * - `codex_ent_small_org_*`  molluscs, squids and the other small space-borne life
 * - `codex_ent_l_*`          the large ones: trees, metallic / ice / silicate crystals
 * - `codex_ent_s_*`          pods (Peduncle, Aster, Chalice …)
 * - `codex_ent_spoi_*`       mineral spheres, Stolon pods, Gyre trees, Void hearts
 * (The same families the bundled EDSM codex lists under "biological" that are not plants.)
 *
 * Also kept, apart from the phenomena: `codex_ent_green_*`, green gas giant reports (owner,
 * 2026-09-30: "add them"). The file has no body column, so a report says which system has a green
 * gas giant of which class, not which body (shared/greenGasGiant.ts, `edastroReport`).
 * Surface biology is not kept as rows, but which plants were logged in which region is (owner,
 * 2026-10-01): one `region|codex id` key per pair, ~22,000 of them, for [CODEX FIRST] — a plant nobody
 * logged in the region counts as a first only if EDAstro has not seen it there either (codexFirst.ts).
 * Geology, Guardian and Thargoid sites are left out.
 *
 * Same rule as the carrier and POI lists: the file lands on the commander's machine from EDAstro
 * directly; nothing of it is in this repository or the installer.
 */
import { K10_CODEX_ID } from "../shared/greenGasGiant.js";
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveUserSettingsJsonPath } from "./paths.js";
import { splitCsvLine } from "./edastroCarriers.js";
import { APP_USER_AGENT } from "./appVersion.js";
import { regionJoinKey } from "../shared/regionMap.js";

export const NSP_URL = "https://edastro.com/mapcharts/files/codex-data.csv";
/** What the button says; the real figure comes from the server's Content-Length once it starts. */
export const NSP_SOURCE_SIZE_LABEL = "855 MB";
/** The codex file is rebuilt weekly; asking more often than daily wastes nobody's time but EDAstro's. */
export const NSP_FETCH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const NSP_ID = /^codex_ent_(gas_clds|small_org|l_(?!type)|s_|spoi|green_)/i;
/** Green gas giant reports ride in the same file but are not phenomena. */
const GREEN_ID = /^codex_ent_green_/;

/** One phenomenon type logged in one system. */
export interface NspRecord {
  id: string;
  /** English name when the file gave one, else the family ("Lagrange cloud"). */
  name: string;
  system: string;
  systemAddress: number | null;
  x: number;
  y: number;
  z: number;
}

/** Bumped whenever the rows kept change: an older file is fetched again in full, not "unchanged". */
const NSP_FILTER_VERSION = 4;

/*
  Which codex ids are plants (surface biology), for the region keys: everything that is not a
  phenomenon, a green gas giant, an astronomical body or a Guardian / Thargoid site — the same split
  as EDSM's codex extract (docs/perf/codex_region_extract.py). Geology lands here too and is harmless:
  it never matches a candidate species.
*/
const NOT_PLANT =
  /^codex_ent_(guardian_|relic_tower|thargoid_|tg_|wrecked_|cyclops|basilisk|medusa|hydra|orthrus|marauder|inciter|regenerator|berserker|scavengers|glaive|scythe|neutron_stars|black_holes|supermassiveblack_holes|standard_|trf_|earth_likes|green_)|_type(giant|supergiant|hypergiant)?$/;

interface NspFile {
  formatVersion: 1;
  /** Which {@link NSP_ID} the rows were picked with (absent = 1: before pods and spheres). */
  filterVersion?: number;
  fetchedAtMs: number;
  etag: string | null;
  sourceBytes: number | null;
  /** [id, name, system, address, x, y, z] — short, because there are tens of thousands. */
  rows: [string, string, string, number | null, number, number, number][];
  /** From filterVersion 4: every plant logged per region, as `regionJoinKey|codex id`. */
  bioRegionIds?: string[];
}

export interface NspStatusDTO {
  haveData: boolean;
  rowCount: number;
  systemCount: number;
  fetchedAtMs: number | null;
  running: boolean;
  bytesDone: number;
  bytesTotal: number | null;
  error: string | null;
  cooldownMsRemaining: number;
  sizeLabel: string;
  /** The downloaded file carries the plants per region (filterVersion 4) — else a refresh adds them. */
  plantRegions: boolean;
}

export function resolveNspCachePath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-compare-nsp.json");
}

/** The family, for a row whose name is missing or not in English. */
export function nspFamilyLabel(id: string): string {
  const s = id.toLowerCase();
  if (s.startsWith("codex_ent_gas_clds")) return /storm/.test(s) ? "Lagrange storm cloud" : "Lagrange cloud";
  if (s.includes("moll")) return "Space mollusc";
  if (s.includes("squid")) return "Space squid";
  if (s.startsWith("codex_ent_small_org")) return "Space-borne life";
  if (s.includes("metcry")) return "Metallic crystals";
  if (s.includes("iccry")) return "Ice crystals";
  if (s.includes("qtzcry")) return "Silicate crystals";
  if (s.includes("_cry")) return "Crystals";
  if (s.startsWith("codex_ent_spoi_ball")) return "Mineral spheres";
  if (s.startsWith("codex_ent_spoi")) return "Space-borne life";
  if (s.includes("seed") && s.includes("pln")) return "Space-borne tree";
  if (s.includes("seed")) return "Space-borne pod";
  return "Notable stellar phenomenon";
}

/** Latin letters, digits and a little punctuation: an English codex name. */
const ENGLISH = /^[A-Za-z0-9 '\-().]+$/;

/** Keep the phenomena from one CSV line, given the header's column positions. Exported for tests. */
export function parseNspLine(
  line: string,
  col: { name: number; id: number; system: number; x: number; y: number; z: number; addr: number },
): NspRecord | null {
  if (!/codex_ent_(gas_clds|small_org|l_|s_|spoi|green_)/i.test(line)) return null;
  const f = splitCsvLine(line);
  const id = (f[col.id] ?? "").trim().toLowerCase();
  if (!NSP_ID.test(id)) return null;
  const x = Number(f[col.x]);
  const y = Number(f[col.y]);
  const z = Number(f[col.z]);
  if (![x, y, z].every(Number.isFinite) || (f[col.x] ?? "").trim() === "") return null;
  const rawName = (f[col.name] ?? "").trim();
  const addrN = Number(f[col.addr]);
  return {
    id,
    name: rawName && ENGLISH.test(rawName) ? rawName : nspFamilyLabel(id),
    system: (f[col.system] ?? "").trim(),
    systemAddress: Number.isFinite(addrN) && addrN > 0 ? addrN : null,
    x,
    y,
    z,
  };
}

export function nspColumns(header: string) {
  const cols = splitCsvLine(header).map((c) => c.trim().toLowerCase());
  const at = (pred: (c: string) => boolean) => cols.findIndex(pred);
  return {
    name: at((c) => c === "codex entry"),
    id: at((c) => c === "codex id"),
    system: at((c) => c === "system"),
    x: at((c) => c === "x"),
    y: at((c) => c === "y"),
    z: at((c) => c === "z"),
    addr: at((c) => c.includes("id64") || c.includes("system address")),
    region: at((c) => c === "region"),
  };
}

/** The `region|codex id` key of a plant row, or null when the row is not a plant. Exported for tests. */
export function parseBioRegionLine(line: string, col: { id: number; region: number }): string | null {
  if (col.region < 0 || !line.includes("codex_ent_")) return null;
  const f = splitCsvLine(line);
  const id = (f[col.id] ?? "").trim().toLowerCase();
  if (!id.startsWith("codex_ent_") || NSP_ID.test(id) || NOT_PLANT.test(id)) return null;
  const region = regionJoinKey(f[col.region] ?? "");
  return region ? `${region}|${id}` : null;
}

type NspRow = NspFile["rows"][number];

/**
 * The phenomena as columns, one entry per system (code review, 2026-10-14). Kept as the parsed rows they were
 * 270,000 seven-element arrays with their coordinates boxed, plus a second copy grouped by system for the map
 * and the NSP card: about 100 MB of the server's 320 MB at rest on the owner's profile. A system's rows keep
 * the file's order inside it, and a system its first row's place, so every answer comes out as before.
 */
interface NspColumns {
  /** Rows of phenomena (not green giants), as the status counts them. */
  rows: number;
  sysName: string[];
  /** NaN where the file had no address. */
  sysAddr: Float64Array;
  sx: Float64Array;
  sy: Float64Array;
  sz: Float64Array;
  /** System i's rows are rowStart[i] .. rowStart[i + 1]. */
  rowStart: Uint32Array;
  rowId: Uint16Array;
  rowName: Uint16Array;
  idStr: string[];
  nameStr: string[];
}

/** The file without its rows (they live in {@link NspColumns}); what the status and a refresh need of it. */
type NspFileMeta = Omit<NspFile, "rows">;

let memo: { mtimeMs: number; file: NspFileMeta; systems: number; cols: NspColumns; green: NspRow[] } | null =
  null;

type Loaded = { file: NspFileMeta; systems: number; cols: NspColumns; green: NspRow[] };

function toColumns(nsp: NspRow[]): NspColumns {
  const idIdx = new Map<string, number>();
  const nameIdx = new Map<string, number>();
  const idStr: string[] = [];
  const nameStr: string[] = [];
  const intern = (m: Map<string, number>, arr: string[], v: string) => {
    let i = m.get(v);
    if (i === undefined) {
      i = arr.length;
      arr.push(v);
      m.set(v, i);
    }
    return i;
  };
  // Systems in the order their first row comes, keyed as the grouping always was.
  const sysOf = new Map<string, number>();
  const rowSys = new Uint32Array(nsp.length);
  const firstRow: number[] = [];
  nsp.forEach((r, i) => {
    const k = String(r[3] ?? r[2]);
    let si = sysOf.get(k);
    if (si === undefined) {
      si = firstRow.length;
      sysOf.set(k, si);
      firstRow.push(i);
    }
    rowSys[i] = si;
  });
  const n = firstRow.length;
  const rowStart = new Uint32Array(n + 1);
  for (let i = 0; i < nsp.length; i++) rowStart[rowSys[i]! + 1]!++;
  for (let i = 0; i < n; i++) rowStart[i + 1]! += rowStart[i]!;
  const fill = rowStart.slice(0, n);
  const rowId = new Uint16Array(nsp.length);
  const rowName = new Uint16Array(nsp.length);
  nsp.forEach((r, i) => {
    const at = fill[rowSys[i]!]!++;
    rowId[at] = intern(idIdx, idStr, r[0]);
    rowName[at] = intern(nameIdx, nameStr, r[1]);
  });
  const sysName: string[] = new Array(n);
  const sysAddr = new Float64Array(n);
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const sz = new Float64Array(n);
  firstRow.forEach((ri, si) => {
    const r = nsp[ri]!;
    sysName[si] = r[2];
    sysAddr[si] = r[3] ?? Number.NaN;
    sx[si] = r[4];
    sy[si] = r[5];
    sz[si] = r[6];
  });
  return { rows: nsp.length, sysName, sysAddr, sx, sy, sz, rowStart, rowId, rowName, idStr, nameStr };
}

const addrOf = (c: NspColumns, i: number): number | null =>
  Number.isNaN(c.sysAddr[i]!) ? null : c.sysAddr[i]!;
/** System i's distinct names / ids, in the order its rows came. */
function distinct(c: NspColumns, i: number, col: Uint16Array, strs: string[]): string[] {
  const out: string[] = [];
  for (let r = c.rowStart[i]!; r < c.rowStart[i + 1]!; r++) {
    const v = strs[col[r]!]!;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}
/*
  The last answer, reused for a second: every gas giant asks twice per snapshot (K10 anomaly, green
  reports), and a stat per ask — a throw when nothing was ever downloaded, the usual case — was a
  measurable part of each refresh (profiled 2026-10-01). Our own writes clear it at once; a file
  changed by hand is seen within a second.
*/
let checked: { at: number; path: string; result: Loaded | null } | null = null;
const RECHECK_MS = 1000;

function loadFile(): Loaded | null {
  const p = resolveNspCachePath();
  const now = Date.now();
  if (checked && checked.path === p && now - checked.at < RECHECK_MS) return checked.result;
  const result = loadFileNow(p);
  checked = { at: now, path: p, result };
  return result;
}

function loadFileNow(p: string): Loaded | null {
  let st;
  try {
    st = statSync(p);
  } catch {
    memo = null;
    return null;
  }
  if (memo && memo.mtimeMs === st.mtimeMs) return memo;
  try {
    const file = JSON.parse(readFileSync(p, "utf8")) as NspFile;
    if (!Array.isArray(file.rows)) return null;
    const nsp: NspRow[] = [];
    const green: NspRow[] = [];
    /*
      JSON.parse gives every row its own copy of the codex id and name — a few hundred distinct
      strings over 236,721 rows. Sharing one copy each: 70 → 50 MB of heap, +14 ms (2026-09-30).
    */
    const pool = new Map<string, string>();
    const intern = (s: string): string => {
      const v = pool.get(s);
      if (v !== undefined) return v;
      pool.set(s, s);
      return s;
    };
    for (const r of file.rows) {
      r[0] = intern(r[0]);
      r[1] = intern(r[1]);
      (GREEN_ID.test(r[0]) ? green : nsp).push(r);
    }
    const systems = new Set(nsp.map((r) => r[3] ?? r[2])).size;
    const { rows: _rows, ...meta } = file;
    memo = { mtimeMs: st.mtimeMs, file: meta, systems, cols: toColumns(nsp), green };
    return memo;
  } catch {
    memo = null;
    return null;
  }
}

export function resetNspMemo(): void {
  memo = null;
  checked = null;
}

const job = { running: false, bytesDone: 0, bytesTotal: null as number | null, error: null as string | null };

export function readNspStatus(nowMs: number = Date.now()): NspStatusDTO {
  const f = loadFile();
  const since = f ? nowMs - f.file.fetchedAtMs : Number.POSITIVE_INFINITY;
  return {
    haveData: f != null,
    rowCount: f?.cols.rows ?? 0,
    systemCount: f?.systems ?? 0,
    fetchedAtMs: f?.file.fetchedAtMs ?? null,
    running: job.running,
    bytesDone: job.bytesDone,
    bytesTotal: job.bytesTotal,
    error: job.error,
    cooldownMsRemaining: Number.isFinite(since) ? Math.max(0, NSP_FETCH_COOLDOWN_MS - since) : 0,
    sizeLabel: NSP_SOURCE_SIZE_LABEL,
    plantRegions: !!f?.file.bioRegionIds,
  };
}

/**
 * Start the download in the background; the status says how far it got. One at a time, and not
 * within a day of the last, unless forced.
 */
export function startNspDownload(opts: { force?: boolean; fetchImpl?: typeof fetch } = {}): NspStatusDTO {
  const st = readNspStatus();
  if (job.running) return st;
  // An older file (no plant keys) may be refreshed at once: the cooldown is for asking about the same file.
  if (!opts.force && st.haveData && st.plantRegions && st.cooldownMsRemaining > 0) return st;
  job.running = true;
  job.bytesDone = 0;
  job.bytesTotal = null;
  job.error = null;
  void downloadNsp(opts.fetchImpl ?? fetch)
    .catch((e) => {
      job.error = e instanceof Error ? e.message : String(e);
    })
    .finally(() => {
      job.running = false;
    });
  return readNspStatus();
}

async function downloadNsp(fetchImpl: typeof fetch): Promise<void> {
  const prev = loadFile()?.file ?? null;
  const headers: Record<string, string> = { "User-Agent": APP_USER_AGENT };
  if (prev?.etag && prev.filterVersion === NSP_FILTER_VERSION) headers["If-None-Match"] = prev.etag;
  const res = await fetchImpl(NSP_URL, { headers });
  if (res.status === 304 && prev) {
    // Unchanged: keep the rows (read back from the file), restart the clock.
    const onDisk = JSON.parse(readFileSync(resolveNspCachePath(), "utf8")) as NspFile;
    writeNspFile({ ...onDisk, fetchedAtMs: Date.now() });
    return;
  }
  if (!res.ok || !res.body) throw new Error(`EDAstro answered ${res.status}`);
  const len = Number(res.headers.get("content-length"));
  job.bytesTotal = Number.isFinite(len) && len > 0 ? len : null;

  const seen = new Set<string>();
  const rows: NspFile["rows"] = [];
  const bio = new Set<string>();
  let col: ReturnType<typeof nspColumns> | null = null;
  let rest = "";
  const decoder = new TextDecoder();
  const take = (line: string) => {
    if (!col) {
      col = nspColumns(line);
      if (col.id < 0 || col.x < 0) throw new Error("codex-data.csv changed shape (no Codex ID / X column)");
      return;
    }
    const r = parseNspLine(line, col);
    if (!r) {
      const k = parseBioRegionLine(line, col);
      if (k) bio.add(k);
      return;
    }
    const key = `${r.id}@${r.systemAddress ?? r.system}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push([r.id, r.name, r.system, r.systemAddress, r.x, r.y, r.z]);
  };
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    job.bytesDone += value.byteLength;
    const text = rest + decoder.decode(value, { stream: true });
    const lines = text.split("\n");
    rest = lines.pop() ?? "";
    for (const l of lines) take(l.replace(/\r$/, ""));
  }
  rest += decoder.decode();
  if (rest.trim()) take(rest.replace(/\r$/, ""));
  if (!col) throw new Error("codex-data.csv was empty");
  writeNspFile({
    formatVersion: 1,
    filterVersion: NSP_FILTER_VERSION,
    fetchedAtMs: Date.now(),
    etag: res.headers.get("etag"),
    sourceBytes: job.bytesDone,
    rows,
    bioRegionIds: [...bio].sort(),
  });
}

let bioMemo: { file: NspFileMeta; ids: ReadonlySet<string> } | null = null;

/**
 * Every plant EDAstro has logged, per region (`regionJoinKey|codex id`), and when the file was
 * fetched; null when the phenomena data is not downloaded or predates the plant keys (filterVersion 4).
 */
export function edastroBioRegionIds(): { ids: ReadonlySet<string>; fetchedAtMs: number } | null {
  const f = loadFile();
  if (!f?.file.bioRegionIds) return null;
  if (bioMemo?.file !== f.file) bioMemo = { file: f.file, ids: new Set(f.file.bioRegionIds) };
  return { ids: bioMemo.ids, fetchedAtMs: f.file.fetchedAtMs };
}

function writeNspFile(file: NspFile): void {
  const p = resolveNspCachePath();
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(file), "utf8");
  renameSync(tmp, p);
  memo = null;
  checked = null;
}

/** Phenomena within the radius, grouped by system, nearest system first. */
export function nearbyNsp(
  origin: { x: number; y: number; z: number },
  radiusLy: number,
): { system: string; systemAddress: number | null; distanceLy: number; names: string[] }[] {
  const f = loadFile();
  if (!f) return [];
  const c = f.cols;
  const out: { system: string; systemAddress: number | null; distanceLy: number; names: string[] }[] = [];
  const r2 = radiusLy * radiusLy;
  for (let i = 0; i < c.sysName.length; i++) {
    const d2 = (c.sx[i]! - origin.x) ** 2 + (c.sy[i]! - origin.y) ** 2 + (c.sz[i]! - origin.z) ** 2;
    if (d2 > r2) continue;
    out.push({
      system: c.sysName[i]!,
      systemAddress: addrOf(c, i),
      distanceLy: Math.sqrt(d2),
      names: distinct(c, i, c.rowName, c.nameStr),
    });
  }
  return out.sort((a, b) => a.distanceLy - b.distanceLy);
}

/** Every system with a phenomenon, with the phenomena's names (the galaxy map's layer). */
export interface NspSystem {
  system: string;
  systemAddress: number | null;
  x: number;
  y: number;
  z: number;
  names: string[];
  /** The codex ids behind the names. */
  ids: string[];
}

/** Built on each call and not kept: the galaxy map's layer asks for it once per request. */
export function nspBySystem(): readonly NspSystem[] {
  const f = loadFile();
  if (!f) return [];
  const c = f.cols;
  const out: NspSystem[] = new Array(c.sysName.length);
  for (let i = 0; i < c.sysName.length; i++) {
    out[i] = {
      system: c.sysName[i]!,
      systemAddress: addrOf(c, i),
      x: c.sx[i]!,
      y: c.sy[i]!,
      z: c.sz[i]!,
      names: distinct(c, i, c.rowName, c.nameStr),
      ids: distinct(c, i, c.rowId, c.idStr),
    };
  }
  return out;
}

/** The phenomena systems one at a time, for a walk that needs only their place and, for a few, their ids. */
export interface NspSystemsView {
  count: number;
  address(i: number): number | null;
  name(i: number): string;
  x(i: number): number;
  y(i: number): number;
  z(i: number): number;
  ids(i: number): string[];
  names(i: number): string[];
}
export function nspSystemsView(): NspSystemsView | null {
  const f = loadFile();
  if (!f) return null;
  const c = f.cols;
  return {
    count: c.sysName.length,
    address: (i) => addrOf(c, i),
    name: (i) => c.sysName[i]!,
    x: (i) => c.sx[i]!,
    y: (i) => c.sy[i]!,
    z: (i) => c.sz[i]!,
    ids: (i) => distinct(c, i, c.rowId, c.idStr),
    names: (i) => distinct(c, i, c.rowName, c.nameStr),
  };
}

/**
 * Systems with a K10-Type Anomaly in EDAstro's codex file — an NSP that only spawns around green gas
 * giants (shared/greenGasGiant.ts). Kept per file version; empty until the file is downloaded.
 */
let k10Memo: { file: NspFileMeta; addrs: Set<number> } | null = null;
export function nspK10Systems(): ReadonlySet<number> {
  const f = loadFile();
  if (!f) return new Set();
  if (k10Memo?.file === f.file) return k10Memo.addrs;
  const c = f.cols;
  const addrs = new Set<number>();
  const k10 = c.idStr.indexOf(K10_CODEX_ID);
  if (k10 >= 0) {
    for (let i = 0; i < c.sysName.length; i++) {
      const a = addrOf(c, i);
      if (a == null) continue;
      for (let r = c.rowStart[i]!; r < c.rowStart[i + 1]!; r++) {
        if (c.rowId[r] === k10) {
          addrs.add(a);
          break;
        }
      }
    }
  }
  k10Memo = { file: f.file, addrs };
  return addrs;
}

/** A green gas giant report in EDAstro's codex file: which system, which codex class, where. */
export interface EdastroGreenReport {
  system: string;
  systemAddress: number | null;
  codexIds: string[];
  x: number;
  y: number;
  z: number;
}

let greenMemo: {
  file: NspFileMeta;
  list: EdastroGreenReport[];
  byAddr: Map<number, EdastroGreenReport>;
} | null = null;
function greenReports() {
  const f = loadFile();
  if (!f) return null;
  if (greenMemo?.file === f.file) return greenMemo;
  const by = new Map<string, EdastroGreenReport>();
  for (const [id, , system, addr, x, y, z] of f.green) {
    const k = String(addr ?? system.toLowerCase());
    const g = by.get(k);
    if (g) {
      if (!g.codexIds.includes(id)) g.codexIds.push(id);
    } else by.set(k, { system, systemAddress: addr, codexIds: [id], x, y, z });
  }
  const list = [...by.values()];
  const byAddr = new Map<number, EdastroGreenReport>();
  for (const g of list) if (g.systemAddress != null) byAddr.set(g.systemAddress, g);
  greenMemo = { file: f.file, list, byAddr };
  return greenMemo;
}

/** Every system EDAstro has a green gas giant codex report for (empty until the file is downloaded). */
export function edastroGreenReports(): readonly EdastroGreenReport[] {
  return greenReports()?.list ?? [];
}

/** The green codex ids EDAstro has for one system, by address. */
export function edastroGreenFor(systemAddress: number): readonly string[] {
  return greenReports()?.byAddr.get(systemAddress)?.codexIds ?? [];
}
