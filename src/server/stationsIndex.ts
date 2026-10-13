/**
 * Stations for the galaxy map and "nearest station with a service" (plan 7, owner 2026-10-13: "stations and systems,
 * including colonised ones, … nearest station with X service, same as the carrier thing"). Built from Spansh's
 * nightly station dump by docs/perf/build_stations.py into `stations.bin` (fleet carriers left out: the Carriers
 * screen has them), published beside the galaxy index and downloaded only when the commander asks.
 *
 * File: "EDEXOSTA", u32 version, u32 meta length, meta JSON (services[], types[] in bit / code order), u32 systems,
 * u32 stations, 22-byte system records (x y z f32, name offset u32, first station u32, count u16), 20-byte station
 * records (system u32, services u32, type u8, largest pad u8, distance f32, updated u16 days since 2014, name u32),
 * then length-prefixed UTF-8 strings.
 *
 * Read whole on first use (about 35 MB for 800 k stations), queried by a straight pass (a nearest search over every
 * system is a few milliseconds), and let go with the galaxy map's other caches when it idles.
 */
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { getProjectRoot, resolveUserSettingsJsonPath } from "./paths.js";
import { GALAXY_INDEX_BASE_URL } from "./galaxyIndexFiles.js";

const MAGIC = "EDEXOSTA";
const SYS = 22;
const ST = 20;
const EPOCH_MS = Date.UTC(2014, 0, 1);
export const STATIONS_FILE = "stations.bin";
/** What the release holds: the index gzipped, and a few bytes saying what is in it (for the Update button). */
export const STATIONS_REMOTE = "stations.bin.gz";
export const STATIONS_META_REMOTE = "stations.meta.json";

export interface StationsMeta {
  builtAt?: string;
  dump?: string;
  services: string[];
  types: string[];
  systems: number;
  stations: number;
}

export interface StationRow {
  name: string;
  system: string;
  x: number;
  y: number;
  z: number;
  type: string;
  /** "L", "M", "S" or "" (no pad: a settlement reached on foot, or not known). */
  pad: "L" | "M" | "S" | "";
  distanceLs: number;
  services: string[];
  /** YYYY-MM-DD of the station's last record. */
  updated: string | null;
  distanceLy: number;
}

export class StationsIndex {
  readonly meta: StationsMeta;
  readonly systemCount: number;
  readonly stationCount: number;
  private readonly sysAt: number;
  private readonly stAt: number;
  private readonly strAt: number;

  constructor(private readonly buf: Buffer) {
    if (buf.length < 24 || buf.toString("latin1", 0, 8) !== MAGIC) throw new Error("not a stations index");
    const version = buf.readUInt32LE(8);
    if (version !== 1) throw new Error(`stations index version ${version} is not supported`);
    const metaLen = buf.readUInt32LE(12);
    let at = 16 + metaLen;
    if (at + 8 > buf.length) throw new Error("stations index is truncated");
    this.meta = JSON.parse(buf.toString("utf8", 16, at)) as StationsMeta;
    this.systemCount = buf.readUInt32LE(at);
    this.stationCount = buf.readUInt32LE(at + 4);
    at += 8;
    this.sysAt = at;
    this.stAt = at + this.systemCount * SYS;
    this.strAt = this.stAt + this.stationCount * ST;
    if (this.strAt > buf.length) throw new Error("stations index is truncated");
  }

  private str(off: number): string {
    const at = this.strAt + off;
    if (at >= this.buf.length) return "";
    const n = this.buf[at]!;
    return this.buf.toString("utf8", at + 1, at + 1 + n);
  }

  /** The services' bits for names (unknown names are ignored). */
  maskOf(names: readonly string[]): number {
    let m = 0;
    for (const n of names) {
      const i = this.meta.services.indexOf(n);
      if (i >= 0 && i < 32) m |= 1 << i;
    }
    return m >>> 0;
  }

  private row(i: number, sys: number, d: number): StationRow {
    const o = this.stAt + i * ST;
    const so = this.sysAt + sys * SYS;
    const mask = this.buf.readUInt32LE(o + 4);
    const pad = this.buf[o + 9]!;
    const day = this.buf.readUInt16LE(o + 14);
    return {
      name: this.str(this.buf.readUInt32LE(o + 16)),
      system: this.str(this.buf.readUInt32LE(so + 12)),
      x: this.buf.readFloatLE(so),
      y: this.buf.readFloatLE(so + 4),
      z: this.buf.readFloatLE(so + 8),
      type: this.meta.types[this.buf[o + 8]!] ?? "",
      pad: pad === 3 ? "L" : pad === 2 ? "M" : pad === 1 ? "S" : "",
      distanceLs: Math.round(this.buf.readFloatLE(o + 10)),
      services: this.meta.services.filter((_s, b) => (mask >>> b) & 1),
      updated: day > 0 ? new Date(EPOCH_MS + day * 86_400_000).toISOString().slice(0, 10) : null,
      distanceLy: Math.round(d * 10) / 10,
    };
  }

