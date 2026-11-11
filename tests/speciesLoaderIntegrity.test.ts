/**
 * The species loader says what it leaves out (review 2026-11-10 A12): a genus file that does not parse and a species
 * id listed twice reach the data warnings instead of vanishing; genus folders load in sorted order on every file
 * system.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSpeciesDataWarnings, loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { getProjectRoot } from "../src/server/paths.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("the species loader", () => {
  it("loads the shipped tree with every id once and no file left unread", () => {
    const db = loadSpeciesDatabaseFromTree(getProjectRoot());
    const ids = db.species.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getSpeciesDataWarnings().filter((w) => /could not be read|listed twice/.test(w))).toEqual([]);
    // Folder order, sorted: a genus never appears before one that sorts ahead of it.
    const dirs = [...new Set(db.species.map((e) => e.genusDataDir))];
    expect(dirs).toEqual([...dirs].sort());
  });

  it("warns about a genus file that does not parse and an id listed twice, and keeps the first", () => {
    const root = mkdtempSync(path.join(tmpdir(), "edexo-loader-"));
    roots.push(root);
    const species = path.join(root, "data", "species");
    mkdirSync(species, { recursive: true });
    const real = path.join(getProjectRoot(), "data", "species", "tubus", "tubus_new.json");
    // The same genus file under a second folder: every id twice.
    for (const dir of ["tubus", "tubus-copy"]) {
      mkdirSync(path.join(species, dir));
      cpSync(real, path.join(species, dir, `${dir}_new.json`));
    }
    mkdirSync(path.join(species, "broken"));
    writeFileSync(path.join(species, "broken", "broken_new.json"), "{ not json", "utf8");

    const db = loadSpeciesDatabaseFromTree(root);
    const warnings = getSpeciesDataWarnings();
    expect(warnings.some((w) => w.includes("broken_new.json") && w.includes("could not be read"))).toBe(true);
    expect(warnings.filter((w) => w.includes("listed twice")).length).toBeGreaterThan(0);
    const ids = db.species.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(db.species.every((e) => e.genusDataDir === "tubus")).toBe(true);
  });
});
