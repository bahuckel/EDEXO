/**
 * Composition-scan waypoints (demo, 2026-11-02, after EDMC-BioScan / ExplorerLite / SrvSurvey): a biological
 * `CodexEntry` carries Latitude / Longitude / BodyID, so the plant the ship's scanner named becomes a radar mark,
 * until that species is logged on the body.
 */
import { describe, expect, it } from "vitest";
import { buildExoMinimapDto, ingestExoOrganicJournalLine } from "../src/server/exoOrganicTracker.js";
import { GameStateStore } from "../src/server/gameState.js";
import { applyLiveFix } from "../src/server/liveFix.js";
import { fromLocal } from "../src/shared/scanLocate.js";
import { getCachedSpeciesDatabase, loadSpeciesDatabase } from "../src/server/snapshot.js";

const BODY = "Eembaids EG-Y g5 4";
const fix = {
  latDeg: 13.93,
  lonDeg: 165.72,
  planetRadiusM: 1_500_000,
  bodyName: BODY,
  headingDeg: 0,
  temperatureK: null,
  gravityG: null,
};
const codex = (over: Record<string, unknown> = {}) => ({
  timestamp: "2026-11-01T18:00:31Z",
  event: "CodexEntry",
  Name: "$Codex_Ent_TubeABCD_01_Name;",
  Name_Localised: "Prasinum Sinuous Tubers",
  Category: "$Codex_Category_Biology;",
  SystemAddress: 37738594260331,
  BodyID: 4,
  Latitude: 13.935266,
  Longitude: 165.722351,
  ...over,
});

function setup() {
  loadSpeciesDatabase();
  const store = new GameStateStore();
  const ingest = (line: Record<string, unknown>) =>
    ingestExoOrganicJournalLine(store as never, line as never, fix, process.cwd(), getCachedSpeciesDatabase());
  return { store, ingest };
}

