/**
 * Spansh for a whole-galaxy hunt's nearest boxels (server/galaxyHuntLookups.ts, plan-1.4.0 §6.2; owner 2026-11-24:
 * "nearest 20, cached", already found "rank lower, show"): the queue, what a look-up says of the target, and the
 * hunt scored with it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import type { BoxelLookupRecord, BoxelLookupService, LookupSystemFacts } from "../src/server/boxelLookup.js";
import {
  HUNT_LOOKUPS,
  huntLookupState,
  knownTargetsIn,
  queueHuntLookups,
  setGalaxyHuntLookupService,
} from "../src/server/galaxyHuntLookups.js";
import { systemPrefixOf } from "../src/server/expedition.js";
import { expeditionField, type ExpeditionDeps } from "../src/server/expeditionService.js";
import { loadRegionMap } from "../src/server/regionMapData.js";
import { loadPriceList } from "../src/server/priceList.js";
import { buildEncyclopediaPayload, getCachedSpeciesDatabase } from "../src/server/snapshot.js";

const root = path.resolve(__dirname, "..");

const sys = (mainStar: string, bodyTypes: string[] = [], helium = false): LookupSystemFacts => ({
  mainStar,
  otherStars: [],
  starClasses: [],
  bodyCount: 1,
  notables: helium ? [{ kind: "helium", n: 1 }] : [],
  bodyTypes,
  species: [],
});
const record = (prefix: string, systems: LookupSystemFacts[]): BoxelLookupRecord => ({
  prefix,
  fetchedAt: "2026-11-24T00:00:00.000Z",
  complete: true,
  systems: Object.fromEntries(systems.map((s, i) => [String(i), s])),
});

/** A look-up service that finishes each look-up at once and remembers the order. */
function fakeService(records: Map<string, BoxelLookupRecord>): BoxelLookupService & { started: string[] } {
  const started: string[] = [];
  return {
    started,
    get: (p) => records.get(p) ?? null,
    status: () => null,
    start(p) {
      started.push(p);
      records.set(p, record(p, [sys("K")]));
      return true;
    },
    stop() {},
  };
}

afterEach(() => {
  setGalaxyHuntLookupService(null);
  vi.useRealTimers();
});

describe("what a look-up says of the target", () => {
  const r = record("X AA-A h", [sys("Wolf-Rayet O"), sys("Wolf-Rayet C"), sys("O"), sys("M giant"), sys("M", ["elw"], true)]);
  it("counts main stars, a family by its name, a single class exactly", () => {
    expect(knownTargetsIn(r, { kind: "star", star: "Wolf-Rayet O Star" })).toBe(1);
    expect(knownTargetsIn(r, { kind: "star", star: "Wolf-Rayet" })).toBe(2);
    expect(knownTargetsIn(r, { kind: "star", star: "O (Blue-White) Star" })).toBe(1);
    expect(knownTargetsIn(r, { kind: "star", star: "M (Red dwarf) Star" })).toBe(1);
    expect(knownTargetsIn(r, { kind: "star", star: "M (Red giant) Star" })).toBe(1);
  });
  it("counts the planets it can tell, and says nothing of the rest", () => {
    expect(knownTargetsIn(r, { kind: "body", body: "elw" })).toBe(1);
    expect(knownTargetsIn(r, { kind: "body", body: "hrgg" })).toBe(1);
    expect(knownTargetsIn(r, { kind: "body", body: "gg" })).toBeNull();
    expect(knownTargetsIn(r, { kind: "value", minM: 10 })).toBeNull();
  });
});

describe("the queue", () => {
  it("looks up the nearest 20 not yet looked up, one at a time, and leaves the same hunt asked again be", async () => {
    vi.useFakeTimers();
    const records = new Map([["B1 h", record("B1 h", [sys("K")])]]);
    const svc = fakeService(records);
    setGalaxyHuntLookupService(svc);
    const prefixes = Array.from({ length: 30 }, (_, i) => `B${i} h`);
    queueHuntLookups(prefixes);
    queueHuntLookups(prefixes);
    await vi.runAllTimersAsync();
    expect(svc.started).toHaveLength(HUNT_LOOKUPS - 1);
    expect(svc.started[0]).toBe("B0 h");
    expect(svc.started).not.toContain("B1 h");
    expect(huntLookupState()).toEqual({ queued: 0, done: HUNT_LOOKUPS - 1 });
  });
});

describe("the hunt scored with a look-up", () => {
  function deps(): ExpeditionDeps {
    buildEncyclopediaPayload();
    return { root, index: null, prices: loadPriceList(root), species: getCachedSpeciesDatabase().species, regionMap: loadRegionMap(root), catalogue: null };
  }
  const WR = { kind: "star" as const, star: "Wolf-Rayet" };

  it("ranks a boxel lower by what is found there and keeps it in the list", async () => {
    const records = new Map<string, BoxelLookupRecord>();
    setGalaxyHuntLookupService(fakeService(records));
    const before = await expeditionField({ from: { x: 0, y: 0, z: 0 }, radiusLy: 0, jumpRangeLy: 70, target: WR, galaxy: true, limit: 500 }, deps());
    const top = before.boxels[0]!;
    // Spansh knows 10 of its systems, two with a Wolf-Rayet main star: fewer left, and two found already.
    const known = [...Array.from({ length: 8 }, () => sys("K")), sys("Wolf-Rayet O"), sys("Wolf-Rayet N")];
    records.set(systemPrefixOf(top.name!), record(systemPrefixOf(top.name!), known));
    const after = await expeditionField({ from: { x: 0, y: 0, z: 0 }, radiusLy: 0, jumpRangeLy: 71, target: WR, galaxy: true, limit: 500 }, deps());
    const again = after.boxels.find((b) => b.key === top.key)!;
    expect(again.spansh).toEqual({ known: 10, found: 2, fetchedAt: "2026-11-24T00:00:00.000Z" });
    expect(again.matches!).toBeLessThan(top.matches! - 2);
    expect(after.boxels.findIndex((b) => b.key === top.key)).toBeGreaterThan(0);
  });
});
