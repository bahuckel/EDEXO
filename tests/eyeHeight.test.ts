/**
 * The cockpit eye above Status.json's altitude, learned per ship (owner, 2026-11-04: his Mandalay's eye sat 12-15 m
 * above it and the screen marker drew plants about 10 deg off): from plants two scans placed and the HUD pitch of each
 * scan (server/eyeHeight.ts), then used for the marker's angles and a single scan placed ahead.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eyeAboveM, learnEyeHeight, noteShipLine, resetEyeHeightForTests } from "../src/server/eyeHeight.js";
import { resolveCommanderDataDir } from "../src/server/paths.js";
import { fromLocal, locatePlant, toLocal, type CompScan } from "../src/shared/scanLocate.js";
import { projectMarks, viewOf } from "../src/client/aim/project.js";

const R = 9_000_000;
const O = { latDeg: 30, lonDeg: 40 };
const plant = fromLocal(O, 0, 100, R);
/** A scan from `e`, `n`, looking at the plant from `alt` m up with the eye `eye` m above that. */
const scan = (e: number, n: number, alt: number, eye: number, at: string): CompScan => {
  const p = { ...fromLocal(O, e, n, R) };
  const d = toLocal(p, plant, R);
  const dist = Math.hypot(d.e, d.n);
  return {
    ...p,
    headingDeg: ((Math.atan2(d.e, d.n) * 180) / Math.PI + 360) % 360,
    altitudeM: alt,
    pitchDeg: -Math.round((Math.atan2(alt + eye, dist) * 180) / Math.PI),
    pitchFromHud: true,
    atIso: at,
  };
};

// Each test its own folder: the learned heights are kept in a file.
let dir = "";
let prior: string | undefined;
beforeEach(() => {
  prior = process.env.EDEXO_USER_DATA_DIR;
  dir = mkdtempSync(path.join(tmpdir(), "edexo-eye-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
  resetEyeHeightForTests();
});
afterEach(() => {
  resetEyeHeightForTests();
  if (prior === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = prior;
  rmSync(dir, { recursive: true, force: true });
});

describe("eye height", () => {
  it("learns the ship's eye from HUD-pitch scans of a placed plant, per ship", () => {
    resetEyeHeightForTests();
    noteShipLine({ event: "Loadout", Ship: "Mandalay" });
    expect(eyeAboveM()).toBe(0);
    learnEyeHeight(plant, [scan(-60, 20, 9, 13, "2026-11-04T12:36:17Z"), scan(60, 30, 5, 13, "2026-11-04T12:36:29Z"), scan(0, 40, 12, 13, "2026-11-04T12:36:52Z")], R);
    // Whole-degree pitches: within a couple of metres.
    expect(Math.abs(eyeAboveM() - 13)).toBeLessThan(3);
    noteShipLine({ event: "Loadout", Ship: "Krait_Light" });
    expect(eyeAboveM()).toBe(0);
  });

  it("remembers the last ship across a restart (the app started mid-session sees no Loadout)", () => {
    noteShipLine({ event: "Loadout", Ship: "Mandalay" });
    learnEyeHeight(plant, [scan(-60, 20, 9, 13, "2026-11-04T12:36:17Z"), scan(60, 30, 5, 13, "2026-11-04T12:36:29Z")], R);
    const learned = eyeAboveM();
    expect(learned).toBeGreaterThan(8);
    // A new run: no line has named the ship yet.
    resetEyeHeightForTests();
    expect(eyeAboveM()).toBe(learned);
  });

  it("uses the ship sampled last when no line or saved ship names one (a start from the journal cache)", () => {
    const d = resolveCommanderDataDir();
    mkdirSync(d, { recursive: true });
    const ships = { cobra: [{ at: "2026-11-01T10:00:00Z", m: 2 }], mandalay: [{ at: "2026-11-04T13:15:22Z", m: 13.2 }] };
    writeFileSync(path.join(d, "edexo-eye-height.json"), JSON.stringify({ version: 1, ships }));
    expect(eyeAboveM()).toBe(13.2);
  });

  it("ignores estimated pitches, flat looks and absurd results", () => {
    resetEyeHeightForTests();
    noteShipLine({ event: "Loadout", Ship: "Mandalay" });
    learnEyeHeight(plant, [{ ...scan(-60, 20, 9, 13, "2026-11-04T12:00:00Z"), pitchFromHud: false }, { ...scan(0, -800, 9, 0, "2026-11-04T12:00:05Z"), pitchDeg: -1 }], R);
    expect(eyeAboveM()).toBe(0);
  });

  it("places a single scan ahead from the eye, and the marker draws from the eye", () => {
    // 10 m up, eye 10 m above that, looking 20 deg down at a plant: 55 m ahead, not 27.
    const s = { ...O, headingDeg: 0, altitudeM: 10, pitchDeg: -20, atIso: "2026-11-04T12:00:00Z", eyeAboveM: 10 };
    const at = toLocal(O, locatePlant([s], R)!, R);
    expect(at.n).toBeCloseTo(20 / Math.tan((20 * Math.PI) / 180), 0);
    const view = viewOf(2000, 1000, 50);
    const mark = { kind: "codex" as const, eastM: 0, northM: 55, distanceM: 55, label: "x" };
    const [m] = projectMarks({ radiusM: 500, headingDeg: 0, minSampleDistanceM: 0, marks: [mark], altitudeM: 10, eyeAboveM: 10, pitchDeg: -20 }, view);
    expect(m!.belowDeg).toBeCloseTo(0, 0);
  });
});