describe("composition-scan waypoints", () => {
  it("marks where the scanner named a plant, once per plant", () => {
    const { store, ingest } = setup();
    ingest(codex());
    ingest(codex({ Latitude: 13.93527 }));
    expect(store.surfaceCodexMarks).toHaveLength(1);
    // Another spot, no heading to tie it to the first (on foot): another plant.
    ingest(codex({ Latitude: 13.94 }));
    expect(store.surfaceCodexMarks).toHaveLength(2);
    expect(store.surfaceCodexMarks[0]).toMatchObject({ bodyKey: "37738594260331:4", label: "Prasinum Sinuous Tubers" });
  });

  it("ignores codex entries that are not biology or carry no position", () => {
    const { store, ingest } = setup();
    ingest(codex({ Category: "$Codex_Category_StellarBodies;" }));
    ingest(codex({ Latitude: undefined }));
    expect(store.surfaceCodexMarks).toHaveLength(0);
  });

  it("shows on the radar of that body as its own kind", () => {
    const { store, ingest } = setup();
    ingest(codex());
    store.exoOrganicLastFix = fix;
    const mm = buildExoMinimapDto(store as never, "37738594260331:4", 0)!;
    const m = mm.marks.find((x) => x.kind === "codex");
    expect(m?.label).toContain("Prasinum Sinuous Tubers");
    // About 600 m north of where he stands (0.0053° on a 1,500 km body).
    expect(m!.northM).toBeGreaterThan(100);
  });

  it("draws the planet flown over while Status.json gives a position and a heading (Radar always on)", () => {
    const { store, ingest } = setup();
    ingest(codex());
    // No touchdown, no sample run: the radar of the planet flown over, flagged `near` for the HUD's switch, whatever
    // the flight mode (owner, 2026-11-04: "as long as we have the coordinates and heading in the status.json").
    store.exoOrganicLastFix = fix;
    const mm = buildExoMinimapDto(store as never, null, 0)!;
    expect(mm.near).toBe(true);
    expect(mm.marks.find((x) => x.kind === "codex")?.label).toContain("Prasinum Sinuous Tubers");
    // No heading, or no body name: no radar.
    store.exoOrganicLastFix = { ...fix, headingDeg: null };
    expect(buildExoMinimapDto(store as never, null, 0)).toBeNull();
    store.exoOrganicLastFix = { ...fix, bodyName: null };
    expect(buildExoMinimapDto(store as never, null, 0)).toBeNull();
    // Landed: the body underfoot, not `near`.
    store.exoOrganicLastFix = fix;
    expect(buildExoMinimapDto(store as never, "37738594260331:4", 0)!.near).toBeUndefined();
  });

  const organic = (scanType: string, over: Record<string, unknown> = {}) => ({
    timestamp: "2026-11-01T18:05:00Z",
    event: "ScanOrganic",
    ScanType: scanType,
    Genus: "$Codex_Ent_Tube_Name;",
    Genus_Localised: "Sinuous Tubers",
    Species: "$Codex_Ent_TubeABCD_01_Name;",
    Variant: "$Codex_Ent_TubeABCD_01_Name;",
    Species_Localised: "Prasinum Sinuous Tubers",
    SystemAddress: 37738594260331,
    Body: 4,
    ...over,
  });

  it("a sample retires only the scan of the plant underfoot; Analyse retires the species on that body", () => {
    const { store, ingest } = setup();
    ingest(codex());
    ingest(codex({ BodyID: 5 }));
    // Sampled 600 m from the scanned plant: that one is still to do (owner, 2026-11-04).
    ingest(organic("Log"));
    expect(store.surfaceCodexMarks.map((m) => m.bodyKey)).toEqual(["37738594260331:4", "37738594260331:5"]);
    ingest(organic("Analyse", { timestamp: "2026-11-01T18:20:00Z" }));
    expect(store.surfaceCodexMarks.map((m) => m.bodyKey)).toEqual(["37738594260331:5"]);
  });

  it("a sample at the scanned plant retires its mark", () => {
    loadSpeciesDatabase();
    const store = new GameStateStore();
    const atPlant = { ...fix, latDeg: 13.935266, lonDeg: 165.722351 };
    ingestExoOrganicJournalLine(store as never, codex() as never, fix, process.cwd(), getCachedSpeciesDatabase());
    ingestExoOrganicJournalLine(store as never, organic("Log") as never, atPlant, process.cwd(), getCachedSpeciesDatabase());
    expect(store.surfaceCodexMarks).toHaveLength(0);
  });

  it("points at the next plant of the species being sampled, outside the range of the samples taken", () => {
    const { store, ingest } = setup();
    ingest(codex());
    ingest(organic("Log"));
    store.exoOrganicLastFix = fix;
    const mm = buildExoMinimapDto(store as never, "37738594260331:4", store.exoOrganicTracker!.minSampleDistanceM)!;
    const m = mm.marks.find((x) => x.kind === "codex")!;
    expect(m.target).toBe(true);
    expect(m.label).toContain("next to sample");
    expect(m.name).toBe("Prasinum Sinuous Tubers");
  });

  it("places a plant scanned twice from the ship where the two heading lines cross", () => {
    loadSpeciesDatabase();
    const store = new GameStateStore();
    const R = fix.planetRadiusM;
    const deg = 180 / Math.PI / R;
    // The plant 500 m north of `fix`; scanned from 400 m west and 400 m east of it, 300 m short, 150 m up.
    const plantLat = fix.latDeg + 500 * deg;
    const cos = Math.cos((fix.latDeg * Math.PI) / 180);
    const ship = (e: number, heading: number) => ({
      ...fix,
      latDeg: fix.latDeg + 200 * deg,
      lonDeg: fix.lonDeg + (e * deg) / cos,
      headingDeg: heading,
      altitudeM: 150,
      pitchDeg: null,
    });
    const scanFrom = (e: number, heading: number, ts: string) =>
      ingestExoOrganicJournalLine(
        store as never,
        codex({ timestamp: ts, Latitude: ship(e, heading).latDeg, Longitude: ship(e, heading).lonDeg }) as never,
        ship(e, heading),
        process.cwd(),
        getCachedSpeciesDatabase(),
      );
    scanFrom(-400, 53.13, "2026-11-01T18:00:31Z");
    expect(store.surfaceCodexMarks[0]).toMatchObject({ located: "scanned-from", headingDeg: 53.13 });
    scanFrom(400, 306.87, "2026-11-01T18:01:10Z");
    const m = store.surfaceCodexMarks[0]!;
    expect(store.surfaceCodexMarks).toHaveLength(1);
    expect(m.located).toBe("crossing");
    expect(m.scans).toHaveLength(2);
    expect(Math.abs(m.latDeg - plantLat) / deg).toBeLessThan(2);
    expect(Math.abs(m.lonDeg - fix.lonDeg) / deg).toBeLessThan(2);
  });

  it("keeps no heading for a scan on foot (its position is the plant's)", () => {
    loadSpeciesDatabase();
    const store = new GameStateStore();
    ingestExoOrganicJournalLine(store as never, codex() as never, { ...fix, headingDeg: 90 }, process.cwd(), getCachedSpeciesDatabase());
    expect(store.surfaceCodexMarks[0]!.scans![0]!.headingDeg).toBeNull();
  });
  it("splits a mark from the first build that held two plants' scans, once the planet's radius is known", () => {
    loadSpeciesDatabase();
    const store = new GameStateStore();
    const R = fix.planetRadiusM;
    const at = (sec: number) => new Date(Date.UTC(2026, 10, 4, 10, 5, 28) + sec * 1000).toISOString();
    const sc = (e: number, n: number, h: number, sec: number) => ({ ...fromLocal(fix, e, n, R), headingDeg: h, altitudeM: 5, pitchDeg: null, atIso: at(sec) });
    store.surfaceCodexMarks = [
      {
        bodyKey: "37738594260331:4",
        bodyNameNorm: "eembaids eg-y g5 4",
        latDeg: fix.latDeg,
        lonDeg: fix.lonDeg,
        label: "Prasinum Sinuous Tubers",
        atIso: at(0),
        codexName: "$Codex_Ent_TubeABCD_01_Name;",
        located: "crossing",
        scans: [sc(0, 0, 191, 0), sc(-65, -19, 134, 14), sc(-38, -119, 121, 459), sc(-72, -283, 67, 477)],
      },
    ];
    applyLiveFix(store, { ...fix }, 0);
    expect(store.surfaceCodexMarks).toHaveLength(2);
    expect(store.surfaceCodexMarks.every((m) => m.located === "crossing" && m.radiusM === R)).toBe(true);
  });
});
