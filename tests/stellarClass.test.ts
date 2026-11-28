/**
 * The arrival star a system's address predicts (src/shared/stellarClass.ts, src/server/boxelStars.ts; owner,
 * 2026-11-24: step E of docs/plan-24112026-star-predictor.md). The golden file holds real Spansh systems with the
 * stars they really have, and the values a second implementation of the rule (Python,
 * docs/perf/ggg-study-23112026/forge_golden3.py) gives for them; and, for the stages a star goes through with age
 * (§3j of docs/boxel-star-placement-23112026.md), real systems of the EDDN year with their journal ages
 * (forge_golden4.py).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { MassCode } from "../src/shared/boxelAdvice.js";
import { boxelFrame, predictBoxelPlacement, systemRolls } from "../src/shared/stellarPlacement.js";
import {
  ageReading,
  boxelAgeWindowFrom,
  boxelReplacement,
  boxelTemperatureFactor,
  MAIN_SEQUENCE,
  mainSequenceClassAt,
  predictArrivalStar,
  replacedShare,
  replacementWitness,
  stageAt,
  STAR_CLASS_SHARE,
  STAR_CLASS_SURE,
  starClassKnown,
  systemAges,
  temperatureWitness,
  type AgeWindow,
  type ArrivalStarScan,
} from "../src/shared/stellarClass.js";
import { boxelArrivalScans, boxelStarCheck, boxelStarSet } from "../src/server/boxelStars.js";
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
/** A real system with its journal age, and what the reference makes of it (`stage` null: the bases disagree). */
interface AgedStar {
  address: string;
  n: number;
  after: number;
  path: "a" | "young" | "old";
  age: number;
  real: ArrivalStarScan;
  realStage: string;
  ages: number[];
  stage: string | null;
}
const golden = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "stellar-class-golden.json"), "utf8")) as {
  stars: Record<string, Star[]>;
  boxels: { kind: "low" | "plain"; base: string; factor: number; wrongAsRuleStands: number; fixedByFactor: number; systems: BoxelStar[] }[];
  replaced: Record<
    "near" | "far",
    {
      base: string;
      centre: [number, number, number];
      fromSol: number;
      systems: { address: string; n: number; after: number; birthMass: number; real: ArrivalStarScan; kind: "kept" | "replaced" | null }[];
    }
  >;
  aged: {
    boxels: { kind: "wide" | "disc"; base: string; baseAge: number; width: number; readings: { upper: number; roll: number }[]; systems: AgedStar[] }[];
    young: Record<"d" | "e", AgedStar[]>;
  };
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
    // Too cool for M: a brown dwarf of class L, still the star itself.
    expect([at(1500), at(1999.9)]).toEqual(["L", "L"]);
    expect([at(7499), at(7500), at(9999), at(10000), at(32999), at(33000), at(60000)]).toEqual(["F", "A", "A", "B", "B", "O", "O"]);
    expect(predictArrivalStar(1n, "a", 10)).toBeNull();
    expect(predictArrivalStar(1n, "d", -1)).toBeNull();
  });

  for (const code of codes) {
    it(`gives mass code ${code} the temperature, mass and class the reference does`, () => {
      for (const s of golden.stars[code]!) {
        expect(predictArrivalStar(BigInt(s.address), code, s.after), s.name).toMatchObject({
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

  it("calls a brown dwarf of mass code b by its class, where the temperature puts it under 2,000 K", () => {
    const dwarfs = golden.stars.b!.filter((s) => s.real.starType === "L");
    // Two real ones here: one predicted as such, one predicted 21 K over the limit (its boxel sits low, §3i).
    expect(dwarfs.map((s) => [predictArrivalStar(BigInt(s.address), "b", s.after)!.cls, s.temperature, s.real.temperature])).toEqual([
      ["M", 2021, 1953],
      ["L", 1969, 1965],
    ]);
    expect(golden.stars.b!.filter((s) => s.cls === "L" && s.real.starType !== "L")).toEqual([]);
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
    // Under 1.44 solar masses: the boxel's place (33,000 ly from Sol) adds no doubt of its own.
    const light = (s: BoxelStar) => s.alive && s.real.stellarMass < 1.44;
    const calm = low.systems.find((s) => s.calm && light(s))!.n;
    const young = low.systems.find((s) => !s.calm && light(s))!.n;
    // No scan, so no age: a calm system's star may be anything by now.
    expect(set.stars.get(calm)).toEqual({ cls: set.stars.get(calm)!.cls, right: 0.94, alive: 0.85, likely: true });
    // A young system's age is on its own dice: its star is still itself.
    expect(set.stars.get(young)).toEqual({ cls: set.stars.get(young)!.cls, right: 0.94, alive: 0.98, aged: "dice", likely: true });
    // From 1.44 solar masses up, one boxel in seventeen out there replaces the star by a small one.
    const heavy = low.systems.find((s) => s.calm && s.alive && s.real.stellarMass >= 1.45)!.n;
    expect(set.stars.get(heavy)!.alive).toBe(0.8);
    expect(set.replaced).toEqual({ heavy: null, light: null });
    expect(set.window).toBeNull();
    expect(STAR_CLASS_SHARE.d!.right).toBeLessThan(STAR_CLASS_SURE);
  });

  it("is sharpened by his scans of the boxel's arrival stars", () => {
    const scans = new Map(living.filter((s) => s.calm).slice(0, 3).map((s) => [s.n, s.real] as const));
    const set = boxelStarSet(prefix, highest, null, scans)!;
    expect(set.witnesses).toBe(3);
    for (const s of living) expect(set.stars.get(s.n)!.cls, `-${s.n}`).toBe(s.sharpened);
    // The scanned stars are themselves, so the boxel replaces none: one doubt less.
    const calm = low.systems.find((s) => s.calm && s.alive)!.n;
    expect(set.stars.get(calm)).toEqual({ cls: set.stars.get(calm)!.cls, right: 0.978, alive: 0.83, sharpened: true });
    // A dead star's scan says nothing about the boxel.
    const dead = boxelStarSet(prefix, highest, null, new Map([[living[0]!.n, { ...living[0]!.real, starType: "N" }]]))!;
    expect(dead.witnesses).toBe(0);
    expect(dead.stars.get(calm)!.likely).toBe(true);
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

describe("what the star is by now, from the system's age", () => {
  const aged = golden.aged;
  const wide = aged.boxels.find((b) => b.kind === "wide")!;
  const disc = aged.boxels.find((b) => b.kind === "disc")!;
  const windowOf = (b: (typeof aged.boxels)[number]): AgeWindow => ({ width: b.width, bases: [b.baseAge] });

  it("goes from itself to a small star, a giant and a dead star at fixed shares of the main sequence's length", () => {
    // One solar mass (256): the main sequence lasts 11,000 My, the giant phase 835.95 more.
    const at = (age: number, k = 256, code: MassCode = "d") => stageAt(code, k, age);
    expect([at(0), at(10449), at(10450), at(10999), at(11000), at(11835), at(11836)]).toEqual([
      "main",
      "main",
      "small",
      "small",
      "giant",
      "giant",
      "whiteDwarf",
    ]);
    // 1.44 solar masses and over: a neutron star. Mass code e: one dead star in nine is a black hole.
    expect([at(20000, 368), at(20000, 369), at(20000, 500, "e")]).toEqual(["whiteDwarf", "neutron", "collapsed"]);
  });

  it("reads a boxel's age window off its scanned path-A systems: the width, and the base once two read 128 My apart", () => {
    for (const b of [wide, disc]) {
      const readings = b.systems.map((s) => ageReading(BigInt(s.address), s.age));
      for (const [i, s] of b.systems.entries()) expect(readings[i] != null, `${b.kind} -${s.n}`).toBe(s.path === "a");
      expect(readings.filter((r) => r != null)).toEqual(b.readings);
      expect(boxelAgeWindowFrom("d", b.readings), b.kind).toEqual(windowOf(b));
    }
    expect([wide.width, disc.width]).toEqual([4000, 1270]);
    // Two scans that read the same: the width is told, the base is that reading or 128 less.
    const same = (b: (typeof aged.boxels)[number], base: number) =>
      b.readings.filter((r) => r.upper - (r.roll % b.width) === base).slice(0, 2);
    expect(boxelAgeWindowFrom("d", same(wide, wide.baseAge))).toEqual({ width: 4000, bases: [wide.baseAge, wide.baseAge - 128] });
    // The disc boxel's base is 1,216: its twin, 1,344, is more than a 1,270 wide window can have, so one value is left.
    expect(boxelAgeWindowFrom("d", same(disc, disc.baseAge + 128))).toEqual({ width: 1270, bases: [disc.baseAge] });
    expect(boxelAgeWindowFrom("d", same(disc, disc.baseAge))).toEqual({ width: 1270, bases: [disc.baseAge, disc.baseAge - 128] });
    // One scan fits every width; no scan, a mass code without stages: nothing.
    expect(boxelAgeWindowFrom("d", wide.readings.slice(0, 1))).toBeNull();
    expect(boxelAgeWindowFrom("d", [])).toBeNull();
    expect(boxelAgeWindowFrom("c", wide.readings)).toBeNull();
    // Mass code e knows the wide window only (its disc windows are left out).
    expect(boxelAgeWindowFrom("e", wide.readings)).toEqual(windowOf(wide));
    expect(boxelAgeWindowFrom("e", disc.readings)).toBeNull();
    // Readings no width fits: a scan of another boxel among them.
    expect(boxelAgeWindowFrom("d", [...wide.readings, disc.readings[0]!])).toBeNull();
    // An odd age is not one the game makes.
    expect(ageReading(BigInt(wide.systems.find((s) => s.path === "a")!.address), 4001)).toBeNull();
  });

  for (const kind of ["wide", "disc"] as const) {
    it(`gives every scanned system of a real ${kind}-window boxel the age and the stage it really has`, () => {
      const b = kind === "wide" ? wide : disc;
      const stages = new Map<string, number>();
      for (const s of b.systems) {
        const ages = systemAges(BigInt(s.address), "d", s.after, windowOf(b));
        expect(ages, `-${s.n}`).toEqual(s.ages);
        // Path A: the age to the million years, as the journal shows it.
        if (s.path === "a") expect(ages[0]! + (ages[0]! % 256), `-${s.n}`).toBe(s.age);
        const star = predictArrivalStar(BigInt(s.address), "d", s.after, 1, windowOf(b))!;
        expect(star.aged, `-${s.n}`).toBe(s.path === "young" ? "dice" : "base");
        expect(star.stage ?? "main", `-${s.n}`).toBe(s.stage);
        expect(s.stage, `-${s.n}`).toBe(s.realStage);
        stages.set(s.realStage, (stages.get(s.realStage) ?? 0) + 1);
      }
      expect([...stages].sort()).toEqual(
        kind === "wide"
          ? [
              ["giant", 2],
              ["main", 2],
              ["neutron", 5],
              ["whiteDwarf", 7],
            ]
          : [
              ["giant", 1],
              ["main", 52],
              ["neutron", 1],
              ["small", 2],
            ],
      );
    });
  }

  it("tells a stage with two bases left only where both agree", () => {
    const two: AgeWindow = { width: wide.width, bases: [wide.baseAge + 128, wide.baseAge] };
    let told = 0;
    for (const s of wide.systems.filter((x) => x.path !== "young")) {
      const star = predictArrivalStar(BigInt(s.address), "d", s.after, 1, two)!;
      const own = new Set(systemAges(BigInt(s.address), "d", s.after, two).map((age) => stageAt("d", Math.round(star.solarMasses * 256), age)));
      expect(star.aged, `-${s.n}`).toBe(own.size === 1 ? "base" : undefined);
      if (star.aged) told++;
    }
    expect(told).toBeGreaterThanOrEqual(10);
    // No window at all: nothing is told of a calm system.
    const calm = wide.systems.find((x) => x.path === "a")!;
    expect(predictArrivalStar(BigInt(calm.address), "d", calm.after)!.aged).toBeUndefined();
    expect(systemAges(BigInt(calm.address), "d", calm.after)).toEqual([]);
  });

  for (const code of ["d", "e"] as const) {
    it(`reads a young mass code ${code} system's age off its own dice`, () => {
      const rows = aged.young[code];
      let exact = 0;
      let right = 0;
      for (const s of rows) {
        expect(s.path).toBe("young");
        const ages = systemAges(BigInt(s.address), code, s.after);
        expect(ages, s.address).toEqual(s.ages);
        if (ages[0]! + (ages[0]! % 256) === s.age) exact++;
        const star = predictArrivalStar(BigInt(s.address), code, s.after)!;
        expect(star.aged).toBe("dice");
        expect(star.stage ?? "main", s.address).toBe(s.stage);
        // Young: never dead (and a giant only at the very last million years of its main sequence).
        expect(["main", "small", "giant"]).toContain(s.stage);
        if (s.stage === s.realStage) right++;
      }
      // As the real systems have it: the age to the million years, and the stage.
      expect([rows.length, exact, right]).toEqual(code === "d" ? [60, 50, 59] : [40, 24, 38]);
    });
  }

  it("leaves mass codes b and c alone: their stars outlast every age", () => {
    const s = golden.stars.c![0]!;
    const window = { width: 4000, bases: [5000] };
    expect(systemAges(BigInt(s.address), "c", s.after, window)).toEqual([]);
    expect(predictArrivalStar(BigInt(s.address), "c", s.after, 1, window)!.aged).toBeUndefined();
  });

  for (const kind of ["wide", "disc"] as const) {
    it(`turns his scans' ages into the stages of a ${kind}-window boxel's other systems`, () => {
      const b = kind === "wide" ? wide : disc;
      const prefix = "Test Sector AA-A d1-";
      setBoxelSectorSource(null);
      setBoxelLookupSource(() => ({ systems: { 0: { id64: Number(b.systems[0]!.address) } } }) as unknown as BoxelLookupRecord);
      const highest = Math.max(...b.systems.map((s) => s.n));
      const baseOf = (s: AgedStar) => {
        const r = ageReading(BigInt(s.address), s.age);
        return r ? r.upper - (r.roll % b.width) : null;
      };
      const low = b.systems.find((s) => baseOf(s) === b.baseAge)!;
      const high = b.systems.find((s) => baseOf(s) === b.baseAge + 128)!;
      const set = boxelStarSet(prefix, highest, null, new Map([low, high].map((s) => [s.n, s.real] as const)))!;
      expect(set.window).toEqual(windowOf(b));
      for (const s of b.systems.filter((x) => x.path !== "young")) {
        const star = set.stars.get(s.n)!;
        expect(star.aged, `-${s.n}`).toBe("base");
        expect(star.stage ?? "main", `-${s.n}`).toBe(s.realStage);
      }
      const dead = b.systems.find((s) => s.realStage === "neutron")!;
      expect(set.stars.get(dead.n)).toEqual({ cls: set.stars.get(dead.n)!.cls, right: 0.99, stage: "neutron", aged: "base" });
      const itself = b.systems.find((s) => s.realStage === "main")!;
      expect(set.stars.get(itself.n)).toMatchObject({ aged: itself.path === "young" ? "dice" : "base" });
      expect(set.stars.get(itself.n)!.stage).toBeUndefined();
      // Still itself by its age; what is left is the chance that the boxel replaces such stars.
      expect(set.stars.get(itself.n)!.alive).toBeGreaterThan(0.45);
      expect(set.stars.get(itself.n)!.alive).toBeLessThanOrEqual(0.99);
      // One scan fits every width: nothing is told from the boxel's ages, only from a young system's own dice.
      const one = boxelStarSet(prefix, highest, null, new Map([[low.n, low.real]]))!;
      expect(one.window).toBeNull();
      expect([...one.stars.values()].some((p) => p.aged === "base")).toBe(false);
      expect([...one.stars.values()].some((p) => p.aged === "dice")).toBe(true);
      // Scans without an age say nothing of the window.
      const none = boxelStarSet(prefix, highest, null, new Map([low, high].map((s) => [s.n, { ...s.real, age: undefined }] as const)))!;
      expect(none.window).toBeNull();
    });
  }
});

describe("boxels that replace their heavier stars by small ones", () => {
  const near = golden.replaced.near;
  const far = golden.replaced.far;
  const prefix = "Test Sector AA-A d1-";
  const place = (b: typeof near) => {
    setBoxelSectorSource(null);
    setBoxelLookupSource(() => ({ systems: { 0: { id64: Number(b.systems[0]!.address) } } }) as unknown as BoxelLookupRecord);
    return Math.max(...b.systems.map((s) => s.n));
  };

  it("goes by the place where nothing is scanned: all heavy stars near Sol and at the centre, fewer further out", () => {
    const at = (ly: number): [number, number, number] => [ly, 0, 0];
    expect([100, 499, 600, 900, 1200, 1800, 2500, 3500, 5000, 20000].map((ly) => replacedShare("d", 400, at(ly)))).toEqual([
      1, 1, 0.92, 0.68, 0.5, 0.36, 0.23, 0.17, 0.1, 0.06,
    ]);
    // Under 1.44 solar masses: only close to Sol. Mass code c: within 300 ly. Mass code b: not measured.
    expect([100, 400, 600, 900, 1500, 5000].map((ly) => replacedShare("d", 300, at(ly)))).toEqual([0.47, 0.22, 0.08, 0.03, 0.01, 0]);
    expect([100, 400, 600].map((ly) => replacedShare("c", 150, at(ly)))).toEqual([0.15, 0.02, 0]);
    expect(replacedShare("b", 60, at(100))).toBe(0);
    expect([100, 800, 5000, 20000].map((ly) => replacedShare("e", 800, at(ly)))).toEqual([0.99, 0.8, 0.06, 0.03]);
    // The galaxy's centre, 25,900 ly from Sol.
    expect([100, 400, 800, 4000].map((ly) => replacedShare("d", 400, [25, -21, 25900 + ly]))).toEqual([1, 0.82, 0.4, 0.14]);
    expect(replacedShare("d", 300, [25, -21, 25900])).toBe(0);
  });

  it("reads off a scan whether the star is the one the system was born with or the small one in its place", () => {
    for (const b of [near, far]) {
      for (const s of b.systems) {
        const w = replacementWitness(BigInt(s.address), "d", s.after, s.real);
        expect(w ? (w.replaced ? "replaced" : "kept") : null, `-${s.n}`).toBe(s.kind);
        if (w) expect(w.heavy).toBe(s.birthMass >= 369);
      }
    }
    // 448 ly from Sol: every star born with 1.44 solar masses and more is replaced, the lighter ones seen are not.
    expect(near.systems.filter((s) => s.birthMass >= 369).map((s) => s.kind)).toEqual(Array(9).fill("replaced"));
    expect(near.systems.filter((s) => s.birthMass < 369).every((s) => s.kind === "kept")).toBe(true);
    expect(far.systems.every((s) => s.kind === "kept")).toBe(true);
    // A dead star tells neither.
    const s = far.systems[0]!;
    expect(replacementWitness(BigInt(s.address), "d", s.after, { ...s.real, starType: "N", stellarMass: 0.5 })).toBeNull();
  });

  it("takes one boxel's stars as all replaced or all kept", () => {
    const w = (heavy: boolean, replaced: boolean) => ({ heavy, replaced });
    expect(boxelReplacement([])).toEqual({ heavy: null, light: null });
    expect(boxelReplacement([w(true, true)])).toEqual({ heavy: 0.86, light: null });
    expect(boxelReplacement([w(true, true), w(true, true)])).toEqual({ heavy: 0.97, light: null });
    // A heavy star that is itself: the lighter ones are too.
    expect(boxelReplacement([w(true, false)])).toEqual({ heavy: 0.02, light: 0.02 });
    // A replaced light star: the heavy ones are replaced as well. A light star that is itself says nothing of them.
    expect(boxelReplacement([w(false, true)])).toEqual({ heavy: 0.86, light: 0.86 });
    expect(boxelReplacement([w(false, false)])).toEqual({ heavy: null, light: 0.02 });
    expect(boxelReplacement([w(true, true), w(false, false)])).toEqual({ heavy: 0.86, light: 0.02 });
    // Scans that contradict each other tell nothing.
    expect(boxelReplacement([w(true, true), w(true, false)])).toEqual({ heavy: null, light: null });
  });

  it("calls the heavy stars of a boxel near Sol small stars, before any scan and after", () => {
    const highest = place(near);
    const heavy = near.systems.filter((s) => s.birthMass >= 369);
    const light = near.systems.filter((s) => s.birthMass < 369);
    const blind = boxelStarSet(prefix, highest, null, new Map())!;
    for (const s of heavy) expect(blind.stars.get(s.n), `-${s.n}`).toEqual({ cls: blind.stars.get(s.n)!.cls, right: 0.99, stage: "small", aged: "place" });
    // The lighter ones: one in five such is replaced this close to Sol, so "still itself" is less sure.
    for (const s of light) {
      const p = blind.stars.get(s.n)!;
      expect(p.stage, `-${s.n}`).toBeUndefined();
      expect([0.66, 0.76]).toContain(p.alive);
    }
    // Two scans of replaced heavy stars: his own scans say it now.
    const scanned = boxelStarSet(prefix, highest, null, new Map(heavy.slice(0, 2).map((s) => [s.n, s.real] as const)))!;
    expect(scanned.replaced).toEqual({ heavy: 0.97, light: null });
    expect(scanned.stars.get(heavy[5]!.n)).toEqual({ cls: scanned.stars.get(heavy[5]!.n)!.cls, right: 0.99, stage: "small", aged: "kind" });
    // A light star scanned as itself settles the lighter ones.
    const both = boxelStarSet(prefix, highest, null, new Map([heavy[0]!, light[0]!].map((s) => [s.n, s.real] as const)))!;
    expect(both.replaced).toEqual({ heavy: 0.86, light: 0.02 });
    expect(both.stars.get(heavy[5]!.n)!.stage).toBe("small");
    expect([0.83, 0.96]).toContain(both.stars.get(light[5]!.n)!.alive);
  });

  it("calls a heavy star a likely small star on one scanned replaced star, away from Sol", () => {
    // The far boxel's systems, with one heavy star scanned as the small star its dice would put in its place.
    const highest = place(far);
    const heavy = far.systems.filter((s) => s.birthMass >= 369);
    const w = heavy[0]!;
    const after = w.after;
    const small = { starType: "K", stellarMass: (25 + (systemRolls(BigInt(w.address), after + 2)[after + 1]! % 256)) / 256, temperature: 4500 };
    const set = boxelStarSet(prefix, highest, null, new Map([[w.n, small]]))!;
    expect(set.replaced).toEqual({ heavy: 0.86, light: null });
    expect(set.stars.get(heavy[1]!.n)).toEqual({ cls: set.stars.get(heavy[1]!.n)!.cls, right: 0.86, stage: "small", aged: "kind", likely: true });
    // The lighter stars are not touched by it.
    expect(set.stars.get(far.systems.find((s) => s.birthMass < 369)!.n)!.stage).toBeUndefined();
  });

  it("leaves a boxel far from Sol and the centre its heavy stars, and is surer once one is scanned", () => {
    const highest = place(far);
    const heavy = far.systems.filter((s) => s.birthMass >= 369);
    const blind = boxelStarSet(prefix, highest, null, new Map())!;
    for (const s of far.systems) expect(blind.stars.get(s.n)!.stage, `-${s.n}`).toBeUndefined();
    const scanned = boxelStarSet(prefix, highest, null, new Map([[heavy[0]!.n, heavy[0]!.real]]))!;
    expect(scanned.replaced).toEqual({ heavy: 0.02, light: 0.02 });
    const other = heavy[1]!.n;
    expect(scanned.stars.get(other)!.alive).toBeGreaterThan(blind.stars.get(other)!.alive!);
  });
});

describe("the predictions checked against his own scans", () => {
  const prefix = "Test Sector AA-A d1-";
  const check = (systems: { address: string; n: number; real: ArrivalStarScan }[]) => {
    setBoxelSectorSource(null);
    setBoxelLookupSource(() => ({ systems: { 0: { id64: Number(systems[0]!.address) } } }) as unknown as BoxelLookupRecord);
    const highest = Math.max(...systems.map((s) => s.n));
    return boxelStarCheck(prefix, highest, null, new Map(systems.map((s) => [s.n, s.real] as const)));
  };
  const told = (c: ReturnType<typeof check>) => [c!.checked, c!.right, c!.misses.map((m) => `${m.n}: ${m.predicted.stage ?? m.predicted.cls} / ${m.real}`)];

  it("predicts each scanned star from the other scans of its boxel and counts the hits", () => {
    // Near Sol: nine heavy stars replaced by small ones, fifteen lighter ones themselves.
    expect(told(check(golden.replaced.near.systems))).toEqual([24, 24, []]);
    // Far out: every star is itself.
    expect(told(check(golden.replaced.far.systems))).toEqual([22, 22, []]);
    // An old boxel (dead stars, giants) and a disc one, with the ages his scans carry.
    expect(told(check(golden.aged.boxels.find((b) => b.kind === "wide")!.systems))).toEqual([16, 16, []]);
    expect(told(check(golden.aged.boxels.find((b) => b.kind === "disc")!.systems))).toEqual([56, 55, ["84: F / A"]]);
    // That miss: an A star at 7,500 K to the kelvin, predicted a few kelvin under the limit.
  });

  it("has nothing to check without a scan, or where the boxel cannot be placed", () => {
    const systems = golden.replaced.far.systems;
    setBoxelSectorSource(null);
    setBoxelLookupSource(() => ({ systems: { 0: { id64: Number(systems[0]!.address) } } }) as unknown as BoxelLookupRecord);
    expect(boxelStarCheck(prefix, 50, null, new Map())).toBeNull();
    setBoxelLookupSource(null);
    expect(boxelStarCheck(prefix, 50, null, new Map([[systems[0]!.n, systems[0]!.real]]))).toBeNull();
  });
});
