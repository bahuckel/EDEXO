/**
 * Carriers & Stations (R4): the auto refresh's schedule and settings, and Find Tritium's reading of Spansh's answers.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTO_REFRESH_DEFAULTS,
  dueNow,
  readAutoRefreshSettings,
  writeAutoRefreshSettings,
} from "../src/server/dataAutoRefresh.js";
import { tritiumRingsFrom, tritiumSellersFrom } from "../src/server/tritiumSearch.js";

const H = 3_600_000;

describe("auto refresh schedule", () => {
  const now = 1_000 * H;
  it("refreshes only data fetched once, once its interval has passed", () => {
    const s = { ...AUTO_REFRESH_DEFAULTS };
    // Never fetched: the first download stays a button press.
    expect(dueNow(s, { haveData: false, fetchedAtMs: null }, { present: false, fileMs: null }, now)).toEqual({
      carriers: false,
      stations: false,
    });
    // Carriers 11 h old, stations file 23 h old: neither yet.
    expect(
      dueNow(s, { haveData: true, fetchedAtMs: now - 11 * H }, { present: true, fileMs: now - 23 * H }, now),
    ).toEqual({ carriers: false, stations: false });
    // 12 h and 24 h: both.
    expect(
      dueNow(s, { haveData: true, fetchedAtMs: now - 12 * H }, { present: true, fileMs: now - 24 * H }, now),
    ).toEqual({ carriers: true, stations: true });
  });

  it("counts stations from the last check, not the file, once it has checked; off is never", () => {
    const s = { carriersHours: 0 as const, stationsHours: 24 as const, stationsCheckedAtMs: now - 2 * H };
    expect(
      dueNow(s, { haveData: true, fetchedAtMs: now - 500 * H }, { present: true, fileMs: now - 300 * H }, now),
    ).toEqual({ carriers: false, stations: false });
  });

  describe("settings", () => {
    const saved = process.env.EDEXO_USER_DATA_DIR;
    let dir = "";
    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), "edexo-r4-"));
      process.env.EDEXO_USER_DATA_DIR = dir;
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
      if (saved === undefined) delete process.env.EDEXO_USER_DATA_DIR;
      else process.env.EDEXO_USER_DATA_DIR = saved;
    });

    it("defaults to 12 h and 24 h, keeps an offered value and ignores the rest", () => {
      expect(readAutoRefreshSettings()).toEqual({ carriersHours: 12, stationsHours: 24 });
      expect(writeAutoRefreshSettings({ carriersHours: 6 })).toEqual({ carriersHours: 6, stationsHours: 24 });
      expect(writeAutoRefreshSettings({ stationsHours: 7, carriersHours: "0" })).toEqual({
        carriersHours: 0,
        stationsHours: 24,
      });
      expect(readAutoRefreshSettings()).toEqual({ carriersHours: 0, stationsHours: 24 });
    });
  });
});

describe("Find Tritium", () => {
  // Shaped like Spansh's answers of 2026-10-23 (bodies/search ring_signals, stations/search market), trimmed.
  const bodies = {
    results: [
      {
        name: "Barnard's Star 5",
        system_name: "Barnard's Star",
        distance: 5.95,
        distance_to_arrival: 1200.5,
        system_x: -3.03,
        system_y: 1.38,
        system_z: 4.94,
        rings: [
          { name: "Barnard's Star 5 A Ring", type: "Metal Rich", signals: [{ count: 2, name: "Painite" }] },
          { name: "Barnard's Star 5 B Ring", type: "Icy", signals: [{ count: 1, name: "Tritium" }] },
        ],
      },
      {
        name: "Barnard's Star 6",
        system_name: "Barnard's Star",
        distance: 5.95,
        rings: [{ name: "Barnard's Star 6 B Ring", type: "Icy", signals: [{ count: 3, name: "Tritium" }] }],
      },
    ],
  };
  const stations = {
    results: [
      {
        name: "Galileo",
        system_name: "Sol",
        type: "Ocellus Starport",
        distance: 0,
        distance_to_arrival: 505.5,
        large_pads: 6,
        market_updated_at: "2026-10-20T21:56:58Z",
        market: [{ commodity: "Tritium", supply: 355413, buy_price: 50137 }],
        system_x: 0,
        system_y: 0,
        system_z: 0,
      },
      { name: "Empty", system_name: "Sol", type: "Outpost", market: [{ commodity: "Tritium", supply: 0 }] },
      {
        name: "XFK-T4Q",
        system_name: "Luhman 16",
        type: "Drake-Class Carrier",
        distance: 6.6,
        has_large_pad: true,
        market: [{ commodity: "Tritium", supply: 617, buy_price: 2586 }],
      },
    ],
  };

  it("lists every ring with a Tritium hotspot, with its count, nearest first", () => {
    const rings = tritiumRingsFrom(bodies);
    expect(rings.map((r) => [r.ring, r.ringType, r.hotspots])).toEqual([
      ["Barnard's Star 5 B Ring", "Icy", 1],
      ["Barnard's Star 6 B Ring", "Icy", 3],
    ]);
    expect(rings[0]).toMatchObject({ system: "Barnard's Star", distanceLs: 1200.5, x: -3.03 });
    expect(tritiumRingsFrom(bodies, 1)).toHaveLength(1);
  });

  it("lists sellers with stock, marks carriers, reads the pad", () => {
    const sellers = tritiumSellersFrom(stations);
    expect(sellers.map((s) => [s.station, s.carrier, s.pad, s.supply, s.price])).toEqual([
      ["Galileo", false, "L", 355413, 50137],
      ["XFK-T4Q", true, "L", 617, 2586],
    ]);
    expect(tritiumSellersFrom({})).toEqual([]);
  });
});