  /**
   * The nearest stations to a point that have the services asked for (all of them, or any), a pad at least this
   * big, at most this far from the arrival star; settlements and colonisation construction sites only if asked.
   */
  nearest(q: {
    from: { x: number; y: number; z: number };
    services?: readonly string[];
    mode?: "all" | "any";
    minPad?: "S" | "M" | "L" | "";
    maxDistanceLs?: number | null;
    settlements?: boolean;
    construction?: boolean;
    limit?: number;
  }): StationRow[] {
    const want = this.maskOf(q.services ?? []);
    const any = q.mode === "any";
    const minPad = q.minPad === "L" ? 3 : q.minPad === "M" ? 2 : q.minPad === "S" ? 1 : 0;
    const maxLs = q.maxDistanceLs != null && q.maxDistanceLs > 0 ? q.maxDistanceLs : Infinity;
    const limit = Math.max(1, Math.min(200, q.limit ?? 30));
    const settlementTypes = new Set(
      ["Settlement", "Surface Settlement"].map((t) => this.meta.types.indexOf(t)),
    );
    const constructionTypes = new Set(
      ["Planetary Construction Depot", "Space Construction Depot"].map((t) => this.meta.types.indexOf(t)),
    );
    const best: { i: number; sys: number; d: number }[] = [];
    let worst = Infinity;
    for (let s = 0; s < this.systemCount; s++) {
      const so = this.sysAt + s * SYS;
      const dx = this.buf.readFloatLE(so) - q.from.x;
      const dy = this.buf.readFloatLE(so + 4) - q.from.y;
      const dz = this.buf.readFloatLE(so + 8) - q.from.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (best.length >= limit && d >= worst) continue;
      const first = this.buf.readUInt32LE(so + 16);
      const count = this.buf.readUInt16LE(so + 20);
      for (let i = first; i < first + count; i++) {
        const o = this.stAt + i * ST;
        const mask = this.buf.readUInt32LE(o + 4);
        if (want && (any ? (mask & want) === 0 : (mask & want) >>> 0 !== want)) continue;
        if (this.buf[o + 9]! < minPad) continue;
        const t = this.buf[o + 8]!;
        if (!q.settlements && settlementTypes.has(t)) continue;
        if (!q.construction && constructionTypes.has(t)) continue;
        if (this.buf.readFloatLE(o + 10) > maxLs) continue;
        best.push({ i, sys: s, d });
        if (best.length > limit) {
          best.sort((a, b) => a.d - b.d);
          best.length = limit;
        }
        if (best.length >= limit) worst = Math.max(...best.map((b) => b.d));
      }
    }
    best.sort((a, b) => a.d - b.d);
    return best.slice(0, limit).map((b) => this.row(b.i, b.sys, b.d));
  }

  /** One point per system for the map: position, its largest pad, how many stations, its name. */
  forEachSystem(
    cb: (x: number, y: number, z: number, bestPad: number, stations: number, name: () => string) => void,
  ): void {
    for (let s = 0; s < this.systemCount; s++) {
      const so = this.sysAt + s * SYS;
      const first = this.buf.readUInt32LE(so + 16);
      const count = this.buf.readUInt16LE(so + 20);
      let pad = 0;
      for (let i = first; i < first + count; i++) pad = Math.max(pad, this.buf[this.stAt + i * ST + 9]!);
      cb(
        this.buf.readFloatLE(so),
        this.buf.readFloatLE(so + 4),
        this.buf.readFloatLE(so + 8),
        pad,
        count,
        () => this.str(this.buf.readUInt32LE(so + 12)),
      );
    }
  }

  /** The stations of the system at a point (the map's hover), nearest system within `withinLy`. */
  stationsNear(p: { x: number; y: number; z: number }, withinLy = 1): StationRow[] {
    let bestS = -1;
    let bestD = withinLy;
    for (let s = 0; s < this.systemCount; s++) {
      const so = this.sysAt + s * SYS;
      const d = Math.hypot(
        this.buf.readFloatLE(so) - p.x,
        this.buf.readFloatLE(so + 4) - p.y,
        this.buf.readFloatLE(so + 8) - p.z,
      );
      if (d <= bestD) {
        bestD = d;
        bestS = s;
      }
    }
    if (bestS < 0) return [];
    const so = this.sysAt + bestS * SYS;
    const first = this.buf.readUInt32LE(so + 16);
    const count = this.buf.readUInt16LE(so + 20);
    const out: StationRow[] = [];
    for (let i = first; i < first + count; i++) out.push(this.row(i, bestS, bestD));
    return out;
  }
}

