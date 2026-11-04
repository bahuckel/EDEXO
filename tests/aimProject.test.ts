/**
 * The screen marker (owner, 2026-11-04): a composition-scanned plant's place on the screen from the nose, with the
 * game's own field of view (client/aim/project.ts), and the field of view read from its settings
 * (server/eliteDisplayMode.ts readEliteView).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openMark, projectMarks, viewOf, DEFAULT_VFOV_DEG } from "../src/client/aim/project.js";
import { readEliteView } from "../src/server/eliteDisplayMode.js";
import type { ExoMinimapDTO } from "../src/shared/types.js";

type Mark = ExoMinimapDTO["marks"][number];
const codex = (eastM: number, northM: number, more: Partial<Mark> = {}): Mark => ({
  kind: "codex",
  eastM,
  northM,
  distanceM: Math.hypot(eastM, northM),
  label: "x",
  name: "Stratum Tectonicas - Green",
  ...more,
});
const map = (marks: Mark[], more: Partial<ExoMinimapDTO> = {}): ExoMinimapDTO => ({
  radiusM: 500,
  headingDeg: 0,
  minSampleDistanceM: 0,
  marks,
  ...more,
});

// The owner's: 3440 x 1440, vertical FOV 54.32.
const view = viewOf(3440, 1440, 54.32);

describe("screen marker projection", () => {
  it("turns the game's vertical field of view into the horizontal one", () => {
    expect(view.hFovDeg).toBeCloseTo(101.6, 0);
    expect(viewOf(1920, 1080, null).vFovDeg).toBe(DEFAULT_VFOV_DEG);
  });

  it("puts a mark dead ahead in the middle, one to the right on the right, one behind at the edge", () => {
    const [ahead, right, behind] = projectMarks(map([codex(0, 400), codex(400, 400), codex(0, -400)]), view);
    expect(ahead!.x).toBeCloseTo(1720);
    expect(ahead!.y).toBeCloseTo(720);
    // 45 degrees right: tan 45 / tan(hFov/2) of the half width.
    expect(right!.x).toBeCloseTo(1720 + 1720 / Math.tan((view.hFovDeg / 2) * (Math.PI / 180)), 0);
    expect(behind!.edge).not.toBeNull();
  });

  it("puts a mark below the nose lower on the screen when the pitch is known, on the middle line when not", () => {
    // 100 m up, the mark 100 m ahead: 45 degrees below the horizon; nose 45 down: dead centre.
    const [centred] = projectMarks(map([codex(0, 100)], { altitudeM: 100, pitchDeg: -45 }), view);
    expect(centred!.y).toBeCloseTo(720, 0);
    expect(centred!.pitched).toBe(true);
    // Nose level: 45 degrees below it, low on the screen.
    const [low] = projectMarks(map([codex(0, 100)], { altitudeM: 100, pitchDeg: 0 }), view);
    expect(low!.y).toBeGreaterThan(1100);
    // Pitch unknown: the middle line, and how far below it is said instead.
    const [level] = projectMarks(map([codex(0, 100)], { altitudeM: 100, pitchDeg: null }), view);
    expect(level!.y).toBe(720);
    expect(level!.pitched).toBe(false);
    expect(level!.belowDeg).toBeCloseTo(45);
  });

  it("opens the mark the nose points at, and none when nothing is near the centre", () => {
    const marks = projectMarks(map([codex(5, 400, { name: "A" }), codex(300, 300, { name: "B" })]), view);
    expect(openMark(marks, view)?.mark.name).toBe("A");
    expect(openMark(projectMarks(map([codex(300, 300)]), view), view)).toBeNull();
  });

  it("shows only composition scans, and nothing without a heading", () => {
    expect(projectMarks(map([codex(0, 100, { kind: "sample" }), codex(0, 100, { kind: "ship" })]), view)).toHaveLength(0);
    expect(projectMarks(map([codex(0, 100)], { headingDeg: null }), view)).toHaveLength(0);
  });
});

describe("readEliteView", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the vertical field of view and the resolution from the game's settings", () => {
    dir = mkdtempSync(path.join(tmpdir(), "edexo-view-"));
    const g = path.join(dir, "Graphics");
    mkdirSync(g);
    writeFileSync(path.join(g, "DisplaySettings.xml"), "<DisplayConfig><ScreenWidth>3440</ScreenWidth><ScreenHeight>1440</ScreenHeight></DisplayConfig>");
    writeFileSync(path.join(g, "Settings.xml"), "<GraphicsOptions><FOV>54.320000</FOV></GraphicsOptions>");
    expect(readEliteView(path.join(g, "DisplaySettings.xml"))).toEqual({ verticalFovDeg: 54.32, width: 3440, height: 1440 });
  });

  it("says nothing it could not read", () => {
    dir = mkdtempSync(path.join(tmpdir(), "edexo-view-"));
    expect(readEliteView(path.join(dir, "Graphics", "DisplaySettings.xml"))).toEqual({ verticalFovDeg: null, width: null, height: null });
  });
});
