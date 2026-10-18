/**
 * The system finder's data (plan docs/plan-finder-1.2.20.md): `finder.bin`, built from the Spansh dump by
 * docs/perf/build_finder.py, published beside the galaxy index and downloaded only when the commander asks.
 *
 * Every system with a listed body within 150 ly of inhabited space (6.7 M systems), in blocks of 160 ly, each block
 * gzipped on its own: a search reads the header and block table once (a few MB), then only the blocks it needs,
 * unpacked off the thread (zlib's pool) and kept in a small cache (64 MB). The file is never read whole.
 *
 * File (little endian), version 1: "EDXFND01", u32 version, u32 meta length, meta JSON, zero pad to 8; u32 blocks,
 * u32 0, then 24 bytes per block (i16 bx, by, bz, u16 0, u32 systems, u32 compressed bytes, u64 offset); then the
 * blocks. A block unpacks to columns: u64 id64, f32 x, y, z, u32 star mask, u16 listed bodies, u16 body count
 * (0xFFFF unknown), one u8 column per `meta.u8Columns`, then the names joined by "\n".
 */
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync } from "node:fs";
import { open as openAsync, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { gunzip as gunzipCb } from "node:zlib";
import { GALAXY_INDEX_BASE_URL } from "./galaxyIndexFiles.js";
import { getProjectRoot, resolveUserSettingsJsonPath } from "./paths.js";

const gunzip = promisify(gunzipCb);
const MAGIC = "EDXFND01";
const BLOCK_ENTRY = 24;
export const FINDER_FILE = "finder.bin";
export const FINDER_META_REMOTE = "finder.meta.json";
/** Decoded blocks kept, by their unpacked size. */
const CACHE_BYTES = 64 * 1024 * 1024;

export interface FinderMeta {
  version: number;
  builtAt?: string;
  dump?: string;
  stationsDump?: string;
  radius?: number;
  count: number;
  blocks: number;
  blockLy: number;
  origin: [number, number, number];
  u8Columns: string[];
  starClasses: string[];
  flags: Record<string, number>;
}

export interface FinderBlockRef {
  bx: number;
  by: number;
  bz: number;
  count: number;
  bytes: number;
  offset: number;
}

export interface FinderBlock {
  n: number;
  id64: BigUint64Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  starMask: Uint32Array;
  listed: Uint16Array;
  bodyCount: Uint16Array;
  /** To the nearest colonised system, 1/100 ly; 0xFFFF beyond 655 ly. */
  distColonised: Uint16Array;
  u8: Record<string, Uint8Array>;
  /** Names, unpacked on first use. */
  names(): string[];
  size: number;
}

/** Unpack one block's columns (exported for tests). */
export function decodeFinderBlock(raw: Uint8Array, n: number, u8Columns: readonly string[]): FinderBlock {
  // A copy at offset 0, so every typed view below is aligned whatever buffer zlib handed back.
  const buf = new Uint8Array(raw.length);
  buf.set(raw);
  const ab = buf.buffer;
  let at = 0;
  const take = <T>(make: (b: ArrayBuffer, o: number, len: number) => T, size: number): T => {
    const v = make(ab, at, n);
    at += size * n;
    return v;
  };
  const id64 = take((b, o, l) => new BigUint64Array(b, o, l), 8);
  const x = take((b, o, l) => new Float32Array(b, o, l), 4);
  const y = take((b, o, l) => new Float32Array(b, o, l), 4);
  const z = take((b, o, l) => new Float32Array(b, o, l), 4);
  const starMask = take((b, o, l) => new Uint32Array(b, o, l), 4);
  const listed = take((b, o, l) => new Uint16Array(b, o, l), 2);
  const bodyCount = take((b, o, l) => new Uint16Array(b, o, l), 2);
  const distColonised = take((b, o, l) => new Uint16Array(b, o, l), 2);
  const u8: Record<string, Uint8Array> = {};
  for (const k of u8Columns) u8[k] = take((b, o, l) => new Uint8Array(b, o, l), 1);
  if (at > buf.length) throw new Error("finder block is truncated");
  const namesAt = at;
  let names: string[] | null = null;
  return {
    n,
    id64,
    x,
    y,
    z,
    starMask,
    listed,
    bodyCount,
    distColonised,
    u8,
    names: () => (names ??= n ? Buffer.from(ab, namesAt, buf.length - namesAt).toString("utf8").split("\n") : []),
    size: buf.length,
  };
}

export class FinderIndex {
  readonly meta: FinderMeta;
  readonly blocks: FinderBlockRef[];
  private readonly cache = new Map<number, FinderBlock>();
  private cacheBytes = 0;
  private readonly pending = new Map<number, Promise<FinderBlock>>();
  /** One handle for every block read (a full scan reads ~100,000 blocks); closed with the cache. */
  private handle: Promise<FileHandle> | null = null;

  constructor(
    readonly file: string,
    head: Buffer,
  ) {
    if (head.length < 16 || head.toString("latin1", 0, 8) !== MAGIC) throw new Error("not a finder file");
    const version = head.readUInt32LE(8);
    if (version !== 1) throw new Error(`finder file version ${version} is not supported`);
    const metaLen = head.readUInt32LE(12);
    let at = 16 + metaLen;
    this.meta = JSON.parse(head.toString("utf8", 16, at)) as FinderMeta;
    at += (8 - (at % 8)) % 8;
    const count = head.readUInt32LE(at);
    at += 8;
    if (at + count * BLOCK_ENTRY > head.length) throw new Error("finder file is truncated");
    this.blocks = new Array<FinderBlockRef>(count);
    for (let i = 0; i < count; i++, at += BLOCK_ENTRY) {
      this.blocks[i] = {
        bx: head.readInt16LE(at),
        by: head.readInt16LE(at + 2),
        bz: head.readInt16LE(at + 4),
        count: head.readUInt32LE(at + 8),
        bytes: head.readUInt32LE(at + 12),
        offset: Number(head.readBigUInt64LE(at + 16)),
      };
    }
  }

  /** Read the header and block table of a file (throws when it is not one). */
  static open(file: string): FinderIndex {
    const fd = openSync(file, "r");
    try {
      const first = Buffer.alloc(64 * 1024);
      const got = readSync(fd, first, 0, first.length, 0);
      if (got < 16 || first.toString("latin1", 0, 8) !== MAGIC) throw new Error("not a finder file");
      const metaLen = first.readUInt32LE(12);
      let at = 16 + metaLen;
      at += (8 - (at % 8)) % 8;
      const headLen = at + 8;
      const lead = Buffer.alloc(headLen);
      readSync(fd, lead, 0, headLen, 0);
      const count = lead.readUInt32LE(at);
      const whole = Buffer.alloc(headLen + count * BLOCK_ENTRY);
      readSync(fd, whole, 0, whole.length, 0);
      return new FinderIndex(file, whole);
    } finally {
      closeSync(fd);
    }
  }

  /** Lowest corner of a block, light years. */
  blockMin(b: FinderBlockRef): { x: number; y: number; z: number } {
    const [ox, oy, oz] = this.meta.origin;
    const s = this.meta.blockLy;
    return { x: ox + b.bx * s, y: oy + b.by * s, z: oz + b.bz * s };
  }

  /** Squared distance from a point to a block's box (0 inside). */
  blockDist2(b: FinderBlockRef, x: number, y: number, z: number): number {
    const m = this.blockMin(b);
    const s = this.meta.blockLy;
    const d = (v: number, lo: number) => (v < lo ? lo - v : v > lo + s ? v - lo - s : 0);
    const dx = d(x, m.x);
    const dy = d(y, m.y);
    const dz = d(z, m.z);
    return dx * dx + dy * dy + dz * dz;
  }

  async block(i: number): Promise<FinderBlock> {
    const hit = this.cache.get(i);
    if (hit) {
      this.cache.delete(i);
      this.cache.set(i, hit);
      return hit;
    }
    const waiting = this.pending.get(i);
    if (waiting) return waiting;
    const ref = this.blocks[i];
    if (!ref) throw new Error(`no finder block ${i}`);
    const p = (async () => {
      try {
        this.handle ??= openAsync(this.file, "r");
        const fh = await this.handle;
        const comp = Buffer.alloc(ref.bytes);
        await fh.read(comp, 0, ref.bytes, ref.offset);
        const blk = decodeFinderBlock(await gunzip(comp), ref.count, this.meta.u8Columns);
        this.cache.set(i, blk);
        this.cacheBytes += blk.size;
        for (const [k, v] of this.cache) {
          if (this.cacheBytes <= CACHE_BYTES) break;
          this.cache.delete(k);
          this.cacheBytes -= v.size;
        }
        return blk;
      } finally {
        this.pending.delete(i);
      }
    })();
    this.pending.set(i, p);
    return p;
  }

  /** Drop the decoded blocks and close the file (resolves once it is closed: Windows will not replace an open file). */
  clearCache(): Promise<void> {
    this.cache.clear();
    this.cacheBytes = 0;
    const h = this.handle;
    this.handle = null;
    return h ? h.then((fh) => fh.close()).catch(() => {}) : Promise.resolve();
  }
}

function userGalaxyDir(): string {
  return path.join(path.dirname(resolveUserSettingsJsonPath()), "galaxy");
}

/** The downloaded file, else a developer tree's `data/galaxy/finder.bin`. */
export function finderFilePath(projectRoot = getProjectRoot()): string {
  const own = path.join(userGalaxyDir(), FINDER_FILE);
  if (existsSync(own)) return own;
  return path.join(projectRoot, "data", "galaxy", FINDER_FILE);
}

let cached: FinderIndex | null = null;
let cachedKey = "";

/** The finder file, opened once per file and size (a new download replaces it). */
export function loadFinderIndex(): FinderIndex | null {
  const file = finderFilePath();
  if (!existsSync(file)) return null;
  const key = `${file}|${statSync(file).size}`;
  if (cached && cachedKey === key) return cached;
  cached = FinderIndex.open(file);
  cachedKey = key;
  return cached;
}

export function clearFinderIndex(): Promise<void> {
  const closing = cached?.clearCache() ?? Promise.resolve();
  cached = null;
  cachedKey = "";
  return closing;
}

export function finderUserFilePath(): string {
  return path.join(userGalaxyDir(), FINDER_FILE);
}

export interface FinderStatus {
  present: boolean;
  systems: number | null;
  builtAt: string | null;
  dump: string | null;
  bytes: number | null;
  downloading: { done: number; total: number | null } | null;
  error: string | null;
  /** From the release's finder.meta.json: what a download would bring. Null until asked. */
  release: { systems: number; dump: string | null; bytes: number } | null;
}

let downloading: FinderStatus["downloading"] = null;
let lastError: string | null = null;
let release: FinderStatus["release"] = null;
let releaseAskedAt = 0;

export function finderStatus(): FinderStatus {
  const file = finderFilePath();
  const present = existsSync(file);
  let meta: FinderMeta | null = null;
  if (present) {
    try {
      meta = loadFinderIndex()?.meta ?? null;
    } catch {
      meta = null;
    }
  }
  return {
    present: present && meta != null,
    systems: meta?.count ?? null,
    builtAt: meta?.builtAt ?? null,
    dump: meta?.dump ?? null,
    bytes: present ? statSync(file).size : null,
    downloading,
    error: lastError,
    release,
  };
}

/** Ask the release what it holds (a few hundred bytes), at most every ten minutes. Quiet on failure. */
export async function probeFinderRelease(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (Date.now() - releaseAskedAt < 600_000) return;
  releaseAskedAt = Date.now();
  try {
    const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/${FINDER_META_REMOTE}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return;
    const j = (await r.json()) as { count?: number; dump?: string; bytes?: number };
    if (typeof j.count === "number" && typeof j.bytes === "number")
      release = { systems: j.count, dump: j.dump ?? null, bytes: j.bytes };
  } catch {
    /* the drawer shows no size */
  }
}

/**
 * Download the file beside the settings. It is already compressed block by block, so it is stored as it comes;
 * a `.part` until whole and opened once (header and block table) before it replaces the old.
 */
export async function downloadFinder(onDone: () => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (downloading) return;
  lastError = null;
  const dir = userGalaxyDir();
  const part = path.join(dir, `${FINDER_FILE}.part`);
  try {
    mkdirSync(dir, { recursive: true });
    downloading = { done: 0, total: null };
    const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/${FINDER_FILE}`, { redirect: "follow" });
    if (!r.ok || !r.body) throw new Error(`${FINDER_FILE}: HTTP ${r.status}`);
    const total = Number(r.headers.get("content-length"));
    downloading = { done: 0, total: Number.isFinite(total) && total > 0 ? total : null };
    const body = Readable.fromWeb(r.body as import("node:stream/web").ReadableStream<Uint8Array>);
    body.on("data", (chunk: Buffer) => {
      if (downloading) downloading = { ...downloading, done: downloading.done + chunk.length };
    });
    await pipeline(body, createWriteStream(part));
    const check = FinderIndex.open(part);
    const last = check.blocks[check.blocks.length - 1];
    if (last && last.offset + last.bytes > statSync(part).size) throw new Error(`${FINDER_FILE} is truncated`);
    await check.clearCache();
    await clearFinderIndex();
    renameSync(part, path.join(dir, FINDER_FILE));
    downloading = null;
    onDone();
  } catch (e) {
    downloading = null;
    lastError = e instanceof Error ? e.message : String(e);
    rmSync(part, { force: true });
  }
}
