/**
 * The clear key (owner, 2026-11-04: "a key bind to do the delete of current planet scans"; "keep in memory file but just
 * remove them from the screen and the calculations"; press twice within 3 s): this planet's sample and composition-scan
 * marks move to the file's `cleared` list; other planets, the ship and the SRV stay.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLEAR_ARM_MS, buildExoMinimapDto, pressClearMarksHere } from "../src/server/exoOrganicTracker.js";
import { GameStateStore } from "../src/server/gameState.js";
import { resolveSurfaceMarksPath } from "../src/server/paths.js";
import { clearedSurfaceMarks, flushSurfaceMarks, loadSurfaceMarks, type SurfaceMark } from "../src/server/surfaceMarksFile.js";

const HERE = "eembaids eg-y g5 4";
const mark = (bodyKey: string, bodyNameNorm: string, label: string, over: Partial<SurfaceMark> = {}): SurfaceMark => ({
  bodyKey,
  bodyNameNorm,
  latDeg: 13.93,
  lonDeg: 165.72,
  label,
  atIso: "2026-11-04T18:00:00Z",
  ...over,
});

// Each test its own folder: the cleared marks are kept per file.
let dir = "";
let prior: string | undefined;
beforeEach(() => {
  prior = process.env.EDEXO_USER_DATA_DIR;
  dir = mkdtempSync(path.join(tmpdir(), "edexo-clear-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
});
afterEach(() => {
  if (prior === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = prior;
  rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const store = new GameStateStore();
  store.exoOrganicLastFix = {
    latDeg: 13.931,
    lonDeg: 165.72,
    planetRadiusM: 1_500_000,
    bodyName: "Eembaids EG-Y g5 4",
    headingDeg: 0,
    temperatureK: null,
    gravityG: null,
  } as never;
  store.surfaceSampleMarks = [mark("1:4", HERE, "Stratum Tectonicas"), mark("1:5", "eembaids eg-y g5 5", "Bacterium Aurasus")];
  store.surfaceCodexMarks = [mark("1:4", HERE, "Tussock Pennata", { codexName: "$Codex_Ent_Tussocks_01_Name;" })];
  store.surfaceShipMark = mark("1:4", HERE, "Your ship");
  return store;
}

describe("the clear key", () => {
  it("arms on the first press and asks on the radar; the second within 3 s moves this planet's marks to cleared", () => {
    const store = setup();
    const t0 = Date.now();
    expect(pressClearMarksHere(store as never, "1:4", t0)).toEqual({ armed: 2 });
    expect(buildExoMinimapDto(store as never, "1:4", 0)!.clearArmed).toBe(2);
    expect(pressClearMarksHere(store as never, "1:4", t0 + 1000)).toEqual({ cleared: 2 });
    expect(store.surfaceSampleMarks.map((m) => m.label)).toEqual(["Bacterium Aurasus"]);
    expect(store.surfaceCodexMarks).toEqual([]);
    expect(store.surfaceShipMark).not.toBeNull();
    const mm = buildExoMinimapDto(store as never, "1:4", 0)!;
    expect(mm.clearArmed).toBeUndefined();
    expect(mm.marks.map((m) => m.kind)).toEqual(["ship"]);
    // Kept in the file, off the radar.
    flushSurfaceMarks();
    const f = loadSurfaceMarks();
    expect(f.cleared).toBeUndefined();
    expect(f.samples.map((m) => m.label)).toEqual(["Bacterium Aurasus"]);
    const cleared = clearedSurfaceMarks();
    expect(cleared.map((m) => m.label).sort()).toEqual(["Stratum Tectonicas", "Tussock Pennata"]);
    expect(cleared.every((m) => typeof m.clearedAtIso === "string")).toBe(true);
    // On disk too, and still there after the next save.
    store.persistSurfaceMarks();
    flushSurfaceMarks();
    const raw = JSON.parse(readFileSync(resolveSurfaceMarksPath(), "utf8")) as { cleared?: SurfaceMark[] };
    expect(raw.cleared).toHaveLength(2);
  });

  it("keeps the samples of the run in progress (owner, 2026-11-05: do not end the run, just remove the comp scans)", () => {
    const store = setup();
    store.surfaceSampleMarks.push(mark("1:4", HERE, "Stratum Tectonicas", { latDeg: 14.5 })); // an earlier run's
    store.exoOrganicTracker = {
      bodyKey: "1:4",
      bodyNameNorm: HERE,
      speciesDisplay: "Stratum Tectonicas",
      anchors: [{ latDeg: 13.93, lonDeg: 165.72 }],
    } as never;
    const t0 = Date.now();
    expect(pressClearMarksHere(store as never, "1:4", t0)).toEqual({ armed: 2 });
    expect(pressClearMarksHere(store as never, "1:4", t0 + 1000)).toEqual({ cleared: 2 });
    expect(store.surfaceSampleMarks.map((m) => [m.label, m.latDeg])).toEqual([
      ["Stratum Tectonicas", 13.93],
      ["Bacterium Aurasus", 13.93],
    ]);
    expect(store.surfaceCodexMarks).toEqual([]);
    expect(store.exoOrganicTracker).not.toBeNull();
  });

  it("a second press after the wait only arms again", () => {
    const store = setup();
    const t0 = Date.now();
    pressClearMarksHere(store as never, "1:4", t0);
    expect(pressClearMarksHere(store as never, "1:4", t0 + CLEAR_ARM_MS + 1)).toEqual({ armed: 2 });
    expect(store.surfaceSampleMarks).toHaveLength(2);
  });

  it("does nothing on a planet with no marks", () => {
    const store = setup();
    store.exoOrganicLastFix = { ...store.exoOrganicLastFix!, bodyName: "Somewhere Else 1" };
    expect(pressClearMarksHere(store as never, null, Date.now())).toBeNull();
    expect(buildExoMinimapDto(store as never, null, 0)!.clearArmed).toBeUndefined();
  });
});
