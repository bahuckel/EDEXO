/**
 * Catalogue systems by boxel, for the predicted boxel positions (owner 2026-11-28). A catalogue star ("FF Aquilae B")
 * holds a system number in its boxel and its own cell, and the game places the next system from it; the dice do not
 * place it. EDEXO never learns where these are by itself: a visited one carries its common name, which the boxel
 * parser skips, and the Spansh look-up lists it the same way. So they ship: `data/boxel/boxel-catalogue.bin`, built by
 * docs/perf/boxel_catalogue.py from the Intergalactic Astronomical Union's `catalog_systems.csv` (public domain;
 * credited in NOTICE.md). 143,105 systems of mass codes a to g, 2.9 MB.
 *
 * Measured (docs/boxel-star-placement-23112026.md §3m, one sector in 40): with them, the misses left of mass code d
 * drop from 1,422 to 133 (99.78 → 99.98 % exact), c from 989 to 230, e from 55 to 5.
 *
 * Read on first use into sorted typed arrays (3.4 MB), found by a binary search on the boxel.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Vec3 } from "../shared/boxelOrder.js";
import { SECTOR_ORIGIN } from "../shared/sectorName.js";

const MAGIC = "EDEXOCAT";
const RECORD = 20;

export interface CatalogueTable {
  meta: { builtAt?: string; source?: string; kept?: number };
  /** The boxel of each system (its address's low bits, below 2^44: exact in a double), sorted. */
  bases: Float64Array;
  /** Each system's number in its boxel. */
  numbers: Uint32Array;
  /** x, y, z per system, 1/32 ly from the galaxy grid's corner. */
  steps: Int32Array;
}

/** Parses the file; throws on anything that is not one. */
export function parseCatalogueTable(buf: Buffer): CatalogueTable {
  if (buf.length < 20 || buf.toString("latin1", 0, 8) !== MAGIC) throw new Error("not a boxel-catalogue file");
  const version = buf.readUInt32LE(8);
  if (version !== 1) throw new Error(`boxel-catalogue version ${version} is not supported`);
  const metaLen = buf.readUInt32LE(12);
  let at = 16 + metaLen;
  if (at + 4 > buf.length) throw new Error("boxel-catalogue file is truncated");
  const meta = JSON.parse(buf.toString("utf8", 16, at)) as CatalogueTable["meta"];
  const count = buf.readUInt32LE(at);
  at += 4;
  if (at + count * RECORD > buf.length) throw new Error("boxel-catalogue file is truncated");
  const bases = new Float64Array(count);
  const numbers = new Uint32Array(count);
  const steps = new Int32Array(count * 3);
  for (let i = 0; i < count; i++, at += RECORD) {
    const address = buf.readBigUInt64LE(at);
    const mc = Number(address & 7n);
    const shift = BigInt(44 - 3 * mc);
    bases[i] = Number(address & ((1n << shift) - 1n));
    numbers[i] = Number(address >> shift);
    steps[i * 3] = buf.readInt32LE(at + 8);
    steps[i * 3 + 1] = buf.readInt32LE(at + 12);
    steps[i * 3 + 2] = buf.readInt32LE(at + 16);
    if (i > 0 && bases[i]! < bases[i - 1]!) throw new Error("boxel-catalogue file is not sorted");
  }
  return { meta, bases, numbers, steps };
}

/** The catalogue systems of one boxel (`base`: the address of its system 0), number → position in light years. */
export function catalogueSystemsIn(table: CatalogueTable, base: bigint | number): Map<number, Vec3> {
  const key = Number(base);
  const out = new Map<number, Vec3>();
  let lo = 0;
  let hi = table.bases.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table.bases[mid]! < key) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < table.bases.length && table.bases[i] === key; i++) {
    out.set(table.numbers[i]!, [
      SECTOR_ORIGIN.x + table.steps[i * 3]! / 32,
      SECTOR_ORIGIN.y + table.steps[i * 3 + 1]! / 32,
      SECTOR_ORIGIN.z + table.steps[i * 3 + 2]! / 32,
    ]);
  }
  return out;
}

let cache: { root: string; table: CatalogueTable | null } | null = null;

/** The shipped table, read once; null where the file is missing (positions are then predicted as before). */
export function loadCatalogueTable(root: string): CatalogueTable | null {
  if (cache?.root === root) return cache.table;
  const file = path.join(root, "data", "boxel", "boxel-catalogue.bin");
  let table: CatalogueTable | null = null;
  try {
    table = existsSync(file) ? parseCatalogueTable(readFileSync(file)) : null;
  } catch {
    table = null;
  }
  cache = { root, table };
  return table;
}

export function clearCatalogueTable(): void {
  cache = null;
}
