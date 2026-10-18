/**
 * A finder.bin written from TypeScript in the layout docs/perf/build_finder.py writes (tests/finder.test.ts and the
 * galaxy map's e2e test share it).
 */
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { FINDER_FLAG } from "../../src/shared/finder.js";

const U8 = [
  "mainStar", "stars", "planets", "flags",
  "elw", "ww", "aw", "water_giant", "gg1", "gg2", "gg3", "gg4", "gg5", "gg_water_life", "gg_ammonia_life",
  "helium_gg", "helium_rich", "hmc", "metal_rich", "rocky", "rocky_ice", "icy",
  "ringed", "landable", "landable_atmo", "terraformable", "bio", "geo",
];
const STARS = ["O", "B", "A", "F", "G", "K", "M", "L", "T", "Y", "TTS", "AeBe", "W", "C", "D", "N", "H", "SG"];
const ORIGIN: [number, number, number] = [-49985, -40985, -24105];
const BLOCK = 160;

export interface Sys {
  id: bigint;
  name: string;
  x: number;
  y: number;
  z: number;
  starMask?: number;
  listed?: number;
  bodyCount?: number;
  u8?: Partial<Record<string, number>>;
}

/** The file layout of build_finder.py, written from TypeScript. */
export function writeFinder(file: string, systems: Sys[]): void {
  // As build_finder.py: to the nearest system flagged colonised, 1/100 ly, 0xFFFF beyond 655 ly.
  const colonised = systems.filter((s) => (s.u8?.flags ?? 0) & FINDER_FLAG.colonised);
  const distColonised = (s: Sys) => {
    let best = Infinity;
    for (const c of colonised) best = Math.min(best, Math.hypot(c.x - s.x, c.y - s.y, c.z - s.z));
    return best <= 655 ? Math.min(65534, Math.round(best * 100)) : 0xffff;
  };
  const key = (s: Sys) => [0, 1, 2].map((a) => Math.floor(([s.x, s.y, s.z][a]! - ORIGIN[a]!) / BLOCK));
  const groups = new Map<string, Sys[]>();
  for (const s of systems) {
    const k = key(s).join(",");
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const blocks = [...groups.entries()].map(([k, list]) => {
    list.sort((a, b) => a.x - b.x);
    const n = list.length;
    const parts: Buffer[] = [];
    const col = (bytes: number, write: (b: Buffer, s: Sys, i: number) => void) => {
      const b = Buffer.alloc(bytes * n);
      list.forEach((s, i) => write(b, s, i));
      parts.push(b);
    };
    col(8, (b, s, i) => b.writeBigUInt64LE(s.id, i * 8));
    for (const a of ["x", "y", "z"] as const) col(4, (b, s, i) => b.writeFloatLE(s[a], i * 4));
    col(4, (b, s, i) => b.writeUInt32LE(s.starMask ?? 0, i * 4));
    col(2, (b, s, i) => b.writeUInt16LE(s.listed ?? 1, i * 2));
    col(2, (b, s, i) => b.writeUInt16LE(s.bodyCount ?? 0xffff, i * 2));
    col(2, (b, s, i) => b.writeUInt16LE(distColonised(s), i * 2));
    for (const c of U8) col(1, (b, s, i) => b.writeUInt8(s.u8?.[c] ?? (c === "mainStar" ? 255 : 0), i));
    parts.push(Buffer.from(list.map((s) => s.name).join("\n"), "utf8"));
    const [bx, by, bz] = k.split(",").map(Number);
    return { bx: bx!, by: by!, bz: bz!, n, comp: gzipSync(Buffer.concat(parts)) };
  });
  const meta = Buffer.from(
    JSON.stringify({ version: 1, builtAt: "test", dump: "test-dump", count: systems.length, blocks: blocks.length, blockLy: BLOCK, origin: ORIGIN, u8Columns: U8, starClasses: STARS, flags: FINDER_FLAG }),
  );
  let head = Buffer.concat([Buffer.from("EDXFND01", "latin1"), Buffer.alloc(8), meta]);
  head.writeUInt32LE(1, 8);
  head.writeUInt32LE(meta.length, 12);
  head = Buffer.concat([head, Buffer.alloc((8 - (head.length % 8)) % 8)]);
  const count = Buffer.alloc(8);
  count.writeUInt32LE(blocks.length, 0);
  const table = Buffer.alloc(24 * blocks.length);
  let off = head.length + 8 + table.length;
  blocks.forEach((b, i) => {
    table.writeInt16LE(b.bx, i * 24);
    table.writeInt16LE(b.by, i * 24 + 2);
    table.writeInt16LE(b.bz, i * 24 + 4);
    table.writeUInt32LE(b.n, i * 24 + 8);
    table.writeUInt32LE(b.comp.length, i * 24 + 12);
    table.writeBigUInt64LE(BigInt(off), i * 24 + 16);
    off += b.comp.length;
  });
  writeFileSync(file, Buffer.concat([head, count, table, ...blocks.map((b) => b.comp)]));
}
