/**
 * The galaxy map's index files, as a separate download (owner, 2026-10-04, plan 4.2: "separate download
 * button marked as EDAstro again, with size").
 *
 * `bio-index.bin` (every system with recorded biology, from EDAstro's codex export) and
 * `system-traits.bin.gz` (their stars and planets, from Spansh's dump) were a quarter of a gigabyte of
 * every download, for a map not everyone opens. Builds leave them out (scripts/packagedData.mjs); the
 * map offers them from a fixed GitHub release and they land beside the user's settings, where an
 * update leaves them alone. A developer tree keeps reading its own `data/galaxy/` copies.
 */
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getProjectRoot, resolveUserSettingsJsonPath } from "./paths.js";

export const GALAXY_INDEX_FILES = ["bio-index.bin", "system-traits.bin.gz"] as const;
export type GalaxyIndexFile = (typeof GALAXY_INDEX_FILES)[number];

/** Where the release keeps them: one release, updated when the index is rebuilt. */
export const GALAXY_INDEX_BASE_URL =
  "https://github.com/bahuckel/EDEXO-Compare/releases/download/galaxy-index";

function userGalaxyDir(): string {
  return path.join(path.dirname(resolveUserSettingsJsonPath()), "galaxy");
}

/** The file to read: the downloaded copy when there is one, else the project's `data/galaxy/`. */
export function galaxyIndexFilePath(name: GalaxyIndexFile, projectRoot = getProjectRoot()): string {
  const own = path.join(userGalaxyDir(), name);
  if (existsSync(own)) return own;
  return path.join(projectRoot, "data", "galaxy", name);
}

export interface GalaxyIndexStatus {
  /** The bio index is readable, so the map can draw. */
  present: boolean;
  files: { name: GalaxyIndexFile; bytes: number | null }[];
  /** A download in progress: bytes so far and the total, when the server said it. */
  downloading: { name: GalaxyIndexFile; done: number; total: number | null } | null;
  error: string | null;
  /** What the download would weigh (from the release), for the button; null until asked. */
  downloadBytes: number | null;
  /**
   * The release holds other files than these (a size differs; owner, 2026-10-07: "I still don't see a
   * way to download the index" once one was there). Null until the release has been asked.
   */
  updateAvailable: boolean | null;
  /**
   * Systems in the bio index here and on the release (its header, `EDEXOBIO` … u32 at byte 12), so the
   * button says "+10.3k systems" rather than a size (owner, 2026-10-12: "a megabyte can be thousands of
   * systems"). Null when unknown.
   */
  systemsHere: number | null;
  systemsOnRelease: number | null;
}

const BIO_MAGIC = "EDEXOBIO";
/** The system count from a bio index header (20 bytes or more), or null when it is not one. */
export function bioIndexSystemCount(head: Uint8Array): number | null {
  if (head.length < 16) return null;
  const b = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  if (b.toString("ascii", 0, 8) !== BIO_MAGIC) return null;
  return b.readUInt32LE(12);
}

function localSystemCount(): number | null {
  const p = galaxyIndexFilePath("bio-index.bin");
  if (!existsSync(p)) return null;
  let fd: number | null = null;
  try {
    fd = openSync(p, "r");
    const head = Buffer.alloc(20);
    readSync(fd, head, 0, 20, 0);
    return bioIndexSystemCount(head);
  } catch {
    return null;
  } finally {
    if (fd != null) closeSync(fd);
  }
}

/** The size and count probes give up after this: a stalled network must not hold the status request for minutes. */
const PROBE_TIMEOUT_MS = 10_000;

