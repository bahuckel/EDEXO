/**
 * A fixed-stride binary file read through a small page cache instead of held whole (plan 4.2, 2026-10-11):
 * the galaxy body file (683 MB) was read with readFileSync and kept. Its tables are fixed-stride and read
 * in order, so a pass touches a few pages at a time. (The bio index stays whole: its 110 MB of names are
 * read at random by the map's find box and the scans, and paged they were 60 times slower; plan 4.3.)
 */
import { closeSync, openSync, readSync } from "node:fs";

/**
 * Pages of `pageSize` bytes, at most `maxPages` held, first in first out (1 MB × 32 by default, for long
 * walks in order). The getters are DataView's, so readers keep their offset arithmetic.
 */
export class PagedFile {
  /** Each page with its DataView, made once when the page is read (the getters are DataView's). */
  private readonly pages = new Map<number, { b: Buffer; v: DataView }>();
  private fd: number | null = null;
  constructor(
    private readonly file: string,
    readonly length: number,
    private readonly pageSize = 1 << 20,
    private readonly maxPages = 32,
  ) {}
  /** The page used last: a walk reads the same page many times in a row, so it skips the lookup. */
  private lastN = -1;
  private last: { b: Buffer; v: DataView } | null = null;
  private view(n: number): DataView {
    return this.entry(n).v;
  }
  private page(n: number): Buffer {
    return this.entry(n).b;
  }
  private entry(n: number): { b: Buffer; v: DataView } {
    if (n === this.lastN && this.last) return this.last;
    // First in, first out: a walk reads four tables in step, each in order, so the oldest page is the
    // one done with; reordering on every hit cost more than it saved.
    let e = this.pages.get(n);
    if (!e) {
      // Opened on first read, and again if the idle release closed it under a walk still running.
      if (this.fd === null) this.fd = openSync(this.file, "r");
      const start = n * this.pageSize;
      const size = Math.max(0, Math.min(this.pageSize, this.length - start));
      const b = Buffer.allocUnsafe(size);
      let got = 0;
      while (got < size) {
        const r = readSync(this.fd, b, got, size - got, start + got);
        if (r <= 0) break;
        got += r;
      }
      e = { b, v: new DataView(b.buffer, b.byteOffset, b.byteLength) };
      this.pages.set(n, e);
      if (this.pages.size > this.maxPages) this.pages.delete(this.pages.keys().next().value!);
    }
    this.lastN = n;
    this.last = e;
    return e;
  }
  /**
   * A record of `len` bytes at `o` as a view and the record's offset in it: the page's own view when the
   * record fits in the page (nearly always), else a copy. Resolved once per record, so a reader that
   * takes ten fields of it pays the page lookup once.
   */
  record(o: number, len: number): [DataView, number] {
    const at = o % this.pageSize;
    if (at + len <= this.pageSize) return [this.view((o / this.pageSize) | 0), at];
    const b = this.bytes(o, len);
    return [new DataView(b.buffer, b.byteOffset, b.byteLength), 0];
  }
  /** `len` bytes at `o`, from one page when they fit in it, else copied across. */
  bytes(o: number, len: number): Buffer {
    const n = Math.floor(o / this.pageSize);
    const at = o - n * this.pageSize;
    if (at + len <= this.pageSize) return this.page(n).subarray(at, at + len);
    const out = Buffer.allocUnsafe(len);
    let done = 0;
    while (done < len) {
      const pn = Math.floor((o + done) / this.pageSize);
      const pa = o + done - pn * this.pageSize;
      const take = Math.min(len - done, this.pageSize - pa);
      this.page(pn).copy(out, done, pa, pa + take);
      done += take;
    }
    return out;
  }
  getUint8(o: number): number {
    return this.page((o / this.pageSize) | 0)[o % this.pageSize]!;
  }
  // Read straight off the page when the value fits in it (nearly always); across two pages, copied.
  getUint16(o: number, _le?: boolean): number {
    const at = o % this.pageSize;
    return at + 2 <= this.pageSize ? this.view((o / this.pageSize) | 0).getUint16(at, true) : this.bytes(o, 2).readUInt16LE(0);
  }
  getUint32(o: number, _le?: boolean): number {
    const at = o % this.pageSize;
    return at + 4 <= this.pageSize ? this.view((o / this.pageSize) | 0).getUint32(at, true) : this.bytes(o, 4).readUInt32LE(0);
  }
  getFloat32(o: number, _le?: boolean): number {
    const at = o % this.pageSize;
    return at + 4 <= this.pageSize ? this.view((o / this.pageSize) | 0).getFloat32(at, true) : this.bytes(o, 4).readFloatLE(0);
  }
  getBigUint64(o: number, _le?: boolean): bigint {
    const at = o % this.pageSize;
    return at + 8 <= this.pageSize ? this.view((o / this.pageSize) | 0).getBigUint64(at, true) : this.bytes(o, 8).readBigUInt64LE(0);
  }
  toString(encoding: BufferEncoding, start: number, end: number): string {
    return end > start ? this.bytes(start, end - start).toString(encoding) : "";
  }
  close(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
    this.pages.clear();
    this.lastN = -1;
    this.last = null;
  }
}
