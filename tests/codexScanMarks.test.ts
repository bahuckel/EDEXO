/**
 * Composition-scan waypoints (demo, 2026-11-02, after EDMC-BioScan / ExplorerLite / SrvSurvey): a biological
 * `CodexEntry` carries Latitude / Longitude / BodyID, so the plant the ship's scanner named becomes a radar mark,
 * until that species is logged on the body.
 */
import { describe, expect, it } from "vitest";
import { buildExoMinimapDto, ingestExoOrganicJournalLine } from "../src/server/exoOrganicTracker.js";
import { GameStateStore } from "../src/server/gameState.js";
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
  it("marks where the scanner named a plant, once per species and body", () => {
    const { store, ingest } = setup();
    ingest(codex());
    ingest(codex({ Latitude: 13.94 }));
    expect(store.surfaceCodexMarks).toHaveLength(1);
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

  it("retires once the species is logged on that body, and only there", () => {
    const { store, ingest } = setup();
    ingest(codex());
    ingest(codex({ BodyID: 5 }));
    ingest({
      timestamp: "2026-11-01T18:05:00Z",
      event: "ScanOrganic",
      ScanType: "Log",
      Genus: "$Codex_Ent_Tube_Name;",
      Species: "$Codex_Ent_TubeABCD_01_Name;",
      Variant: "$Codex_Ent_TubeABCD_01_Name;",
      Species_Localised: "Prasinum Sinuous Tubers",
      SystemAddress: 37738594260331,
      Body: 4,
    });
    expect(store.surfaceCodexMarks.map((m) => m.bodyKey)).toEqual(["37738594260331:5"]);
  });
});
