import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseInaraBuyResultsHtml } from "../../src/shared/colonize/inaraScrapeParse";

/** Captured Inara buy-results markup. Kept in-tree so the test runs from a fresh clone. */
const dumpPath = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/inara-buy-results.html");

describe("parseInaraBuyResultsHtml", () => {
  it("reads Inara DataTables location cells (station | system)", () => {
    const html = readFileSync(dumpPath, "utf8");
    const stations = parseInaraBuyResultsHtml(html);
    expect(stations.length).toBeGreaterThan(10);
    const first = stations[0]!;
    expect(first.stationName).toBe("Broot's Prospect");
    expect(first.systemName).toBe("Swoilz BY-D c1-13");
    expect(first.distanceLy).toBeCloseTo(14.710056771385, 5);
    expect(first.supply).toBe(1382768);
    expect(first.buyPrice).toBe(1086);
    expect(first.pad).toBe("L");
    expect(first.styleType).toBe("Surface Port");
    expect(first.stationType).toBe("Surface Port");
    expect(first.isGround).toBe(true);
    expect(first.isPlanetaryOrGround).toBe(true);
    expect(first.spriteX).toBe(182);
    expect(first.isFleetCarrier).toBe(false);
    expect(first.marketUpdatedAt).toMatch(/days ago/i);
  });
});
