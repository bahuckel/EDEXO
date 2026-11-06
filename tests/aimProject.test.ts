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
import { glidedMap, nextGlide } from "../src/client/aim/glide.js";
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
    // Pitch unknown (hovering): a level nose assumed, so the same place as nose level, drawn dashed.
    const [level] = projectMarks(map([codex(0, 100)], { altitudeM: 100, pitchDeg: null }), view);
    expect(level!.y).toBeCloseTo(low!.y);
    expect(level!.pitched).toBe(false);
    expect(level!.belowDeg).toBeCloseTo(45);
    // On foot (no altitude): the middle line.
    const [foot] = projectMarks(map([codex(0, 100)]), view);
    expect(foot!.y).toBe(720);
    expect(foot!.belowDeg).toBeNull();
  });

  it("does not open a mark straight ahead but far below a level nose (owner, 2026-11-04: 240 m, 18 deg below, 78 m up)", () => {
    const below = projectMarks(map([codex(0, 240)], { altitudeM: 78, pitchDeg: null }), view);
    expect(below[0]!.belowDeg).toBeCloseTo(18, 0);
    expect(openMark(below, view)).toBeNull();
    // Nose 18 degrees down (estimated): it opens.
    expect(openMark(projectMarks(map([codex(0, 240)], { altitudeM: 78, pitchDeg: -18 }), view), view)).not.toBeNull();
  });

  it("opens the mark the nose points at, and none when nothing is near the centre", () => {
    const marks = projectMarks(map([codex(5, 400, { name: "A" }), codex(300, 300, { name: "B" })]), view);
    expect(openMark(marks, view)?.mark.name).toBe("A");
    expect(openMark(projectMarks(map([codex(300, 300)]), view), view)).toBeNull();
  });

  it("shows composition scans and samples taken, not the ship, and nothing without a heading", () => {
    expect(projectMarks(map([codex(0, 100, { kind: "sample" }), codex(0, 100, { kind: "ship" })]), view)).toHaveLength(1);
    expect(projectMarks(map([codex(0, 100)], { headingDeg: null }), view)).toHaveLength(0);
  });
});

describe("samples on the screen", () => {
  it("marks a sample where it is, and draws no ring on the ground (owner 2026-11-06: it ran across the screen)", async () => {
    const m = map([codex(0, 200, { kind: "sample", ringM: 50 })], { altitudeM: 30, pitchDeg: -10 });
    const [mark] = projectMarks(m, view);
    expect(mark!.mark.kind).toBe("sample");
    expect(mark!.edge).toBeFalsy();
    expect(Object.keys(await import("../src/client/aim/project.js"))).not.toContain("projectRings");
  });
});

describe("marks between Status.json writes (glide)", () => {
  it("moves the marks on by the ship's speed from the last two writes, for one gap at most", () => {
    const a = map([codex(0, 300)], { altitudeM: 40 });
    const b = map([codex(0, 270)], { altitudeM: 37 });
    const g = nextGlide(nextGlide(null, a, 0), b, 3000);
    // 30 m north in 3 s: 10 m/s; 1.5 s later the plant is 15 m nearer, the ship 1.5 m lower.
    const mid = glidedMap(g, 4500)!;
    expect(mid.marks[0]!.northM).toBeCloseTo(255, 5);
    expect(mid.marks[0]!.distanceM).toBeCloseTo(255, 5);
    expect(mid.altitudeM).toBeCloseTo(35.5, 5);
    // Stopped (no new write): it stays where one gap took it.
    expect(glidedMap(g, 60_000)!.marks[0]!.northM).toBeCloseTo(240, 5);
  });

  it("does not glide from one write, a long pause or a jump", () => {
    const a = map([codex(0, 300)]);
    expect(glidedMap(nextGlide(null, a, 0), 2000)).toBe(a);
    const late = nextGlide(nextGlide(null, a, 0), map([codex(0, 270)]), 20_000);
    expect(late.vN).toBe(0);
    const jump = nextGlide(nextGlide(null, a, 0), map([codex(0, 100)]), 100);
    expect(jump.vN).toBe(0);
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
    expect(readEliteView(path.join(g, "DisplaySettings.xml"))).toEqual({
      verticalFovDeg: 54.32,
      width: 3440,
      height: 1440,
      hudMatrix: null,
      hudColour: "default",
    });
    // A custom HUD colour (owner 2026-11-06: a recoloured HUD was not read): the matrix, and that it can be undone.
    writeFileSync(
      path.join(g, "GraphicsConfigurationOverride.xml"),
      "<GraphicsConfig><GUIColour><Default><MatrixRed>0, 0.47, 1</MatrixRed><MatrixGreen>0, 0.37, 0</MatrixGreen><MatrixBlue>1, 0, 0</MatrixBlue></Default></GUIColour></GraphicsConfig>",
    );
    expect(readEliteView(path.join(g, "DisplaySettings.xml"))).toMatchObject({
      hudMatrix: [
        [0, 0.47, 1],
        [0, 0.37, 0],
        [1, 0, 0],
      ],
      hudColour: "undo",
    });
  });

  it("says nothing it could not read", () => {
    dir = mkdtempSync(path.join(tmpdir(), "edexo-view-"));
    expect(readEliteView(path.join(dir, "Graphics", "DisplaySettings.xml"))).toEqual({
      verticalFovDeg: null,
      width: null,
      height: null,
      hudMatrix: null,
      hudColour: "default",
    });
  });
});
