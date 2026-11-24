/**
 * The per-colour profiles (server/colourProfiles.ts, plan-1.4.0 §6.1): a species is read on its predicted colour's own
 * profile where that colour has one of enough bodies, and on the species profile otherwise.
 */
import { describe, expect, it } from "vitest";
import { getProjectRoot } from "../src/server/paths.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { loadExomasteryProfile } from "../src/server/exomasteryProfile.js";
import { COLOUR_PROFILE_MIN_SAMPLES, colourProfile, profileForBody } from "../src/server/colourProfiles.js";
import type { SpeciesMatchContext } from "../src/shared/types.js";

const root = getProjectRoot();
const db = loadSpeciesDatabaseFromTree(root);
const arcus = db.species.find((e) => e.id === "aleoida_aleoida_arcus")!;

describe("colour profiles", () => {
  it("reads a colour's own profile, any case, on the species' histogram edges", () => {
    const green = colourProfile(root, arcus, "Green")!;
    expect(green.sampleCount).toBe(2524);
    const species = loadExomasteryProfile(root, arcus)!;
    expect(green.histograms?.["body.surfaceTemperature"]?.length).toBe(species.histograms?.["body.surfaceTemperature"]?.length);
    // The species' parameter importance stands in, for the card's figures.
    expect(green.parameterImportance).toEqual(species.parameterImportance);
  });

  it("refuses a thin colour, an ambiguous label and a colour with no file", () => {
    expect(COLOUR_PROFILE_MIN_SAMPLES).toBeGreaterThan(24);
    expect(colourProfile(root, arcus, "Indigo")).toBeNull(); // 24 bodies
    expect(colourProfile(root, arcus, "Green or Teal")).toBeNull();
    expect(colourProfile(root, arcus, "(unknown)")).toBeNull();
    expect(colourProfile(root, arcus, "Cobalt")).toBeNull();
  });

  it("falls back to the species profile when nothing decides the colour", () => {
    const species = loadExomasteryProfile(root, arcus);
    expect(profileForBody(root, arcus, null, null)).toEqual({ profile: species, colour: null });
    const unknownStar = { colourStarTypes: ["NotAStar"] } as unknown as SpeciesMatchContext;
    expect(profileForBody(root, arcus, unknownStar, null).colour).toBeNull();
  });
});
