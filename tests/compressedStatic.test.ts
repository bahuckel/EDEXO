/** The pages' scripts and styles, compressed for a browser that asks (src/server/compressedStatic.ts). */
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compressedStatic, pickEncoding } from "../src/server/compressedStatic.js";
import { listenLocal } from "./helpers/listenLocal.js";

let root: string;
let base: string;
let close: () => void;
const big = "export const words = [" + Array.from({ length: 2000 }, (_, i) => `"word${i % 50}"`).join(",") + "];\n";

/** Raw bytes and headers: fetch() would undo the compression this is about. */
function get(p: string, headers: Record<string, string> = {}, method = "GET") {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = http.request(`${base}${p}`, { method, headers }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (c: Buffer) => parts.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-compressed-"));
  mkdirSync(path.join(root, "assets"));
  writeFileSync(path.join(root, "assets", "app.js"), big);
  writeFileSync(path.join(root, "assets", "tiny.js"), "export {};\n");
  writeFileSync(path.join(root, "page.html"), `<!doctype html>${big}`);
  writeFileSync(path.join(root, ".secret.js"), big);
  const app = express();
  app.use(compressedStatic(root, (p) => (p.includes(`${path.sep}assets${path.sep}`) ? "immutable-test" : "revalidate-test")));
  app.use(express.static(root, { index: false }));
  const s = await listenLocal(app);
  base = s.base;
  close = () => s.server.close();
});
afterAll(() => {
  close();
  rmSync(root, { recursive: true, force: true });
});

describe("pickEncoding", () => {
  it("prefers brotli, falls back to gzip, honours q=0 and *", () => {
    expect(pickEncoding("gzip, deflate, br, zstd")).toBe("br");
    expect(pickEncoding("gzip, deflate")).toBe("gzip");
    expect(pickEncoding("br;q=0, gzip;q=0.5")).toBe("gzip");
    expect(pickEncoding("*")).toBe("br");
    expect(pickEncoding("identity")).toBeNull();
    expect(pickEncoding(undefined)).toBeNull();
  });
});

describe("compressedStatic", () => {
  it("answers brotli or gzip with the same bytes inside, and the file's cache rule", async () => {
    const br = await get("/assets/app.js", { "Accept-Encoding": "gzip, br" });
    expect(br.status).toBe(200);
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.headers["vary"]).toBe("Accept-Encoding");
    expect(br.headers["cache-control"]).toBe("immutable-test");
    expect(br.headers["content-type"]).toMatch(/javascript/);
    expect(brotliDecompressSync(br.body).toString()).toBe(big);
    expect(br.body.length).toBeLessThan(big.length / 4);

    const gz = await get("/assets/app.js", { "Accept-Encoding": "gzip" });
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gz.body).toString()).toBe(big);
  });

  it("leaves to express.static what it should not compress", async () => {
    for (const [p, why] of [
      ["/assets/app.js", "no Accept-Encoding"],
      ["/assets/tiny.js", "too small"],
      ["/page.html", "HTML"],
    ] as const) {
      const r = await get(p, why === "no Accept-Encoding" ? {} : { "Accept-Encoding": "br" });
      expect(r.status, why).toBe(200);
      expect(r.headers["content-encoding"], why).toBeUndefined();
    }
    expect((await get("/.secret.js", { "Accept-Encoding": "br" })).status).toBe(404);
    expect((await get("/..%2f..%2fx.js", { "Accept-Encoding": "br" })).headers["content-encoding"]).toBeUndefined();
  });

  it("answers 304 to its own ETag, and HEAD without a body", async () => {
    const first = await get("/assets/app.js", { "Accept-Encoding": "br" });
    const again = await get("/assets/app.js", { "Accept-Encoding": "br", "If-None-Match": String(first.headers.etag) });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
    const head = await get("/assets/app.js", { "Accept-Encoding": "br" }, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers["content-length"]).toBe(String(first.body.length));
    expect(head.body.length).toBe(0);
  });

  it("compresses a changed file afresh", async () => {
    const before = await get("/assets/app.js", { "Accept-Encoding": "br" });
    const changed = big.replace("word1", "WORD1");
    writeFileSync(path.join(root, "assets", "app.js"), changed);
    const after = await get("/assets/app.js", { "Accept-Encoding": "br" });
    expect(brotliDecompressSync(after.body).toString()).toBe(changed);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    writeFileSync(path.join(root, "assets", "app.js"), big);
  });
});
