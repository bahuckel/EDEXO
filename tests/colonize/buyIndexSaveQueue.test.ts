/**
 * One failed save of the material buy index does not stop the later ones (review 2026-11-07: the queue was a promise
 * chain with no catch, so a rejected write skipped every later save until a restart).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const writes: unknown[] = [];
let failNext = false;
vi.mock("../../src/server/colonize/jsonFs", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/colonize/jsonFs")>();
  return {
    ...real,
    writeJsonAtomic: async (file: string, data: unknown) => {
      if (failNext) {
        failNext = false;
        throw new Error("EBUSY: the file is held");
      }
      writes.push(JSON.parse(JSON.stringify(data)));
      void file;
    },
  };
});

const { MaterialBuyIndex } = await import("../../src/server/colonize/materialBuyIndex");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const hit = (stationName: string) => ({
  systemName: "Sol",
  stationName,
  marketId: "",
  distanceLy: 10,
  buyPrice: 100,
  supply: 50,
  spanshCommodity: "Steel",
  dataSource: "spansh" as const,
  foundAtIso: "2026-11-07T00:00:00.000Z",
});

describe("material buy index saves", () => {
  it("go on after one fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edexo-buyq-"));
    dirs.push(dir);
    const idx = new MaterialBuyIndex(dir);
    await idx.load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    failNext = true;
    idx.mergeStations("Sol", "steel", "Steel", [hit("A")]);
    await idx.flush();
    expect(writes.length).toBe(0);
    expect(warn).toHaveBeenCalled();
    idx.mergeStations("Sol", "steel", "Steel", [hit("B")]);
    await idx.flush();
    expect(writes.length).toBe(1);
    warn.mockRestore();
  });
});
