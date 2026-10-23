/**
 * What holding the EDAstro files costs (audit 2026-10-22).
 *
 * Options > Notify asks only whether the carrier and POI files are here, and the status used to count their rows,
 * which parses the 21 MB carrier file and keeps it for the session. The count is now worked out when it is read.
 * And the parsed carriers share one services list per distinct cell and one string per region: an array of fresh
 * strings for each of 91 k carriers was 110 MB of heap.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ files: [] as string[] }));
vi.mock("node:fs", async (orig) => {
  const real = await orig<typeof import("node:fs")>();
  return {
    ...real,
    readFileSync: ((...a: Parameters<typeof real.readFileSync>) => {
      reads.files.push(path.basename(String(a[0])));
      return real.readFileSync(...a);
    }) as typeof real.readFileSync,
  };
});

const { parseCarrierCsv, readCarrierStatus, resetCarrierMemo, resolveCarrierCachePath } = await import(
  "../src/server/edastroCarriers.js"
);
const { readPoiStatus, resetPoiMemo, resolvePoiCachePath } = await import("../src/server/edastroPoi.js");

const HEADER =
  "Callsign,Name,Owner,LastUpdated,LastMoved,LastSystem,SystemAddress,Coord_X,Coord_Y,Coord_Z," +
  "SolDistance,EstimatedRegion,LocationHistory,DockingsEDDN,Services";
const row = (callsign: string, region: string, services: string) =>
  `${callsign},,,"2026-09-20 00:00:00","2026-09-19 12:00:00",Sol,1,0,0,0,0,${region},1,0,"${services}"`;
const CSV = [
  HEADER,
  row("AAA-111", "Inner Orion Spur", "dock;refuel;vistagenomics"),
  row("BBB-222", "Inner Orion Spur", "dock;refuel;vistagenomics"),
  row("CCC-333", "Elysian Shore", "dock;exploration"),
  row("DDD-444", "Elysian Shore", ""),
].join("\n");
const POI = JSON.stringify([
  { id: 1, source: "GEC", type: "Organic", name: "Field", galMapSearch: "Sol", coordinates: [0, 0, 0] },
]);

let dir: string;
const saved = process.env.EDEXO_USER_DATA_DIR;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-edastro-lazy-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
  resetCarrierMemo();
  resetPoiMemo();
  writeFileSync(resolveCarrierCachePath(), CSV, "utf8");
  writeFileSync(resolvePoiCachePath(), POI, "utf8");
  reads.files.length = 0;
});
afterEach(() => {
  if (saved === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = saved;
  resetCarrierMemo();
  resetPoiMemo();
  rmSync(dir, { recursive: true, force: true });
});

describe("whether the EDAstro files are here", () => {
  it("is answered without reading either file", () => {
    expect(readCarrierStatus().haveData).toBe(true);
    expect(readPoiStatus().haveData).toBe(true);
    expect(reads.files).not.toContain("edexo-compare-carriers.csv");
    expect(reads.files).not.toContain("edexo-compare-poi.json");
  });

  it("still sends the row counts with the status", () => {
    expect(JSON.parse(JSON.stringify(readCarrierStatus())).rowCount).toBe(4);
    expect(JSON.parse(JSON.stringify(readPoiStatus())).rowCount).toBe(1);
    expect(reads.files).toContain("edexo-compare-carriers.csv");
  });

  it("counts nothing, and reads nothing, without a file", () => {
    rmSync(resolveCarrierCachePath());
    const st = readCarrierStatus();
    expect([st.haveData, st.rowCount]).toEqual([false, 0]);
    expect(reads.files).not.toContain("edexo-compare-carriers.csv");
  });
});

describe("the parsed carriers", () => {
  it("share one frozen services list per distinct cell, and keep their regions", () => {
    const [a, b, c, d] = parseCarrierCsv(CSV);
    expect(a!.services).toEqual(["dock", "refuel", "vistagenomics"]);
    expect(b!.services).toBe(a!.services);
    expect(c!.services).not.toBe(a!.services);
    expect(d!.services).toEqual([]);
    expect(Object.isFrozen(a!.services)).toBe(true);
    expect([a!.region, c!.region, d!.region]).toEqual(["Inner Orion Spur", "Elysian Shore", "Elysian Shore"]);
  });
});
