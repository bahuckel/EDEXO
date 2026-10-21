import { describe, expect, it } from "vitest";
import { parseInaraImportFile } from "../../src/shared/colonize/inaraImportTypes";

describe("parseInaraImportFile", () => {
  it("accepts a valid scrape dump", () => {
    const doc = parseInaraImportFile({
      version: 1,
      source: "inara",
      scrapedAt: "2026-08-26T00:00:00.000Z",
      nearSystem: "Sol",
      commodityLabel: "Titanium",
      stations: [
        { systemName: "LHS 20", stationName: "Miller Terminal", distanceLy: 12.4, supply: 9000, buyPrice: 4100 },
      ],
    });
    expect(doc?.nearSystem).toBe("Sol");
    expect(doc?.stations).toHaveLength(1);
    expect(doc?.stations[0]?.stationName).toBe("Miller Terminal");
  });

  it("maps styleType and isGround from sprite scrape fields", () => {
    const doc = parseInaraImportFile({
      version: 1,
      source: "inara",
      scrapedAt: "2026-08-26T00:00:00.000Z",
      nearSystem: "Sol",
      commodityLabel: "Steel",
      stations: [
        {
          systemName: "Sol",
          stationName: "Broot's Prospect",
          distanceLy: 14.7,
          supply: 10,
          buyPrice: 1000,
          styleType: "Surface Port",
          isGround: true,
          spriteX: 182,
        },
      ],
    });
    expect(doc?.stations[0]?.styleType).toBe("Surface Port");
    expect(doc?.stations[0]?.isGround).toBe(true);
    expect(doc?.stations[0]?.isPlanetaryOrGround).toBe(true);
  });

  it("rejects non-inara payloads", () => {
    expect(parseInaraImportFile({ version: 1, source: "spansh", nearSystem: "Sol", commodityLabel: "Steel", stations: [] })).toBeNull();
  });
});