/** The release's count: its first 20 bytes (a range request; a server that sends it all is cut off there). */
async function remoteSystemCount(fetchImpl: typeof fetch): Promise<number | null> {
  try {
    const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/bio-index.bin`, {
      headers: { Range: "bytes=0-19" },
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!r.ok || !r.body) return null;
    const reader = r.body.getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    while (got < 20) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      parts.push(value);
      got += value.length;
    }
    await reader.cancel().catch(() => undefined);
    const head = new Uint8Array(got);
    let at = 0;
    for (const p of parts) {
      head.set(p, at);
      at += p.length;
    }
    return bioIndexSystemCount(head);
  } catch {
    return null;
  }
}

let downloading: GalaxyIndexStatus["downloading"] = null;
let lastError: string | null = null;
let downloadBytes: number | null = null;
/** Each file's size on the release, from the last probe. */
let remoteSizes: Map<string, number> | null = null;
let systemsOnRelease: number | null = null;

export function galaxyIndexStatus(): GalaxyIndexStatus {
  const files = GALAXY_INDEX_FILES.map((name) => {
    const p = galaxyIndexFilePath(name);
    let bytes: number | null = null;
    try {
      bytes = existsSync(p) ? statSync(p).size : null;
    } catch {
      bytes = null;
    }
    return { name, bytes };
  });
  const updateAvailable = remoteSizes
    ? files.some((f) => f.bytes != null && f.bytes !== remoteSizes!.get(f.name))
    : null;
  return {
    present: files[0]!.bytes != null,
    files,
    downloading,
    error: lastError,
    downloadBytes,
    updateAvailable,
    systemsHere: localSystemCount(),
    systemsOnRelease,
  };
}

/** Ask the release how big the files are (HEAD requests), for the button's label. Quiet on failure. */
export async function probeGalaxyIndexSize(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    let total = 0;
    const sizes = new Map<string, number>();
    for (const name of GALAXY_INDEX_FILES) {
      const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/${name}`, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const n = Number(r.headers.get("content-length"));
      if (!r.ok || !Number.isFinite(n) || n <= 0) return null;
      sizes.set(name, n);
      total += n;
    }
    downloadBytes = total;
    remoteSizes = sizes;
    systemsOnRelease = await remoteSystemCount(fetchImpl);
    return total;
  } catch {
    return null;
  }
}

/**
 * Download both files into the user's folder, one after the other, each to a `.part` file renamed into
 * place when complete — a cut download never looks like an index. `onDone` clears the caches that read
 * them. A second call while one runs is ignored.
 */
/** How long the galaxy index download waits for an answer, and for the next bytes once it streams. */
export const INDEX_CONNECT_TIMEOUT_MS = 30_000;
export const INDEX_IDLE_TIMEOUT_MS = 60_000;

export async function downloadGalaxyIndex(
  onDone: () => void,
  fetchImpl: typeof fetch = fetch,
  timeouts: { connectMs: number; idleMs: number } = {
    connectMs: INDEX_CONNECT_TIMEOUT_MS,
    idleMs: INDEX_IDLE_TIMEOUT_MS,
  },
): Promise<void> {
  if (downloading) return;
  lastError = null;
  const dir = userGalaxyDir();
  mkdirSync(dir, { recursive: true });
  try {
    for (const name of GALAXY_INDEX_FILES) {
      downloading = { name, done: 0, total: null };
      /*
        A stalled connection used to leave "downloading" up until the app restarted, and a second
        click was ignored while it was (code review A10, 2026-10-14). No answer in 30 s, or no bytes
        for 60 s once it streams, ends this attempt like any other failure: the error is shown, the
        `.part` file goes, and the button works again.
      */
      const ac = new AbortController();
      let idle = setTimeout(
        () => ac.abort(new Error(`${name}: no answer in ${timeouts.connectMs / 1000} s`)),
        timeouts.connectMs,
      );
      const stall = () => {
        clearTimeout(idle);
        idle = setTimeout(
          () => ac.abort(new Error(`${name}: no data for ${timeouts.idleMs / 1000} s`)),
          timeouts.idleMs,
        );
      };
      try {
        const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/${name}`, {
          redirect: "follow",
          signal: ac.signal,
        });
        if (!r.ok || !r.body) throw new Error(`${name}: HTTP ${r.status}`);
        stall();
        const total = Number(r.headers.get("content-length"));
        downloading = { name, done: 0, total: Number.isFinite(total) && total > 0 ? total : null };
        const part = path.join(dir, `${name}.part`);
        const body = Readable.fromWeb(r.body as import("node:stream/web").ReadableStream<Uint8Array>);
        body.on("data", (chunk: Buffer) => {
          stall();
          if (downloading) downloading = { ...downloading, done: downloading.done + chunk.length };
        });
        await pipeline(body, createWriteStream(part), { signal: ac.signal });
        renameSync(part, path.join(dir, name));
      } catch (e) {
        throw ac.signal.aborted && ac.signal.reason instanceof Error ? ac.signal.reason : e;
      } finally {
        clearTimeout(idle);
      }
    }
    downloading = null;
    remoteSizes = null; // asked again next time: the files here are now the release's
    onDone();
  } catch (e) {
    downloading = null;
    lastError = e instanceof Error ? e.message : String(e);
    for (const name of GALAXY_INDEX_FILES) rmSync(path.join(dir, `${name}.part`), { force: true });
  }
}
