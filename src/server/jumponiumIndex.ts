/**
 * Jumponium bodies for the galaxy map (1.2.16, owner: "trackable on galmap with filters"): every landable body in the
 * top 1 % of landable bodies for vanadium, germanium, arsenic, cadmium, niobium, yttrium or polonium, built by
 * docs/perf/build_jumponium.py from Spansh's dump, an optional download beside the galaxy index; plus every landable
 * body the commander scanned himself (his journals, all of them, not only the top 1 %).
 *
 * Laid out by 1,280 ly sector cell like neutrons.bin: the cell table is read once, a cell's records when a search
 * comes near it, through a small cache let go with the galaxy map's others.
 *
 * File: "EDEXOJMP", u32 version 1, u32 meta length, meta JSON, u32 cells, 14-byte cells (sector x y z u16, first
 * record u32, count u32), 32-byte records (x y z u16 at 1/32 ly from the cell's corner, body id u8, type u8, gravity
 * u16 in 1/1000 g, distance from arrival u16 in 10 ls, V Ge As Cd Nb Y Po u8 — V and Ge in 0.05 %, the rest in
 * 0.02 % —, u8 0, body name u32 string offset, id64 u64), u32 named, 8-byte (record, string offset) pairs, u8-length
 * UTF-8 strings. A body name string is the part after the system's name, or "=" + the whole name.
 */
