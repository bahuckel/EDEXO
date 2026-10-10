/**
 * The galaxy body file read through a page cache instead of whole (plan 4.2, 2026-10-11): every value,
 * including one straddling two 1 MB pages, reads exactly as it does from the bytes in memory, after
 * more pages than the cache holds have been read, and after the file was closed under it.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PagedFile } from "../src/server/bioBodies.js";

const dir = mkdtempSync(path.join(tmpdir(), "edexo-paged-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("paged body file", () => {
  it("reads every width at every offset as the buffer does, across pages and after a close", () => {
    const size = 40 * (1 << 20) + 12345; // more pages than the cache keeps
    const buf = Buffer.alloc(size);
    for (let i = 0; i + 4 <= size; i += 4) buf.writeUInt32LE((i * 2654435761) >>> 0, i);
    const file = path.join(dir, "f.bin");
    writeFileSync(file, buf);
    const p = new PagedFile(file, size);
    const page = 1 << 20;
    const offsets = [0, 1, page - 1, page - 2, page - 3, page - 7, page, 5 * page - 4, 39 * page + 100, size - 8];
    for (const o of [...offsets, ...offsets.reverse()]) {
      expect(p.getUint8(o)).toBe(buf.readUInt8(o));
      if (o + 2 <= size) expect(p.getUint16(o, true)).toBe(buf.readUInt16LE(o));
      if (o + 4 <= size) expect(p.getUint32(o, true)).toBe(buf.readUInt32LE(o));
      if (o + 4 <= size) expect(Object.is(p.getFloat32(o, true), buf.readFloatLE(o))).toBe(true);
      if (o + 8 <= size) expect(p.getBigUint64(o, true)).toBe(buf.readBigUInt64LE(o));
    }
    expect(p.toString("hex", page - 3, page + 3)).toBe(buf.toString("hex", page - 3, page + 3));
    p.close();
    // A walk still holding the handle after the idle release reads on.
    expect(p.getUint32(page - 2, true)).toBe(buf.readUInt32LE(page - 2));
    p.close();
  });
});
