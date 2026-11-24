/**
 * The arrival star a system's address predicts (src/shared/stellarClass.ts, src/server/boxelStars.ts; owner,
 * 2026-11-24: step E of docs/plan-24112026-star-predictor.md). The golden file holds real Spansh systems with the
 * stars they really have, and the values a second implementation of the rule (Python,
 * docs/perf/ggg-study-23112026/forge_golden3.py) gives for them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { MassCode } from "../src/shared/boxelAdvice.js";
import { boxelFrame, predictBoxelPlacement } from "../src/shared/stellarPlacement.js";
import {
  boxelTemperatureFactor,
  MAIN_SEQUENCE,
  mainSequenceClassAt,
  predictArrivalStar,
  STAR_CLASS_SHARE,
  STAR_CLASS_SURE,
  starClassKnown,
  temperatureWitness,
  type ArrivalStarScan,
} from "../src/shared/stellarClass.js";
import { boxelArrivalScans, boxelStarSet } from "../src/server/boxelStars.js";
import { setBoxelLookupSource, setBoxelSectorSource } from "../src/server/boxelPositions.js";
import type { BoxelLookupRecord } from "../src/server/boxelLookup.js";

interface Star {
  name: string;
  address: string;
  n: number;
  after: number;
  temperature: number;
  cls: string;
  solarMasses: number;
  real: ArrivalStarScan;
}
interface BoxelStar {
  address: string;
  n: number;
  after: number;
  cls: string;
  sharpened?: string;
  real: ArrivalStarScan;
  alive: boolean;
  calm: boolean;
}
const golden = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "stellar-class-golden.json"), "utf8")) as {
  stars: Record<string, Star[]>;
  boxels: { kind: "low" | "plain"; base: string; factor: number; wrongAsRuleStands: number; fixedByFactor: number; systems: BoxelStar[] }[];
};
const codes = Object.keys(golden.stars) as MassCode[];
const alive = (s: Star) =>
  (MAIN_SEQUENCE as readonly string[]).includes(s.real.starType) &&
  Math.round(s.real.stellarMass * 256) === Math.round(s.solarMasses * 256);
const boxelOf = (kind: "low" | "plain") => golden.boxels.find((b) => b.kind === kind)!;

describe("the arrival star from the system's address", () => {
  it("knows mass codes b to e, and the class limits to the kelvin", () => {
    expect(codes).toEqual(["b", "c", "d", "e"]);
    expect((["a", "b", "c", "d", "e", "f", "g", "h"] as const).filter(starClassKnown)).toEqual(["b", "c", "d", "e"]);
    const at = (k: number) => mainSequenceClassAt(k);
    expect([at(2000), at(3699.9), at(3700), at(5199), at(5200), at(5999), at(6000)]).toEqual(["M", "M", "K", "K", "G", "G", "F"]);
    expect([at(7499), at(7500), at(9999), at(10000), at(32999), at(33000), at(60000)]).toEqual(["F", "A", "A", "B", "B", "O", "O"]);
    expect(predictArrivalStar(1n, "a", 10)).toBeNull();
    expect(predictArrivalStar(1n, "d", -1)).toBeNull();
  });

  for (const code of codes) {
    it(`gives mass code ${code} the temperature, mass and class the reference does`, () => {
      for (const s of golden.stars[code]!) {
        expect(predictArrivalStar(BigInt(s.address), code, s.after), s.name).toEqual({
          cls: s.cls,
          temperature: s.temperature,
          solarMasses: s.solarMasses,
        });
      }
    });
  }

  it("names the class the real star has, for the stars still on the main sequence", () => {
    const tally = codes.map((code) => {
      const living = golden.stars[code]!.filter(alive);
      return [code, living.filter((s) => s.cls === s.real.starType).length, living.length, golden.stars[code]!.length];
    });
    // Right, living, all: the rest of "all" are dead stars, T Tauri stars and brown dwarfs.
    expect(tally).toEqual([
      ["b", 45, 46, 48],
      ["c", 42, 48, 48],
      ["d", 37, 38, 48],
      ["e", 43, 45, 48],
    ]);
  });

  it("finds where the dice stand from the boxel's placement alone, no position given", () => {
    let same = 0;
    let all = 0;
    for (const code of codes) {
      for (const s of golden.stars[code]!) {
        const placed = predictBoxelPlacement(boxelFrame(s.address)!, s.n, undefined, "normal")!;
        all++;
        if (placed.after.get(s.n) === s.after) same++;
        expect(placed.positions.size).toBe(s.n + 1);
      }
    }
    expect(all).toBe(192);
    expect(same).toBeGreaterThanOrEqual(190);
  });
});

describe("a boxel's own temperature factor", () => {
  const low = boxelOf("low");
  const frame = boxelFrame(low.base)!;
  const witnessOf = (s: BoxelStar) => temperatureWitness(BigInt(s.address), frame.code, s.after, s.real);

  it("is one number for the whole boxel: every calm star shows the same", () => {
    const ratios = low.systems.filter((s) => s.alive && s.calm).map((s) => witnessOf(s)!.ratio);
    expect(ratios.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.004);
    expect(boxelTemperatureFactor(ratios.map((ratio) => ({ ratio, calm: true })))).toBeCloseTo(low.factor, 6);
    expect(low.factor).toBeLessThan(0.986);
  });

  it("read off one scanned star, puts right the classes the rule alone gets wrong", () => {
    const living = low.systems.filter((s) => s.alive);
    const first = living.find((s) => s.calm)!;
    const factor = boxelTemperatureFactor([witnessOf(first)!])!;
    const right = (f: number) =>
      living.filter((s) => predictArrivalStar(BigInt(s.address), frame.code, s.after, f)!.cls === s.real.starType).length;
    expect(living.length - right(1)).toBe(low.wrongAsRuleStands);
    expect(right(factor) - right(1)).toBe(low.fixedByFactor);
    expect(low.fixedByFactor).toBeGreaterThanOrEqual(2);
    for (const s of living) expect(predictArrivalStar(BigInt(s.address), frame.code, s.after, low.factor)!.cls).toBe(s.sharpened);
  });

  it("leaves a boxel that sits on the rule as it was", () => {
    const plain = boxelOf("plain");
    const f = boxelFrame(plain.base)!;
    const living = plain.systems.filter((s) => s.alive);
    expect(Math.abs(plain.factor - 1)).toBeLessThan(0.004);
    expect(plain.wrongAsRuleStands).toBe(0);
    for (const s of living)
      expect(predictArrivalStar(BigInt(s.address), f.code, s.after, plain.factor)!.cls).toBe(s.real.starType);
  });

  it("takes no witness from a star that is not what it was born as, nor from a ratio out of the window", () => {
    const s = low.systems.find((x) => x.alive && x.calm)!;
    const ask = (scan: Partial<ArrivalStarScan>, code: MassCode = frame.code) =>
      temperatureWitness(BigInt(s.address), code, s.after, { ...s.real, ...scan });
    expect(ask({})).not.toBeNull();
    expect(ask({ starType: "N" })).toBeNull();
    expect(ask({ starType: "TTS" })).toBeNull();
    expect(ask({ stellarMass: s.real.stellarMass + 0.1 })).toBeNull();
    expect(ask({ temperature: s.real.temperature * 0.93 })).toBeNull();
    expect(ask({ temperature: s.real.temperature * 1.06 })).toBeNull();
    // Mass code e: the factor brings nothing there, so no star of it is asked.
    expect(STAR_CLASS_SHARE.e!.sharpened).toBeNull();
    expect(ask({}, "e")).toBeNull();
  });

  it("asks the calm stars first, and takes the middle one", () => {
    expect(boxelTemperatureFactor([])).toBeNull();
    expect(boxelTemperatureFactor([{ ratio: 0.98, calm: false }])).toBe(0.98);
    expect(
      boxelTemperatureFactor([
        { ratio: 1.01, calm: false },
        { ratio: 0.98, calm: true },
        { ratio: 0.981, calm: true },
        { ratio: 0.979, calm: true },
      ]),
    ).toBe(0.98);
    expect(boxelTemperatureFactor([{ ratio: 0.98, calm: true }, { ratio: 1, calm: true }])).toBeCloseTo(0.99, 12);
  });
});

describe("a boxel's predicted stars for the table and the order", () => {
  const low = boxelOf("low");
  const prefix = "Test Sector AA-A d1-";
  const living = low.systems.filter((s) => s.alive);
  const highest = Math.max(...low.systems.map((s) => s.n));
  // The boxel's place comes from one of its systems' addresses, as a look-up gives it; far from the centre, so its
  // kind needs no position.
  const looked = (address: string | null) =>
    setBoxelLookupSource(() =>
      address ? ({ systems: { 0: { id64: Number(address) } } } as unknown as BoxelLookupRecord) : null,
    );

  beforeEach(() => {
    setBoxelSectorSource(null);
    looked(low.systems[0]!.address);
  });

  it("gives every number a class, marked likely for mass code d while no star of the boxel is scanned", () => {
    const set = boxelStarSet(prefix, highest, null, new Map())!;
    expect(set.witnesses).toBe(0);
    expect(set.stars.size).toBe(highest + 1);
    for (const s of low.systems) expect(set.stars.get(s.n)!.cls, `-${s.n}`).toBe(s.cls);
    expect(set.stars.get(0)).toEqual({ cls: set.stars.get(0)!.cls, right: 0.94, alive: 0.8, likely: true });
    expect(STAR_CLASS_SHARE.d!.right).toBeLessThan(STAR_CLASS_SURE);
  });

  it("is sharpened by his scans of the boxel's arrival stars", () => {
    const scans = new Map(living.filter((s) => s.calm).slice(0, 3).map((s) => [s.n, s.real] as const));
    const set = boxelStarSet(prefix, highest, null, scans)!;
    expect(set.witnesses).toBe(3);
    for (const s of living) expect(set.stars.get(s.n)!.cls, `-${s.n}`).toBe(s.sharpened);
    expect(set.stars.get(0)).toEqual({ cls: set.stars.get(0)!.cls, right: 0.978, alive: 0.8, sharpened: true });
    // A dead star's scan says nothing about the boxel.
    const dead = boxelStarSet(prefix, highest, null, new Map([[living[0]!.n, { ...living[0]!.real, starType: "N" }]]))!;
    expect(dead.witnesses).toBe(0);
    expect(dead.stars.get(0)!.likely).toBe(true);
  });

  it("predicts nothing where the boxel cannot be placed", () => {
    looked(null);
    expect(boxelStarSet(prefix, highest, null, new Map())).toBeNull();
    // Mass code g is placed, but its stars have no rule.
    setBoxelSectorSource((s) => (s === "Wregoe" ? [39, 32, 18] : null));
    expect(boxelStarSet("Wregoe AA-A g", 5, null, new Map())).toBeNull();
    expect(boxelStarSet("Wregoe AA-A c", 5, null, new Map())!.stars.get(3)).toMatchObject({ right: 0.964, alive: 0.99 });
    expect(boxelStarSet("Wregoe AA-A c", 5, null, new Map())!.stars.get(3)!.likely).toBeUndefined();
  });

  it("collects his arrival scans by the boxel's system numbers", () => {
    const scan = { starType: "F", stellarMass: 1.2, temperature: 6500 };
    const scans = boxelArrivalScans(
      prefix,
      [[11, `${prefix}4`], [12, `${prefix}9`], [13, "Sol"], `${prefix}5`, [14, "Other AA-A d1-4"]],
      (addr) => (addr === 12 ? null : scan),
    );
    expect([...scans]).toEqual([[4, scan]]);
  });
});
