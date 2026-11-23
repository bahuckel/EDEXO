/**
 * The pages' scripts and styles, compressed for a browser that asks (docs/ui-ideas-16112026.md §4.6, 2026-11-23: a
 * phone loaded 1.4 MB uncompressed on a cold start). Each file is compressed once, off the main thread, and kept while
 * it is unchanged: brotli at quality 5 (all 162 built files in 155 ms together, 5.2 MB to 1.2 MB; quality 11 saves
 * another 14 % for 6 s), gzip for a browser without brotli. HTML, small files and a browser that asks for neither go
 * on to express.static as before.
 */
import { readFile, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import type { RequestHandler } from "express";

const COMPRESSIBLE = new Set([".js", ".mjs", ".css", ".svg", ".json", ".webmanifest"]);
/** Below this a compressed answer saves nothing worth the header. */
const MIN_BYTES = 1024;

export type Encoding = "br" | "gzip";

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/** The encoding to answer with for this Accept-Encoding: brotli first, then gzip; null for neither (or q=0). */
export function pickEncoding(acceptEncoding: string | undefined): Encoding | null {
  const q = new Map<string, number>();
  for (const part of (acceptEncoding ?? "").toLowerCase().split(",")) {
    const [name, ...params] = part.split(";").map((s) => s.trim());
    if (!name) continue;
    const weight = params.map((p) => /^q=([\d.]+)$/.exec(p)).find(Boolean);
    q.set(name, weight ? Number(weight[1]) : 1);
  }
  const offered = (name: Encoding) => (q.get(name) ?? q.get("*") ?? 0) > 0;
  return offered("br") ? "br" : offered("gzip") ? "gzip" : null;
}

/**
 * Serves `webRoot`'s compressible files compressed; `cacheControl` gives the header express.static would have sent
 * for that file, so caching is the same either way.
 */
export function compressedStatic(webRoot: string, cacheControl: (absPath: string) => string): RequestHandler {
  const root = path.resolve(webRoot);
  const kept = new Map<string, { version: string; out: Partial<Record<Encoding, Promise<Buffer>>> }>();

  const compressed = (abs: string, st: Stats, enc: Encoding): Promise<Buffer> => {
    const version = `${st.size}:${st.mtimeMs}`;
    let k = kept.get(abs);
    if (!k || k.version !== version) {
      k = { version, out: {} };
      kept.set(abs, k);
    }
    const entry = k;
    entry.out[enc] ??= readFile(abs).then((raw) =>
      enc === "br"
        ? brotli(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
        : gz(raw, { level: 6 }),
    );
    // A failed read or compression is not kept: the next request tries again.
    entry.out[enc]!.catch(() => {
      if (kept.get(abs) === entry) delete entry.out[enc];
    });
    return entry.out[enc]!;
  };

  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const ext = path.extname(req.path).toLowerCase();
    if (!COMPRESSIBLE.has(ext)) return next();
    const enc = pickEncoding(req.headers["accept-encoding"]);
    if (!enc) return next();
    let rel: string;
    try {
      rel = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    // Inside the web root, no dotfiles: what express.static would refuse is left to it.
    if (rel.split(/[\\/]/).some((seg) => seg.startsWith("."))) return next();
    const abs = path.resolve(root, `.${rel}`);
    if (!abs.startsWith(root + path.sep)) return next();
    void (async () => {
      const st = await stat(abs).catch(() => null);
      if (!st?.isFile() || st.size < MIN_BYTES) return next();
      let body: Buffer;
      try {
        body = await compressed(abs, st, enc);
      } catch {
        return next();
      }
      res.type(ext);
      res.setHeader("Vary", "Accept-Encoding");
      res.setHeader("Cache-Control", cacheControl(abs));
      res.setHeader("Last-Modified", st.mtime.toUTCString());
      res.setHeader("ETag", `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${enc}"`);
      if (req.fresh) {
        res.status(304).end();
        return;
      }
      res.setHeader("Content-Encoding", enc);
      res.setHeader("Content-Length", body.length);
      res.end(req.method === "HEAD" ? undefined : body);
    })().catch(next);
  };
}
