/**
 * Where the game's product folders are, for the opt-in live position (netlogPosition.ts): on Linux the game runs in
 * Proton and lives in a Steam library or Heroic's folder (plan 1.3.6 M-1); any other install can be named.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findGameProductDirs } from "../src/server/netlogPosition.js";

let dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "edexo-products-"));
  dirs.push(d);
  return d;
};
const product = (productsDir: string, name = "elite-dangerous-odyssey-64") => {
  const dir = path.join(productsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "EliteDangerous64.exe"), "");
  return dir;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("the game's product folders", () => {
  it("are found in a Linux Steam library (Proton), the default one and those libraryfolders.vdf lists", () => {
    const home = temp();
    const lib = temp();
    const steam = path.join(home, ".local", "share", "Steam");
    const own = product(path.join(steam, "steamapps", "common", "Elite Dangerous", "Products"));
    mkdirSync(path.join(steam, "steamapps"), { recursive: true });
    writeFileSync(
      path.join(steam, "steamapps", "libraryfolders.vdf"),
      `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam.replace(/\\/g, "/")}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${lib.replace(/\\/g, "/")}"\n\t}\n}\n`,
    );
    const other = product(path.join(lib, "steamapps", "common", "Elite Dangerous", "Products"));
    const found = findGameProductDirs({}, "linux", home).map((d) => path.resolve(d));
    expect(found).toEqual(expect.arrayContaining([path.resolve(own), path.resolve(other)]));
  });

  it("are found in Heroic's folder, and in the folder EDEXO_ELITE_PRODUCTS_DIR names", () => {
    const home = temp();
    const heroic = product(path.join(home, "Games", "Heroic", "EliteDangerous", "Products"));
    const named = temp();
    const custom = product(named, "elite-dangerous-64");
    const found = findGameProductDirs({ EDEXO_ELITE_PRODUCTS_DIR: named }, "linux", home).map((d) => path.resolve(d));
    expect(found).toEqual(expect.arrayContaining([path.resolve(heroic), path.resolve(custom)]));
  });

  it("is nothing on a platform without the game, and needs the game's exe in the folder", () => {
    const home = temp();
    mkdirSync(path.join(home, "Games", "Heroic", "EliteDangerous", "Products", "empty"), { recursive: true });
    expect(findGameProductDirs({}, "linux", home)).toEqual([]);
    expect(findGameProductDirs({}, "darwin", home)).toEqual([]);
  });
});
