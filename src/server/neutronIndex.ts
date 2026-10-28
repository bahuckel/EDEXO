/**
 * Every neutron star that is its system's main star (plan 8, owner 2026-10-13), for the neutron route planner: 3.5 M of
 * them, built by docs/perf/build_neutrons.py from the Spansh dump, an optional download beside the galaxy index.
 *
 * Laid out by 1,280 ly sector cell (about 320 neutron stars, 5 KB, a cell): the cell table is read once, and a cell's
 * records only when a route comes near it, through a small cache let go with the galaxy map's others. A plan from the
 * bubble to Colonia touches a few hundred cells — a few MB — never the 56 MB file.
 *
 * File: "EDEXONEU", u32 version 1, u32 meta length, meta JSON, u32 cells, 14-byte cells (sector x y z u16, first
 * record u32, count u32), 16-byte records (x y z u16 at 1/32 ly from the cell's corner, scoop u16 — 0 none, else 1 +
 * the scoopable star's distance from arrival in 10 ls —, id64 u64), u32 named, 8-byte (record, string offset)
 * pairs, u8-length UTF-8 strings. A name not stored is the procedural one its address gives.
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

const MAGIC = "EDEXONEU";
const CELL_B = 14;
const REC_B = 16;
export const NEUTRONS_FILE = "neutrons.bin";
export const NEUTRONS_REMOTE = "neutrons.bin.gz";
export const NEUTRONS_META_REMOTE = "neutrons.meta.json";
/** Cells kept in memory at once (about 5 KB each): a plan across the galaxy fits. */
const CELL_CACHE = 4096;

export interface NeutronStar {
  /** Record index in the file: stable for a file, used to ask for the name. */
  i: number;
  x: number;
  y: number;
  z: number;
  /** Distance from arrival of the system's own scoopable star (ls), or null when it has none. */
  scoopLs: number | null;
}

/** Sub-cubes a side in a loaded sector cell (80 ly each). */
const SUB = 16;
const subOf = (d: number) => Math.min(SUB - 1, Math.max(0, Math.floor((d * SUB) / SECTOR_SIZE_LY)));

/** A sector cell's stars, by sub-cube, with the cell's corner. */
interface LoadedCell {
  x: number;
  y: number;
  z: number;
  buckets: (NeutronStar[] | undefined)[];
}

interface Cell {
  sx: number;
  sy: number;
  sz: number;
  first: number;
  count: number;
}

export class NeutronIndex {
  readonly meta: { neutrons: number; dump?: string; builtAt?: string; named?: number };
  readonly count: number;
  private readonly cells: Cell[];
  private readonly byKey = new Map<string, number>();
  private readonly recAt: number;
  private readonly named = new Map<number, string>();
  private readonly cache = new Map<number, LoadedCell>();
  private readonly sectorOf: (x: number, y: number, z: number) => string | null;

  constructor(
    private readonly fd: number,
    root: string,
  ) {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    if (head.toString("latin1", 0, 8) !== MAGIC) throw new Error("not a neutron index");
    const version = head.readUInt32LE(8);
    if (version !== 1) throw new Error(`neutron index version ${version} is not supported`);
    const metaLen = head.readUInt32LE(12);
    const size = fstatSync(fd).size;
    const metaBuf = Buffer.alloc(metaLen + 4);
    readSync(fd, metaBuf, 0, metaLen + 4, 16);
    this.meta = JSON.parse(metaBuf.toString("utf8", 0, metaLen)) as NeutronIndex["meta"];
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
    if (namedAt + 4 > size) throw new Error("neutron index is truncated");
    const nb = Buffer.alloc(4);
    readSync(fd, nb, 0, 4, namedAt);
    const nNamed = nb.readUInt32LE(0);
    const pairs = Buffer.alloc(nNamed * 8);
    readSync(fd, pairs, 0, pairs.length, namedAt + 4);
    const strAt = namedAt + 4 + pairs.length;
    const strs = Buffer.alloc(Math.max(0, size - strAt));
    readSync(fd, strs, 0, strs.length, strAt);
    for (let k = 0; k < nNamed; k++) {
      const idx = pairs.readUInt32LE(k * 8);
      const off = pairs.readUInt32LE(k * 8 + 4);
      const len = strs[off] ?? 0;
      this.named.set(idx, strs.toString("utf8", off + 1, off + 1 + len));
    }
    const names = loadSectorNames(root);
    this.sectorOf = (x, y, z) => names.byCell.get(`${x},${y},${z}`)?.name ?? null;
  }