import {
  closeSync,
  createWriteStream,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { getProjectRoot, resolveUserSettingsJsonPath } from "./paths.js";
import { GALAXY_INDEX_BASE_URL } from "./galaxyIndexFiles.js";
import { loadSectorNames } from "./expedition.js";
import { proceduralSystemName } from "../shared/id64.js";
import { SECTOR_ORIGIN, SECTOR_SIZE_LY } from "../shared/sectorName.js";
import { JUMP_ELEMENTS, bodyJumponium, type JumpElement } from "../shared/jumponium.js";

const MAGIC = "EDEXOJMP";
const CELL_B = 14;
const REC_B = 32;
export const JUMPONIUM_FILE = "jumponium.bin";
export const JUMPONIUM_REMOTE = "jumponium.bin.gz";
export const JUMPONIUM_META_REMOTE = "jumponium.meta.json";
const CELL_CACHE = 1024;
/** The file's elements, in its order, and their unit. */
const FILE_ELS: readonly [JumpElement, number][] = [
  ["vanadium", 0.05],
  ["germanium", 0.05],
  ["arsenic", 0.02],
  ["cadmium", 0.02],
  ["niobium", 0.02],
  ["yttrium", 0.02],
  ["polonium", 0.02],
];
const TYPES = ["Rocky body", "High metal content world", "Metal-rich body", "Icy body", "Rocky Ice world"];

/** The journal's planet classes in Spansh's words, so a list says one name for one type (review 1.2.16). */
const JOURNAL_TYPE: Record<string, string> = {
  "High metal content body": "High metal content world",
  "Metal rich body": "Metal-rich body",
  "Rocky ice body": "Rocky Ice world",
};

/** The top 1 % of landable bodies, per element (the file's cut; Ryker's Hope, 2026-10-13). */
export const JUMP_TOP1: Partial<Record<JumpElement, number>> = {
  vanadium: 9.09,
  germanium: 6.0,
  arsenic: 2.75,
  cadmium: 2.81,
  niobium: 2.48,
  yttrium: 2.19,
  polonium: 1.07,
};

export interface JumpBody {
  /** "file:<record>" or "own:<system>:<body>". */
  id: string;
  system: string;
  body: string;
  x: number;
  y: number;
  z: number;
  type: string | null;
  gravityG: number | null;
  distLs: number | null;
  pct: Partial<Record<JumpElement, number>>;
  /** From the commander's own scans. */
  own: boolean;
}

interface Cell {
  sx: number;
  sy: number;
  sz: number;
  first: number;
  count: number;
}

interface Rec {
  i: number;
  x: number;
  y: number;
  z: number;
  bodyId: number;
  type: string | null;
  gravityG: number;
  distLs: number;
  pct: Partial<Record<JumpElement, number>>;
  nameOff: number;
}

export class JumponiumIndex {
  readonly meta: { bodies: number; systems?: number; dump?: string; builtAt?: string };
  readonly count: number;
  private readonly cells: Cell[];
  private readonly byKey = new Map<string, number>();
  private readonly recAt: number;
  private readonly named = new Map<number, string>();
  private readonly strs: Buffer;
  private readonly cache = new Map<number, Rec[]>();
  private readonly sectorOf: (x: number, y: number, z: number) => string | null;

  constructor(
    private readonly fd: number,
    root: string,
  ) {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    if (head.toString("latin1", 0, 8) !== MAGIC) throw new Error("not a jumponium index");
    const version = head.readUInt32LE(8);
    if (version !== 1) throw new Error(`jumponium index version ${version} is not supported`);
    const metaLen = head.readUInt32LE(12);
    const size = fstatSync(fd).size;
    const metaBuf = Buffer.alloc(metaLen + 4);
    readSync(fd, metaBuf, 0, metaLen + 4, 16);
    this.meta = JSON.parse(metaBuf.toString("utf8", 0, metaLen)) as JumponiumIndex["meta"];
    const nCells = metaBuf.readUInt32LE(metaLen);
    const cellAt = 16 + metaLen + 4;
    const cellBuf = Buffer.alloc(nCells * CELL_B);
    readSync(fd, cellBuf, 0, cellBuf.length, cellAt);
    this.cells = [];
    let total = 0;
    for (let c = 0; c < nCells; c++) {
      const o = c * CELL_B;
      const cell = {
        sx: cellBuf.readUInt16LE(o),
        sy: cellBuf.readUInt16LE(o + 2),
        sz: cellBuf.readUInt16LE(o + 4),
        first: cellBuf.readUInt32LE(o + 6),
        count: cellBuf.readUInt32LE(o + 10),
      };
      this.cells.push(cell);
      this.byKey.set(`${cell.sx},${cell.sy},${cell.sz}`, c);
      total += cell.count;
    }
    this.count = total;
    this.recAt = cellAt + nCells * CELL_B;
    const namedAt = this.recAt + total * REC_B;
    if (namedAt + 4 > size) throw new Error("jumponium index is truncated");
    const nb = Buffer.alloc(4);
    readSync(fd, nb, 0, 4, namedAt);
    const nNamed = nb.readUInt32LE(0);
    const pairs = Buffer.alloc(nNamed * 8);
    readSync(fd, pairs, 0, pairs.length, namedAt + 4);
    const strAt = namedAt + 4 + pairs.length;
    this.strs = Buffer.alloc(Math.max(0, size - strAt));
    readSync(fd, this.strs, 0, this.strs.length, strAt);
    for (let k = 0; k < nNamed; k++)
      this.named.set(pairs.readUInt32LE(k * 8), this.str(pairs.readUInt32LE(k * 8 + 4)));
    const names = loadSectorNames(root);
    this.sectorOf = (x, y, z) => names.byCell.get(`${x},${y},${z}`)?.name ?? null;
  }

  private str(off: number): string {
    const len = this.strs[off] ?? 0;
    return this.strs.toString("utf8", off + 1, off + 1 + len);
  }

  private cell(c: number): Rec[] {
    const hit = this.cache.get(c);
    if (hit) return hit;
    const cell = this.cells[c]!;
    const buf = Buffer.alloc(cell.count * REC_B);
    readSync(this.fd, buf, 0, buf.length, this.recAt + cell.first * REC_B);
    const cx = SECTOR_ORIGIN.x + cell.sx * SECTOR_SIZE_LY;
    const cy = SECTOR_ORIGIN.y + cell.sy * SECTOR_SIZE_LY;
    const cz = SECTOR_ORIGIN.z + cell.sz * SECTOR_SIZE_LY;
    const out: Rec[] = [];
    for (let k = 0; k < cell.count; k++) {
      const o = k * REC_B;
      const pct: Partial<Record<JumpElement, number>> = {};
      FILE_ELS.forEach(([el, unit], j) => {
        const v = buf[o + 12 + j]!;
        if (v) pct[el] = Math.round(v * unit * 100) / 100;
      });
      const t = buf[o + 7]!;
      out.push({
        i: cell.first + k,
        x: cx + buf.readUInt16LE(o) / 32,
        y: cy + buf.readUInt16LE(o + 2) / 32,
        z: cz + buf.readUInt16LE(o + 4) / 32,
        bodyId: buf[o + 6]!,
        type: TYPES[t] ?? null,
        gravityG: buf.readUInt16LE(o + 8) / 1000,
        distLs: buf.readUInt16LE(o + 10) * 10,
        pct,
        nameOff: buf.readUInt32LE(o + 20),
      });
    }
    if (this.cache.size >= CELL_CACHE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(c, out);
    return out;
  }

  private systemName(i: number): string {
    const stored = this.named.get(i);
    if (stored != null) return stored;
    const buf = Buffer.alloc(8);
    readSync(this.fd, buf, 0, 8, this.recAt + i * REC_B + 24);
    return proceduralSystemName(buf.readBigUInt64LE(0), this.sectorOf) ?? `System ${buf.readBigUInt64LE(0)}`;
  }

  private toBody(r: Rec): JumpBody {
    const system = this.systemName(r.i);
    const s = this.str(r.nameOff);
    return {
      id: `file:${r.i}`,
      system,
      body: s.startsWith("=") ? s.slice(1) : `${system} ${s}`,
      x: r.x,
      y: r.y,
      z: r.z,
      type: r.type,
      gravityG: r.gravityG,
      distLs: r.distLs,
      pct: r.pct,
      own: false,
    };
  }

  /** Bodies passing `keep` within `r` ly of a point, nearest first, at most `limit`. */
  near(
    p: { x: number; y: number; z: number },
    r: number,
    keep: (b: Pick<JumpBody, "pct" | "gravityG" | "distLs">) => boolean,
    limit: number,
  ): JumpBody[] {
    const hits: { d2: number; r: Rec }[] = [];
    const lo = (v: number, o: number) => Math.floor((v - r - o) / SECTOR_SIZE_LY);
    const hi = (v: number, o: number) => Math.floor((v + r - o) / SECTOR_SIZE_LY);
    const r2 = r * r;
    for (let sx = lo(p.x, SECTOR_ORIGIN.x); sx <= hi(p.x, SECTOR_ORIGIN.x); sx++)
      for (let sy = lo(p.y, SECTOR_ORIGIN.y); sy <= hi(p.y, SECTOR_ORIGIN.y); sy++)
        for (let sz = lo(p.z, SECTOR_ORIGIN.z); sz <= hi(p.z, SECTOR_ORIGIN.z); sz++) {
          const c = this.byKey.get(`${sx},${sy},${sz}`);
          if (c == null) continue;
          for (const rec of this.cell(c)) {
            const dx = rec.x - p.x;
            const dy = rec.y - p.y;
            const dz = rec.z - p.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 <= r2 && keep(rec)) hits.push({ d2, r: rec });
          }
        }
    hits.sort((a, b) => a.d2 - b.d2);
    return hits.slice(0, limit).map((h) => this.toBody(h.r));
  }

  close(): void {
    this.cache.clear();
    closeSync(this.fd);
  }
}

/* ---- the filter -------------------------------------------------------------------------------- */

export type JumpLevel = "any" | "rich" | "top";

export interface JumpFilter {
  /** Elements asked for (carbon is everywhere and never a filter). */
  els: JumpElement[];
  /** Every one of them on the body, or any one. */
  all: boolean;
  /** How much counts: any amount, the top tenth (rich), the top 1 %. */
  level: JumpLevel;
  maxG: number | null;
  maxLs: number | null;
}

export function threshold(el: JumpElement, level: JumpLevel): number {
  if (level === "any") return Number.MIN_VALUE;
  if (level === "top") return JUMP_TOP1[el] ?? Number.POSITIVE_INFINITY;
  return JUMP_ELEMENTS.find((e) => e.key === el)!.good;
}

export function filterKeep(f: JumpFilter): (b: Pick<JumpBody, "pct" | "gravityG" | "distLs">) => boolean {
  const els = f.els.length
    ? f.els
    : (JUMP_ELEMENTS.map((e) => e.key).filter((k) => k !== "carbon") as JumpElement[]);
  return (b) => {
    if (f.maxG != null && (b.gravityG == null || b.gravityG > f.maxG)) return false;
    if (f.maxLs != null && (b.distLs == null || b.distLs > f.maxLs)) return false;
    const ok = (el: JumpElement) => (b.pct[el] ?? 0) >= threshold(el, f.level);
    return f.all ? els.every(ok) : els.some(ok);
  };
}

/** The commander's own scanned bodies as {@link JumpBody}: every landable one with a materials list. */
export function ownJumpBodies(
  scans: Iterable<{
    systemAddress: number;
    bodyId: number;
    bodyName: string;
    starSystem: string;
    landable?: boolean;
    surfaceGravity?: number;
    distanceFromArrivalLs?: number;
    planetClass?: string;
    materials?: unknown;
  }>,
  posOf: (addr: number) => { x: number; y: number; z: number } | undefined,
): JumpBody[] {
  const out: JumpBody[] = [];
  for (const s of scans) {
    if (s.landable !== true) continue;
    const bj = bodyJumponium(s.materials);
    const p = posOf(s.systemAddress);
    if (!bj || !p) continue;
    const pct: Partial<Record<JumpElement, number>> = {};
    for (const h of bj.hits) pct[h.key] = h.percent;
    out.push({
      id: `own:${s.systemAddress}:${s.bodyId}`,
      system: s.starSystem,
      body: s.bodyName,
      ...p,
      type: s.planetClass ? (JOURNAL_TYPE[s.planetClass] ?? s.planetClass) : null,
      gravityG: typeof s.surfaceGravity === "number" ? s.surfaceGravity / 9.80665 : null,
      distLs: typeof s.distanceFromArrivalLs === "number" ? s.distanceFromArrivalLs : null,
      pct,
      own: true,
    });
  }
  return out;
}

/* ---- file, status, download --------------------------------------------------------------------- */

function userGalaxyDir(): string {
  return path.join(path.dirname(resolveUserSettingsJsonPath()), "galaxy");
}

export function jumponiumFilePath(projectRoot = getProjectRoot()): string {
  const own = path.join(userGalaxyDir(), JUMPONIUM_FILE);
  if (existsSync(own)) return own;
  return path.join(projectRoot, "data", "galaxy", JUMPONIUM_FILE);
}

let cached: { file: string; index: JumponiumIndex } | null = null;

export function loadJumponiumIndex(root = getProjectRoot()): JumponiumIndex | null {
  const file = jumponiumFilePath(root);
  if (cached?.file === file) return cached.index;
  if (!existsSync(file)) return null;
  const fd = openSync(file, "r");
  try {
    cached = { file, index: new JumponiumIndex(fd, root) };
  } catch (e) {
    closeSync(fd);
    throw e;
  }
  return cached.index;
}

export function clearJumponiumIndex(): void {
  cached?.index.close();
  cached = null;
}

export interface JumponiumIndexStatus {
  present: boolean;
  bodies: number | null;
  dump: string | null;
  downloading: { done: number; total: number | null } | null;
  error: string | null;
  release: { bodies: number; dump: string | null; bytes: number } | null;
}

let downloading: JumponiumIndexStatus["downloading"] = null;
let lastError: string | null = null;
let release: JumponiumIndexStatus["release"] = null;
let releaseAskedAt = 0;

export function jumponiumIndexStatus(): JumponiumIndexStatus {
  let meta: JumponiumIndex["meta"] | null = null;
  try {
    meta = loadJumponiumIndex()?.meta ?? null;
  } catch {
    meta = null;
  }
  return {
    present: meta != null,
    bodies: meta?.bodies ?? null,
    dump: meta?.dump ?? null,
    downloading,
    error: lastError,
    release,
  };
}

export async function probeJumponiumRelease(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (Date.now() - releaseAskedAt < 600_000) return;
  releaseAskedAt = Date.now();
  try {
    const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/${JUMPONIUM_META_REMOTE}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return;
    const j = (await r.json()) as { bodies?: number; dump?: string; bytes?: number };
    if (typeof j.bodies === "number" && typeof j.bytes === "number")
      release = { bodies: j.bodies, dump: j.dump ?? null, bytes: j.bytes };
  } catch {
    /* no size on the button */
  }
}

export async function downloadJumponium(onDone: () => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (downloading) return;
  lastError = null;
  const dir = userGalaxyDir();
  const part = path.join(dir, `${JUMPONIUM_FILE}.part`);
  try {
    mkdirSync(dir, { recursive: true });
    downloading = { done: 0, total: null };
    const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/${JUMPONIUM_REMOTE}`, { redirect: "follow" });
    if (!r.ok || !r.body) throw new Error(`${JUMPONIUM_REMOTE}: HTTP ${r.status}`);
    const total = Number(r.headers.get("content-length"));
    downloading = { done: 0, total: Number.isFinite(total) && total > 0 ? total : null };
    const body = Readable.fromWeb(r.body as import("node:stream/web").ReadableStream<Uint8Array>);
    body.on("data", (chunk: Buffer) => {
      if (downloading) downloading = { ...downloading, done: downloading.done + chunk.length };
    });
    await pipeline(body, createGunzip(), createWriteStream(part));
    const head = Buffer.alloc(8);
    const pfd = openSync(part, "r");
    readSync(pfd, head, 0, 8, 0);
    closeSync(pfd);
    if (head.toString("latin1") !== MAGIC) throw new Error("the download is not a jumponium index");
    clearJumponiumIndex();
    renameSync(part, path.join(dir, JUMPONIUM_FILE));
    downloading = null;
    onDone();
  } catch (e) {
    downloading = null;
    lastError = e instanceof Error ? e.message : String(e);
    rmSync(part, { force: true });
  }
}
