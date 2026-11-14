/**
 * The ranking model's answer as each candidate's chance of being on the body (presenceFloors.ts
 * attachPresenceProbability). The model's own numbers move with its tables, so what is pinned here is what must hold
 * whatever they are: the share times the signal count, a soft band's factor weighed in before sharing out, the measured
 * rate for a species that has one, the share within each genus, and the rows it must not touch. The mutation run of
 * 2026-11-14 (plan 2.5) found none of this tested: every operator in the function could change unnoticed.
 */
import { describe, expect, it } from "vitest";
import { attachPresenceProbability } from "../src/server/presenceFloors.js";
import { GameStateStore } from "../src/server/gameState.js";
import { getProjectRoot } from "../src/server/paths.js";
import { loadSpeciesDatabase } from "../src/server/speciesDb.js";
import type { BodyExoState, PlanetScan, SpeciesMatch } from "../src/shared/types.js";

const db = loadSpeciesDatabase();
const root = getProjectRoot();
const entry = (id: string) => {
  const e = db.species.find((s) => s.id === id);
  if (!e) throw new Error(`no species ${id}`);
  return e;
};

// An icy body in thin ammonia, 160 K: where Bacterium grows.
const scan = {
  BodyName: "Test 1 a",
  BodyID: 2,
  StarSystem: "Test",
  PlanetClass: "Icy body",
  Atmosphere: "thin ammonia atmosphere",
  AtmosphereType: "Ammonia",
  SurfaceTemperature: 160,
  SurfaceGravity: 0.12 * 9.81,
  SurfacePressure: 0.01 * 101325,
  Volcanism: "",
  Landable: true,
  MassEM: 0.01,
} as unknown as PlanetScan;