  private cell(c: number): LoadedCell {
    const hit = this.cache.get(c);
    if (hit) return hit;
    const cell = this.cells[c]!;
    const buf = Buffer.alloc(cell.count * REC_B);
    readSync(this.fd, buf, 0, buf.length, this.recAt + cell.first * REC_B);
    const cx = SECTOR_ORIGIN.x + cell.sx * SECTOR_SIZE_LY;
    const cy = SECTOR_ORIGIN.y + cell.sy * SECTOR_SIZE_LY;
    const cz = SECTOR_ORIGIN.z + cell.sz * SECTOR_SIZE_LY;
    const out: NeutronStar[] = [];
    for (let k = 0; k < cell.count; k++) {
      const o = k * REC_B;
      const sc = buf.readUInt16LE(o + 6);
      out.push({
        i: cell.first + k,
        x: cx + buf.readUInt16LE(o) / 32,
        y: cy + buf.readUInt16LE(o + 2) / 32,
        z: cz + buf.readUInt16LE(o + 4) / 32,
        scoopLs: sc === 0 ? null : (sc - 1) * 10,
      });
    }
    // Bucketed by sub-cube, so a query reads the stars near it, not the whole sector's (tens of thousands near the core).
    const buckets: (NeutronStar[] | undefined)[] = new Array(SUB ** 3);
    for (const n of out) {
      const b = subOf(n.x - cx) * SUB * SUB + subOf(n.y - cy) * SUB + subOf(n.z - cz);
      (buckets[b] ??= []).push(n);
    }
    const loaded = { x: cx, y: cy, z: cz, buckets };
    if (this.cache.size >= CELL_CACHE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(c, loaded);
    return loaded;
  }

  /** Neutron stars within `r` ly of a point. */
  within(p: { x: number; y: number; z: number }, r: number): NeutronStar[] {
    const out: NeutronStar[] = [];
    const lo = (v: number, o: number) => Math.floor((v - r - o) / SECTOR_SIZE_LY);
    const hi = (v: number, o: number) => Math.floor((v + r - o) / SECTOR_SIZE_LY);
    const r2 = r * r;
    for (let sx = lo(p.x, SECTOR_ORIGIN.x); sx <= hi(p.x, SECTOR_ORIGIN.x); sx++)
      for (let sy = lo(p.y, SECTOR_ORIGIN.y); sy <= hi(p.y, SECTOR_ORIGIN.y); sy++)
        for (let sz = lo(p.z, SECTOR_ORIGIN.z); sz <= hi(p.z, SECTOR_ORIGIN.z); sz++) {
          const c = this.byKey.get(`${sx},${sy},${sz}`);
          if (c == null) continue;
          const cell = this.cell(c);
          const x0 = subOf(p.x - r - cell.x);
          const x1 = subOf(p.x + r - cell.x);
          const y0 = subOf(p.y - r - cell.y);
          const y1 = subOf(p.y + r - cell.y);
          const z0 = subOf(p.z - r - cell.z);
          const z1 = subOf(p.z + r - cell.z);
          for (let bx = x0; bx <= x1; bx++)
            for (let by = y0; by <= y1; by++)
              for (let bz = z0; bz <= z1; bz++) {
                const bucket = cell.buckets[bx * SUB * SUB + by * SUB + bz];
                if (!bucket) continue;
                for (const n of bucket) {
                  const dx = n.x - p.x;
                  const dy = n.y - p.y;
                  const dz = n.z - p.z;
                  if (dx * dx + dy * dy + dz * dz <= r2) out.push(n);
                }
              }
        }
    return out;
  }

  /**
   * Neutron stars within `r` ly of `p` that bring `to` nearer, the most promising first: sub-cubes go by the most
   * distance to `to` they could gain, and the walk stops once that is no more than `floor()` (the planner's worst kept
   * neighbour). Near the core a supercharge reaches tens of thousands of neutron stars; the planner wants a few dozen.
   */
  eachToward(
    p: { x: number; y: number; z: number },
    r: number,
    to: { x: number; y: number; z: number },
    visit: (n: NeutronStar, gain: number, d: number) => void,
    floor: () => number,
  ): void {
    const left = Math.hypot(to.x - p.x, to.y - p.y, to.z - p.z);
    const side = SECTOR_SIZE_LY / SUB;
    // Distance from a point to a box, per axis.
    const gap = (v: number, lo: number) => Math.max(lo - v, 0, v - (lo + side));
    const boxes: { stars: NeutronStar[]; most: number }[] = [];
    const lo = (v: number, o: number) => Math.floor((v - r - o) / SECTOR_SIZE_LY);
    const hi = (v: number, o: number) => Math.floor((v + r - o) / SECTOR_SIZE_LY);
    for (let sx = lo(p.x, SECTOR_ORIGIN.x); sx <= hi(p.x, SECTOR_ORIGIN.x); sx++)
      for (let sy = lo(p.y, SECTOR_ORIGIN.y); sy <= hi(p.y, SECTOR_ORIGIN.y); sy++)
        for (let sz = lo(p.z, SECTOR_ORIGIN.z); sz <= hi(p.z, SECTOR_ORIGIN.z); sz++) {
          const c = this.byKey.get(`${sx},${sy},${sz}`);
          if (c == null) continue;
          const cell = this.cell(c);
          for (let bx = subOf(p.x - r - cell.x); bx <= subOf(p.x + r - cell.x); bx++)
            for (let by = subOf(p.y - r - cell.y); by <= subOf(p.y + r - cell.y); by++)
              for (let bz = subOf(p.z - r - cell.z); bz <= subOf(p.z + r - cell.z); bz++) {
                const stars = cell.buckets[bx * SUB * SUB + by * SUB + bz];
                if (!stars) continue;
                const x0 = cell.x + bx * side;
                const y0 = cell.y + by * side;
                const z0 = cell.z + bz * side;
                if (Math.hypot(gap(p.x, x0), gap(p.y, y0), gap(p.z, z0)) > r) continue;
                const most = left - Math.hypot(gap(to.x, x0), gap(to.y, y0), gap(to.z, z0));
                if (most > 0) boxes.push({ stars, most });
              }
        }
    boxes.sort((a, b) => b.most - a.most);
    const r2 = r * r;
    for (const box of boxes) {
      if (box.most <= floor()) return;
      for (const n of box.stars) {
        const dx = n.x - p.x;
        const dy = n.y - p.y;
        const dz = n.z - p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const gain = left - Math.hypot(to.x - n.x, to.y - n.y, to.z - n.z);
        if (gain > 0) visit(n, gain, Math.sqrt(d2));
      }
    }
  }

  /** The system's name: stored where its address does not give it, else the procedural one. */
  nameOf(i: number): string {
    const stored = this.named.get(i);
    if (stored != null) return stored;
    const buf = Buffer.alloc(8);
    readSync(this.fd, buf, 0, 8, this.recAt + i * REC_B + 8);
    return (
      proceduralSystemName(buf.readBigUInt64LE(0), this.sectorOf) ?? `Neutron star ${buf.readBigUInt64LE(0)}`
    );
  }

  close(): void {
    this.cache.clear();
    closeSync(this.fd);
  }
}

function userGalaxyDir(): string {
  return path.join(path.dirname(resolveUserSettingsJsonPath()), "galaxy");
}

export function neutronsFilePath(projectRoot = getProjectRoot()): string {
  const own = path.join(userGalaxyDir(), NEUTRONS_FILE);
  if (existsSync(own)) return own;
  return path.join(projectRoot, "data", "galaxy", NEUTRONS_FILE);
}

let cached: { file: string; index: NeutronIndex } | null = null;

export function loadNeutronIndex(root = getProjectRoot()): NeutronIndex | null {
  const file = neutronsFilePath(root);
  if (cached?.file === file) return cached.index;
  if (!existsSync(file)) return null;
  const fd = openSync(file, "r");
  try {
    cached = { file, index: new NeutronIndex(fd, root) };
  } catch (e) {
    closeSync(fd);
    throw e;
  }
  return cached.index;
}

export function clearNeutronIndex(): void {
  cached?.index.close();
  cached = null;
}

export interface NeutronsStatus {
  present: boolean;
  neutrons: number | null;
  dump: string | null;
  downloading: { done: number; total: number | null } | null;
  error: string | null;
  release: { neutrons: number; dump: string | null; bytes: number } | null;
}

let downloading: NeutronsStatus["downloading"] = null;
let lastError: string | null = null;
let release: NeutronsStatus["release"] = null;
let releaseAskedAt = 0;

export function neutronsStatus(): NeutronsStatus {
  let meta: NeutronIndex["meta"] | null = null;
  try {
    meta = loadNeutronIndex()?.meta ?? null;
  } catch {
    meta = null;
  }
  return {
    present: meta != null,
    neutrons: meta?.neutrons ?? null,
    dump: meta?.dump ?? null,
    downloading,
    error: lastError,
    release,
  };
}

export async function probeNeutronsRelease(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (Date.now() - releaseAskedAt < 600_000) return;
  releaseAskedAt = Date.now();
  try {
    const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/${NEUTRONS_META_REMOTE}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return;
    const j = (await r.json()) as { neutrons?: number; dump?: string; bytes?: number };
    if (typeof j.neutrons === "number" && typeof j.bytes === "number")
      release = { neutrons: j.neutrons, dump: j.dump ?? null, bytes: j.bytes };
  } catch {
    /* no size on the button */
  }
}

export async function downloadNeutrons(onDone: () => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (downloading) return;
  lastError = null;
  const dir = userGalaxyDir();
  const part = path.join(dir, `${NEUTRONS_FILE}.part`);
  try {
    mkdirSync(dir, { recursive: true });
    downloading = { done: 0, total: null };
    const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/${NEUTRONS_REMOTE}`, { redirect: "follow" });
    if (!r.ok || !r.body) throw new Error(`${NEUTRONS_REMOTE}: HTTP ${r.status}`);
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
    if (head.toString("latin1") !== MAGIC) throw new Error("the download is not a neutron index");
    clearNeutronIndex();
    renameSync(part, path.join(dir, NEUTRONS_FILE));
    downloading = null;
    onDone();
  } catch (e) {
    downloading = null;
    lastError = e instanceof Error ? e.message : String(e);
    rmSync(part, { force: true });
  }
}
