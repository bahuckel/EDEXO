/**
 * A composition scan of a genus the game names colour first (owner, 2026-10-26: "Sinuous Tubers have a bug. It did
 * not detect my scan properly. Detected genera - Prasinum, Sinuous Tubers is (not scanned). Also candidate Species
 * screen did not reflect it"). The CodexEntry reads "Prasinum Sinuous Tubers" (no colour after a dash); the genus was
 * taken as its first word, so the scan became a genus "Prasinum" of its own, the DSS's Sinuous Tubers stayed "not
 * scanned", and the lock resolved to no species.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { collectResolvedOrganicLockSpeciesIds } from "../src/server/organicLocks.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { codexGenusOfSpecies, codexOrganicLockFromLine } from "../src/shared/codexLog.js";
import { bodyGenusProgress } from "../src/shared/genusProgress.js";
import type { GenusHint, JournalLine } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);
const SYS = 1_592_719_906_427;

// The owner's line, 2026-10-24 (Laso FI-A d14-46 A 1), with the body it names.
const tubers = {
  timestamp: "2026-10-24T08:13:45Z",
  event: "CodexEntry",
  EntryID: 2100502,
  Name: "$Codex_Ent_TubeABCD_01_Name;",
  Name_Localised: "Prasinum Sinuous Tubers",
  SubCategory: "$Codex_SubCategory_Organic_Structures;",
  SubCategory_Localised: "Organic structures",
  Category: "$Codex_Category_Biology;",
  Category_Localised: "Biological and Geological",
  Region: "$Codex_RegionName_2;",
  Region_Localised: "Empyrean Straits",
  System: "Laso FI-A d14-46",
  SystemAddress: SYS,
  BodyID: 5,
} as unknown as JournalLine;

describe("the genus of a species name as the game spells it", () => {
  it("is the last words for the colour-first genera, the whole name for the one-species ones", () => {
    expect(codexGenusOfSpecies("Prasinum Sinuous Tubers")).toBe("Sinuous Tubers");
    expect(codexGenusOfSpecies("Aureum Brain Tree")).toBe("Brain Tree");
    expect(codexGenusOfSpecies("Luteolum Anemone")).toBe("Anemone");
    expect(codexGenusOfSpecies("Bark Mounds")).toBe("Bark Mounds");
    expect(codexGenusOfSpecies("Amphora Plant")).toBe("Amphora Plant");
    expect(codexGenusOfSpecies("Crystalline Shards")).toBe("Crystalline Shards");
    expect(codexGenusOfSpecies("Fonticulua Fluctus")).toBe("Fonticulua");
  });
});

describe("a comp scan of Sinuous Tubers", () => {
  it("is a lock on Sinuous Tubers", () => {
    expect(codexOrganicLockFromLine(tubers as never)).toMatchObject({
      genusLocalised: "Sinuous Tubers",
      speciesLocalised: "Prasinum Sinuous Tubers",
      source: "codex",
    });
  });

  it("marks the DSS's Sinuous Tubers [CS] with its species, with no extra genus row", () => {
    const store = new GameStateStore();
    store.apply(tubers);
    const locks = store.bodies.get(`${SYS}:5`)?.organicGenusLocks ?? [];
    const dss: GenusHint[] = [{ Genus: "$Codex_Ent_Tube_Name;", Genus_Localised: "Sinuous Tubers" } as GenusHint];
    const rows = bodyGenusProgress(dss, locks, null);
    expect(rows.map((r) => [r.genus, r.species, r.status])).toEqual([["Sinuous Tubers", "Prasinum Sinuous Tubers", "cs"]]);
  });

  it("a foot scan, whose line says Genus_Localised \"Roseum Sinuous Tubers\", is still shown as Sinuous Tubers", () => {
    const lock = {
      genusLocalised: "Roseum Sinuous Tubers",
      genusSymbol: "$Codex_Ent_Tube_Name;",
      speciesLocalised: "Prasinum Sinuous Tubers",
      speciesSymbol: "$Codex_Ent_TubeABCD_01_Name;",
      variantLocalised: "Prasinum Sinuous Tubers",
      analysed: true,
    } as never;
    expect(bodyGenusProgress([], [lock], null).map((r) => [r.genus, r.status])).toEqual([["Sinuous Tubers", "done"]]);
  });

  it("names its species for the candidate list", () => {
    const store = new GameStateStore();
    store.apply(tubers);
    const locks = store.bodies.get(`${SYS}:5`)?.organicGenusLocks ?? [];
    const ids = collectResolvedOrganicLockSpeciesIds(locks, db);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/prasinum/);
  });
});
