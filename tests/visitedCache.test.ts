/**
 * The game's own visited list (plan 6.1, owner 2026-10-13): VisitedStarsCache.dat read, imported into the app's
 * folder, and its systems the journals lack added to the galaxy map's own systems (placed by the galaxy index, or
 * at their boxel's centre from the address).
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { id64Boxel, massCodeOfSystem } from "../src/shared/id64.js";
import {
  clearVisitedImportCache,
  findVisitedCacheFiles,
  importVisitedCache,
  importedSystems,
  loadVisitedImport,
  parseVisitedCache,
  removeVisitedImport,
  type VisitedImport,
} from "../src/server/visitedCache.js";
import { MINE_IMPORTED, MINE_VISITED, mySystemsDto } from "../src/server/galaxyMine.js";
import { GameStateStore } from "../src/server/gameState.js";
import type { BioIndex } from "../src/server/bioIndex.js";

const SOL = 10477373803n;
const COLONIA = 3238296097059n;
const SGR_A = 20578934n;

/** The game's layout: "VisitedStars", count at 0x18, record size at 0x1C, 16-byte records, a footer. */
function cacheFile(ids: bigint[], size = 16): Buffer {
  const head = Buffer.alloc(0x30);
  head.write("VisitedStars", 0, "latin1");
  head.writeUInt32LE(0xc8, 0x10);
  head.writeUInt32LE(ids.length, 0x18);
  head.writeUInt32LE(size, 0x1c);
  const body = Buffer.alloc(ids.length * size);
  ids.forEach((id, i) => {
    body.writeBigUInt64LE(id, i * size);
    body.writeUInt32LE(1, i * size + 8);
    body.writeUInt32LE(155502, i * size + 12);
  });
  return Buffer.concat([head, body, Buffer.from([0xde, 0xc0, 0xfe, 0x5a])]);
}

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "edexo-visited-"));
  dirs.push(d);
  return d;
}
afterEach(() => clearVisitedImportCache());

describe("id64: where an address puts a system", () => {
  it("puts Sol, Colonia and Sagittarius A* in their boxels", () => {
    for (const [id, real] of [
      [SOL, { x: 0, y: 0, z: 0 }],
      [COLONIA, { x: -9530.5, y: -910.28, z: 19808.13 }],
      [SGR_A, { x: 25.22, y: -20.91, z: 25899.97 }],
    ] as const) {
      const b = id64Boxel(id)!;
      const d = Math.hypot(b.center.x - real.x, b.center.y - real.y, b.center.z - real.z);
      expect(d, String(id)).toBeLessThanOrEqual((b.cubeLy * Math.sqrt(3)) / 2);
    }
    expect(id64Boxel(COLONIA)!.code).toBe("d");
    expect(id64Boxel("not a number")).toBeNull();
    expect(id64Boxel(-1n)).toBeNull();
  });
});

describe("a system's mass code", () => {
  it("from a procedural name, else from an exact address, never from a rounded one", () => {
    expect(massCodeOfSystem(null, "Swoilz KI-E b4-9")).toBe("b");
    expect(massCodeOfSystem(Number(COLONIA), "Colonia")).toBe("d");
    expect(massCodeOfSystem(Number(SGR_A), "Sagittarius A*")).toBe("g");
    expect(massCodeOfSystem(2 ** 53 + 2, "Somewhere")).toBeNull();
    expect(massCodeOfSystem(null, "Sol")).toBeNull();
  });
});

