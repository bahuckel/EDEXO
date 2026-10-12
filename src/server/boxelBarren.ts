/**
 * Systems somebody has already flown and found barren, per boxel (owner, 2026-10-12, after the 1.2.15 review: the
 * planner counted every system nobody had recorded *biology* in as unflown, so a boxel the bubble's traffic had
 * mostly visited still looked full). `data/boxel/boxel-barren.bin`, built by docs/perf/boxel_barren.py from the
 * Spansh dump: systems with known bodies, last updated in 2025 or later, without a biological body (older records
 * without biology say nothing: signals were seldom uploaded before Odyssey). Keyed by `gridIdAt`.
 *
 * About 1.2 M boxels, 7.8 MB on disk; decoded into one sorted Float64Array of ids and one Uint16Array of counts
 * per mass code (about 11 MB), plus where each boxel's system numbers start in the file (version 2: the copy list
 * leaves those names out), read on first use and let go with the galaxy map's other caches.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { MassCode } from "../shared/boxelAdvice.js";

interface CodeTable {
  ids: Float64Array;
  counts: Uint16Array;
  /** Version 2: where each boxel's system numbers start in `buf`. */
  numsAt?: Uint32Array;
}

export interface BarrenTable {
  meta: { builtAt?: string; dump?: string; recentFrom?: string };
  byCode: Map<MassCode, CodeTable>;
  buf: Buffer;
}

const MAGIC = "EDEXOBRN";

/** Parses the file; throws on anything that is not one (wrong magic or version, a count past the end). */
export function parseBarrenTable(buf: Buffer): BarrenTable {
  if (buf.length < 20 || buf.toString("latin1", 0, 8) !== MAGIC) throw new Error("not a boxel-barren file");
  const version = buf.readUInt32LE(8);
  if (version !== 1 && version !== 2) throw new Error(`boxel-barren version ${version} is not supported`);
  const metaLen = buf.readUInt32LE(12);
  let at = 16 + metaLen;
  if (at + 4 > buf.length) throw new Error("boxel-barren file is truncated");
  const meta = JSON.parse(buf.toString("utf8", 16, at)) as BarrenTable["meta"];
  const codes = buf.readUInt32LE(at);
  at += 4;
  const varint = (): number => {
    let n = 0;
    let mul = 1;
    for (;;) {
      if (at >= buf.length) throw new Error("boxel-barren file is truncated");
      const b = buf[at++]!;
      n += (b & 0x7f) * mul;
      if (b < 0x80) return n;
      mul *= 128;
    }
  };
  const byCode = new Map<MassCode, CodeTable>();
  for (let c = 0; c < codes; c++) {
    if (at + 8 > buf.length) throw new Error("boxel-barren file is truncated");
    const code = String.fromCharCode(buf[at]!) as MassCode;
    const n = buf.readUInt32LE(at + 4);
    at += 8;
    if (n > buf.length - at) throw new Error("boxel-barren count runs past the end of the file");
    const ids = new Float64Array(n);
    const counts = new Uint16Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) ids[i] = prev += varint();
    for (let i = 0; i < n; i++) counts[i] = varint();
    let numsAt: Uint32Array | undefined;
    if (version >= 2) {
      numsAt = new Uint32Array(n);
      for (let i = 0; i < n; i++) {
        numsAt[i] = at;
        for (let k = counts[i]!; k > 0; k--) varint();
      }
    }
    byCode.set(code, numsAt ? { ids, counts, numsAt } : { ids, counts });
  }
  return { meta, byCode, buf };
}

function indexOf(t: CodeTable, gridId: number): number {
  let lo = 0;
  let hi = t.ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = t.ids[mid]!;
    if (v === gridId) return mid;
    if (v < gridId) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Barren systems in one boxel (its `gridIdAt` id), 0 when the table has none there. */
export function barrenIn(table: BarrenTable | null, code: MassCode, gridId: number): number {
  const t = table?.byCode.get(code);
  if (!t) return 0;
  const i = indexOf(t, gridId);
  return i < 0 ? 0 : t.counts[i]!;
}

/** The barren systems' numbers in one boxel (`<boxel>-<n>`), ascending; empty without them (or in a version 1 file). */
export function barrenNumbersIn(table: BarrenTable | null, code: MassCode, gridId: number): number[] {
  const t = table?.byCode.get(code);
  if (!t?.numsAt) return [];
  const i = indexOf(t, gridId);
  if (i < 0) return [];
  const buf = table!.buf;
  let at = t.numsAt[i]!;
  const out: number[] = [];
  let v = 0;
  for (let k = t.counts[i]!; k > 0; k--) {
    let n = 0;
    let mul = 1;
    for (;;) {
      const b = buf[at++]!;
      n += (b & 0x7f) * mul;
      if (b < 0x80) break;
      mul *= 128;
    }
    v += n;
    out.push(v);
  }
  return out;
}

let cache: { root: string; table: BarrenTable | null } | null = null;

/** The shipped table, read once; null where the file is missing (a dev tree without it scores as before). */
export function loadBarrenTable(root: string): BarrenTable | null {
  if (cache?.root === root) return cache.table;
  const file = path.join(root, "data", "boxel", "boxel-barren.bin");
  const table = existsSync(file) ? parseBarrenTable(readFileSync(file)) : null;
  cache = { root, table };
  return table;
}

export function clearBarrenTable(): void {
  cache = null;
}
