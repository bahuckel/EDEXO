/**
 * Two species sampled from the same spot (review 2026-11-05): Status.json only moves with the commander, so a Log of a
 * second species without a step had the first one's position, and its mark was dropped as a duplicate — its Scan 1 had
 * no dot or ring. The same plant twice (an Analyse after its Log) is still one mark.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";

let dir = "";
let prior: string | undefined;
beforeEach(() => {
  prior = process.env.EDEXO_USER_DATA_DIR;
  dir = mkdtempSync(path.join(tmpdir(), "edexo-samespot-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
});
afterEach(() => {
  if (prior === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = prior;
  rmSync(dir, { recursive: true, force: true });
});

it("keeps a mark for each species logged from one spot, one for the same plant twice", () => {
  const store = new GameStateStore();
  const add = (label: string) => store.addSurfaceSampleMark("x 1", "x 1", 10, 20, label, "2026-11-05T10:00:00Z");
  add("Stratum Tectonicas");
  add("Bacterium Aurasus");
  add("Stratum Tectonicas");
  expect(store.surfaceSampleMarks.map((m) => m.label)).toEqual(["Stratum Tectonicas", "Bacterium Aurasus"]);
});