describe("VisitedStarsCache.dat", () => {
  it("reads the addresses, and refuses a wrong magic or a count past the end", () => {
    expect(parseVisitedCache(cacheFile([SOL, COLONIA]))).toEqual([SOL, COLONIA]);
    const wrong = cacheFile([SOL]);
    wrong.write("NotVisited!!", 0, "latin1");
    expect(() => parseVisitedCache(wrong)).toThrow(/not a VisitedStarsCache/);
    const over = cacheFile([SOL]);
    over.writeUInt32LE(9999, 0x18);
    expect(() => parseVisitedCache(over)).toThrow(/past the end/);
    const small = cacheFile([SOL]);
    small.writeUInt32LE(4, 0x1c);
    expect(() => parseVisitedCache(small)).toThrow(/record size/);
  });

  it("finds each account's file, counts what the journals lack, and imports and removes one", () => {
    const root = tmp();
    mkdirSync(path.join(root, "4783286"));
    writeFileSync(path.join(root, "4783286", "VisitedStarsCache.dat"), cacheFile([SOL, COLONIA, SGR_A]));
    mkdirSync(path.join(root, "Options"));
    mkdirSync(path.join(root, "123"));
    writeFileSync(path.join(root, "123", "VisitedStarsCache.dat"), Buffer.from("rubbish"));
    const files = findVisitedCacheFiles(root, new Set([Number(SOL)]));
    expect(files.map((f) => [f.account, f.systems, f.notInJournals])).toEqual([["4783286", 3, 2]]);

    const store = path.join(tmp(), "edexo-visited-cache.json");
    expect(() => importVisitedCache(root, "../etc", store)).toThrow(/not an account/);
    expect(() => importVisitedCache(root, "999", store)).toThrow(/no VisitedStarsCache/);
    const imp = importVisitedCache(root, "4783286", store, new Date("2026-10-13T00:00:00Z"));
    expect(imp.ids).toEqual([SOL, COLONIA, SGR_A].map(String));
    clearVisitedImportCache();
    expect(loadVisitedImport(store)?.ids).toHaveLength(3);
    expect(removeVisitedImport(store)).toBe(true);
    expect(existsSync(store)).toBe(false);
    expect(loadVisitedImport(store)).toBeNull();
  });
});

describe("the imported systems on the galaxy map", () => {
  const imp: VisitedImport = {
    version: 1,
    account: "1",
    importedAt: "",
    fileModifiedAt: "",
    ids: [SOL, COLONIA, SGR_A].map(String),
  };

  it("leaves out what the journals have, takes the galaxy index's place and name, else the boxel's centre", () => {
    const index = {
      lookup: (id: bigint) =>
        id === COLONIA ? { id64: id, name: "Colonia", x: -9530.5, y: -910.28, z: 19808.13 } : null,
    } as unknown as BioIndex;
    const out = importedSystems(imp, new Set([Number(SOL)]), index);
    expect(out.map((s) => s.addr)).toEqual([Number(COLONIA), Number(SGR_A)]);
    expect(out[0]).toMatchObject({ name: "Colonia", x: -9530.5, exact: true });
    expect(out[1]!.name).toBe("");
    expect(out[1]!.exact).toBe(false);
    // Sagittarius A* is a g-boxel system (640 ly cubes): within the cube's half-diagonal of the centre.
    const b = id64Boxel(SGR_A)!;
    expect(b.code).toBe("g");
    expect(Math.hypot(out[1]!.x - 25.22, out[1]!.y + 20.91, out[1]!.z - 25899.97)).toBeLessThanOrEqual(
      (b.cubeLy * Math.sqrt(3)) / 2,
    );
  });

  it("adds them to the commander's systems, marked, without doubling a journal one", () => {
    const store = new GameStateStore();
    store.apply({
      timestamp: "2026-10-01T00:00:00Z",
      event: "FSDJump",
      StarSystem: "Sol",
      SystemAddress: Number(SOL),
      StarPos: [0, 0, 0],
      JumpDist: 5,
      FuelUsed: 1,
      FuelLevel: 10,
    });
    const known = new Set([...store.visitedSystems.keys(), ...store.systemPositions.keys()]);
    const dto = mySystemsDto(store, { systems: [] } as never, importedSystems(imp, known, null));
    expect(dto.systems.filter((s) => s.addr === Number(SOL))).toHaveLength(1);
    const added = dto.systems.filter((s) => s.flags & MINE_IMPORTED);
    expect(added).toHaveLength(2);
    for (const s of added) expect(s.flags & MINE_VISITED).toBeTruthy();
  });
});
