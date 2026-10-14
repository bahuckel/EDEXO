/**
 * A cache cleared while its file is being read (code review, 2026-10-14). The clears after an index download
 * and on idle release emptied the cache but left the read in flight: it put the old file's data back
 * afterwards, and callers after the clear joined it. Now a clear starts a new generation: the old read
 * answers only its own callers.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearBioIndexCache, loadBioIndexAsync, peekBioIndex } from "../src/server/bioIndex.js";
import { clearSystemTraits, loadSystemTraitsAsync, TRAITS_MAGIC } from "../src/server/galaxyTraits.js";

/** A bio index of `n` systems with no species, in the shape scripts/build-bio-index.ts writes (bioIndex.test.ts). */
function writeIndex(file: string, n: number): void {
  const json = Buffer.from(JSON.stringify({ species: [] }), "utf8");
  const head = Buffer.alloc(20);
  head.write("EDEXOBIO", 0, "ascii");
  head.writeUInt16LE(3, 8);
  head.writeUInt16LE(0, 10);
  head.writeUInt32LE(n, 12);
  head.writeUInt32LE(json.length, 16);
  const table = Buffer.alloc(n * 25);
  for (let i = 0; i < n; i++) table.writeBigUInt64LE(BigInt(100 + i), i * 25);
  writeFileSync(file, Buffer.concat([head, json, table]));
}

/** A system-traits file of `n` systems (galaxyTraits.ts parseSystemTraits). */
function writeTraits(file: string, n: number): void {
  const pad = (12 + n) % 4 ? 4 - ((12 + n) % 4) : 0;
  const raw = Buffer.alloc(12 + n + pad + n * 8);
  raw.write(TRAITS_MAGIC, 0, "ascii");
  raw.writeUInt32LE(n, 8);
  writeFileSync(file, gzipSync(raw));
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "edexo-cache-gen-"));
  clearBioIndexCache();
  clearSystemTraits();
});
afterEach(() => {
  clearBioIndexCache();
  clearSystemTraits();
  rmSync(dir, { recursive: true, force: true });
});

describe("the bio index, cleared while it is being read", () => {
  it("is read again after the clear, and the old read does not come back as the cache", async () => {
    const before = join(dir, "before.bin");
    const after = join(dir, "after.bin");
    writeIndex(before, 4);
    writeIndex(after, 9);
    const old = loadBioIndexAsync(before);
    clearBioIndexCache();
    const fresh = loadBioIndexAsync(after);
    expect(fresh).not.toBe(old);
    const [o, f] = await Promise.all([old, fresh]);
    expect(o!.systemCount).toBe(4); // its own caller still gets what it read
    expect(f!.systemCount).toBe(9);
    expect(peekBioIndex()).toBe(f);
  });

  it("an old read finishing after the clear leaves nothing cached", async () => {
    const before = join(dir, "before.bin");
    writeIndex(before, 4);
    const old = loadBioIndexAsync(before);
    clearBioIndexCache();
    await old;
    expect(peekBioIndex()).toBeNull();
  });
});

describe("the system traits, cleared while they are being read", () => {
  it("are read again after the clear, and the old read is not kept", async () => {
    const before = join(dir, "before.gz");
    const after = join(dir, "after.gz");
    writeTraits(before, 3);
    writeTraits(after, 7);
    const old = loadSystemTraitsAsync(before);
    clearSystemTraits();
    const fresh = loadSystemTraitsAsync(after);
    expect(fresh).not.toBe(old);
    expect((await old)!.count).toBe(3);
    expect((await fresh)!.count).toBe(7);
    // Held now: the same answer whatever file is asked for.
    expect((await loadSystemTraitsAsync(before))!.count).toBe(7);
  });
});