function userGalaxyDir(): string {
  return path.join(path.dirname(resolveUserSettingsJsonPath()), "galaxy");
}

/** The downloaded index, else a developer tree's `data/galaxy/stations.bin`. */
export function stationsFilePath(projectRoot = getProjectRoot()): string {
  const own = path.join(userGalaxyDir(), STATIONS_FILE);
  if (existsSync(own)) return own;
  return path.join(projectRoot, "data", "galaxy", STATIONS_FILE);
}

let cached: StationsIndex | null = null;
let cachedFrom = "";

export function loadStationsIndex(): StationsIndex | null {
  const file = stationsFilePath();
  if (cached && cachedFrom === file) return cached;
  if (!existsSync(file)) return null;
  cached = new StationsIndex(readFileSync(file));
  cachedFrom = file;
  return cached;
}

export function clearStationsIndex(): void {
  cached = null;
  cachedFrom = "";
}

export interface StationsStatus {
  present: boolean;
  stations: number | null;
  builtAt: string | null;
  dump: string | null;
  bytes: number | null;
  downloading: { done: number; total: number | null } | null;
  error: string | null;
  /** From the release's stations.meta.json: what a download would bring. Null until asked. */
  release: { stations: number; dump: string | null; bytes: number } | null;
}

let downloading: StationsStatus["downloading"] = null;
let lastError: string | null = null;
let release: StationsStatus["release"] = null;
let releaseAskedAt = 0;

/** The header only: the meta JSON, without reading 35 MB. */
function readHeaderMeta(file: string): StationsMeta | null {
  let fd: number | null = null;
  try {
    fd = openSync(file, "r");
    const head = Buffer.alloc(64 * 1024);
    readSync(fd, head, 0, head.length, 0);
    if (head.toString("latin1", 0, 8) !== MAGIC) return null;
    const len = head.readUInt32LE(12);
    return JSON.parse(head.toString("utf8", 16, 16 + len)) as StationsMeta;
  } catch {
    return null;
  } finally {
    if (fd != null) closeSync(fd);
  }
}

export function stationsStatus(): StationsStatus {
  const file = stationsFilePath();
  const present = existsSync(file);
  const meta = present ? (cached?.meta ?? readHeaderMeta(file)) : null;
  return {
    present,
    stations: meta?.stations ?? null,
    builtAt: meta?.builtAt ?? null,
    dump: meta?.dump ?? null,
    bytes: present ? statSync(file).size : null,
    downloading,
    error: lastError,
    release,
  };
}

/** Ask the release what it holds (a few hundred bytes), at most every ten minutes. Quiet on failure. */
export async function probeStationsRelease(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (Date.now() - releaseAskedAt < 600_000) return;
  releaseAskedAt = Date.now();
  try {
    const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/${STATIONS_META_REMOTE}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return;
    const j = (await r.json()) as { stations?: number; dump?: string; bytes?: number };
    if (typeof j.stations === "number" && typeof j.bytes === "number")
      release = { stations: j.stations, dump: j.dump ?? null, bytes: j.bytes };
  } catch {
    /* the button shows no size */
  }
}

/** Download and unpack the index beside the settings; a `.part` until whole, so a cut download is never read. */
export async function downloadStations(onDone: () => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (downloading) return;
  lastError = null;
  const dir = userGalaxyDir();
  mkdirSync(dir, { recursive: true });
  const part = path.join(dir, `${STATIONS_FILE}.part`);
  try {
    downloading = { done: 0, total: null };
    const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/${STATIONS_REMOTE}`, { redirect: "follow" });
    if (!r.ok || !r.body) throw new Error(`${STATIONS_REMOTE}: HTTP ${r.status}`);
    const total = Number(r.headers.get("content-length"));
    downloading = { done: 0, total: Number.isFinite(total) && total > 0 ? total : null };
    const body = Readable.fromWeb(r.body as import("node:stream/web").ReadableStream<Uint8Array>);
    body.on("data", (chunk: Buffer) => {
      if (downloading) downloading = { ...downloading, done: downloading.done + chunk.length };
    });
    await pipeline(body, createGunzip(), createWriteStream(part));
    new StationsIndex(readFileSync(part)); // refuse a file that is not one before it replaces the old
    clearStationsIndex();
    renameSync(part, path.join(dir, STATIONS_FILE));
    downloading = null;
    onDone();
  } catch (e) {
    downloading = null;
    lastError = e instanceof Error ? e.message : String(e);
    rmSync(part, { force: true });
  }
}