function body(signals: number | null, over: Partial<BodyExoState> = {}): BodyExoState {
  return {
    key: "1:2",
    bodyName: "Test 1 a",
    bodyId: 2,
    systemAddress: 1,
    starSystem: "Test",
    biologicalSignals: signals,
    genusHints: null,
    dssComplete: false,
    scan,
    organicGenusLocks: [],
    confirmedVariants: [],
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const IDS = ["bacterium_bacterium_acies", "bacterium_bacterium_alcyoneum", "bacterium_bacterium_bullaris", "bacterium_bacterium_cerbrus"];
const rows = (over: Record<string, Partial<SpeciesMatch>> = {}): SpeciesMatch[] =>
  IDS.map((id) => ({ entry: entry(id), reasons: [], presenceProbabilityPercent: null, ...over[id] }) as unknown as SpeciesMatch);

const run = (ms: SpeciesMatch[], b: BodyExoState, s: PlanetScan | null = scan) =>
  attachPresenceProbability(ms, b, s, null, null, root, new GameStateStore());

const pct = (ms: SpeciesMatch[]) => ms.map((m) => m.presenceProbabilityPercent);

describe("each candidate's chance of being on the body", () => {
  it("is the model's share times the signal count, to one decimal, never over 100", () => {
    const one = rows();
    run(one, body(1));
    const two = rows();
    run(two, body(2));
    for (const p of [...pct(one), ...pct(two)]) {
      expect(p).not.toBeNull();
      expect(p!).toBeGreaterThanOrEqual(0);
      expect(p!).toBeLessThanOrEqual(100);
      expect(Math.round(p! * 10)).toBeCloseTo(p! * 10, 6);
    }
    // One genus, one signal: the shares of the body's one species add up to the whole.
    expect(pct(one).reduce<number>((a, p) => a + p!, 0)).toBeCloseTo(100, 0);
    // A second signal raises every row, and none falls (the genus is capped at a whole signal).
    one.forEach((m, i) => expect(two[i]!.presenceProbabilityPercent!).toBeGreaterThanOrEqual(m.presenceProbabilityPercent!));
    expect(pct(two).some((p, i) => p! > pct(one)[i]!)).toBe(true);
  });

  it("reads an unknown, zero or broken signal count as one", () => {
    const one = rows();
    run(one, body(1));
    for (const s of [null, 0, -2, Number.NaN]) {
      const ms = rows();
      run(ms, body(s));
      expect([s, pct(ms)]).toEqual([s, pct(one)]);
    }
  });

  it("weighs a soft band's factor in before sharing out, the others keeping the same total", () => {
    const plain = rows();
    run(plain, body(1));
    const soft = rows({ bacterium_bacterium_acies: { presenceFactor: 0.02 } });
    run(soft, body(1));
    expect(soft[0]!.presenceProbabilityPercent!).toBeLessThan(plain[0]!.presenceProbabilityPercent!);
    expect(soft[1]!.presenceProbabilityPercent!).toBeGreaterThan(plain[1]!.presenceProbabilityPercent!);
    expect(pct(soft).reduce<number>((a, p) => a + p!, 0)).toBeCloseTo(100, 0);
    // The same factor shrinks its share of the genus too.
    expect(soft[0]!.genusSharePercent!).toBeLessThan(plain[0]!.genusSharePercent!);
  });

  it("gives each row its share of its own genus, the genus adding up to 100", () => {
    const ms = rows();
    run(ms, body(2));
    const shares = ms.map((m) => m.genusSharePercent);
    for (const s of shares) {
      expect(s).not.toBeNull();
      expect(Math.round(s! * 10)).toBeCloseTo(s! * 10, 6);
    }
    expect(shares.reduce<number>((a, s) => a + s!, 0)).toBeCloseTo(100, 0);
  });

  it("takes Crystalline Shards' measured rate over the ranking's, by the signal count", () => {
    const shards = (signals: number) => {
      const ms = [{ entry: entry("crystalline_shards_crystalline_shards"), reasons: [] } as unknown as SpeciesMatch, ...rows()];
      run(ms, body(signals));
      return ms[0]!.presenceProbabilityPercent;
    };
    expect(shards(1)).toBe(48.6);
    expect(shards(3)).toBe(6);
  });

  it("touches nothing without a scan, nor any row already behind the unlikely tier", () => {
    const none = rows({ bacterium_bacterium_acies: { presenceProbabilityPercent: 77 } });
    run(none, body(1), null);
    expect(pct(none)).toEqual([77, null, null, null]);
    const ms = rows({ bacterium_bacterium_acies: { unlikely: true, presenceProbabilityPercent: 77, genusSharePercent: 77 } });
    run(ms, body(1));
    expect(ms[0]!.presenceProbabilityPercent).toBe(77);
    expect(ms[0]!.genusSharePercent).toBe(77);
    // The other three share the body between them.
    expect(ms.slice(1).reduce<number>((a, m) => a + m.presenceProbabilityPercent!, 0)).toBeCloseTo(100, 0);
    // With every row demoted there is nothing to rank.
    const all = rows(Object.fromEntries(IDS.map((id) => [id, { unlikely: true }])));
    run(all, body(1));
    expect(pct(all)).toEqual([null, null, null, null]);
  });

  it("weighs in the body's own region when its system's place is known, from the journal or a Spansh lookup alike", () => {
    const none = rows();
    run(none, body(1));
    const at = (store: GameStateStore) => {
      const ms = rows();
      attachPresenceProbability(ms, body(1), scan, null, null, root, store);
      return pct(ms);
    };
    const journal = new GameStateStore();
    journal.systemPositions.set(1, { x: 0, y: 0, z: 0 });
    const spansh = new GameStateStore();
    spansh.remoteSystems.set(1, { coords: { x: 0, y: 0, z: 0 } } as never);
    const outside = new GameStateStore();
    outside.systemPositions.set(1, { x: 900_000, y: 0, z: 900_000 });
    expect(at(journal)).not.toEqual(pct(none));
    expect(at(spansh)).toEqual(at(journal));
    // Off the region map: no region, as with no position.
    expect(at(outside)).toEqual(pct(none));
  });
});
