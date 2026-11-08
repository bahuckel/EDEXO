/**
 * EDHM's pitch box colours from its own files (owner 2026-11-07: read the ini instead of photographing every theme).
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { edhmColour, edhmTargetText, parseEdhmIni, readEdhmColours } from "../src/server/edhmColours.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

/** A home with EDHM-UI pointing at a game folder that has EDHM (d3dx.ini) and an Advanced.ini. */
function home(advanced: string, withD3dx = true, startup?: string): { home: string; ini: string; startup: string } {
  const h = mkdtempSync(join(tmpdir(), "edexo-edhm-"));
  homes.push(h);
  const game = join(h, "game");
  mkdirSync(join(game, "EDHM-ini"), { recursive: true });
  if (withD3dx) writeFileSync(join(game, "d3dx.ini"), "");
  writeFileSync(join(game, "EDHM-ini", "Advanced.ini"), advanced);
  if (startup != null) writeFileSync(join(game, "EDHM-ini", "Startup-Profile.ini"), startup);
  mkdirSync(join(h, "EDHM_UI"));
  writeFileSync(
    join(h, "EDHM_UI", "Settings.json"),
    JSON.stringify({
      ActiveInstance: "Steam (Odyssey (Live))",
      GameInstances: [{ instance: "Steam", games: [{ instance: "Steam (Odyssey (Live))", path: game }] }],
    }),
  );
  return { home: h, ini: join(game, "EDHM-ini", "Advanced.ini"), startup: join(game, "EDHM-ini", "Startup-Profile.ini") };
}

const ORANGE_RETICLE = "; Main\nx209 = 1\ny209 = 0.3763\nz209 = 0\nw209 = 1\n; Text in reticle boxes\nx95 = 1\ny95 = 1\nz95 = 1\nw95 = 1\n";

const ini = (...lines: string[]) => `${lines.join("\n")}\n`;

describe("EDHM's ini colours", () => {
  it("are linear channels shown through the sRGB curve (EDHM-UI's 165 orange is stored as 0.3763)", () => {
    expect(edhmColour(parseEdhmIni(ORANGE_RETICLE), 209)).toEqual([255, 165, 0]);
    expect(edhmColour(parseEdhmIni(ORANGE_RETICLE), 95)).toEqual([255, 255, 255]);
    expect(edhmColour(parseEdhmIni("x95 = 1\ny95 = 1\n"), 95)).toBeNull();
  });

  it("are read from the game EDHM-UI names, and again when the file changes (F11 in game)", () => {
    const { home: h, ini } = home(ORANGE_RETICLE);
    expect(readEdhmColours(h)).toEqual({ pitchText: [255, 255, 255], pitchFrame: [255, 165, 0], targetText: null });
    writeFileSync(ini, ORANGE_RETICLE.replace("y209 = 0.3763", "y209 = 1").replace("z209 = 0", "z209 = 1"));
    const later = new Date(Date.now() + 5000);
    utimesSync(ini, later, later);
    expect(readEdhmColours(h)?.pitchFrame).toEqual([255, 255, 255]);
  });

  it("give the main text colour by Startup-Profile's w75: custom x77, the XML matrix over the game's orange, or none", () => {
    const advanced = parseEdhmIni(ini("x77 = 0", "y77 = 0.5", "z77 = 1"));
    // His Interstellar Ultra Blue's matrix: the game's orange comes out cyan (the distance reader learned 4, 249, 250).
    const xml = parseEdhmIni(
      ini("x150 = 0.03", "y150 = 0.41", "z150 = 1.32", "x151 = 0", "y151 = 0.75", "z151 = -0.91", "x152 = 1.2", "y152 = -0.15", "z152 = -0.16"),
    );
    expect(edhmTargetText(parseEdhmIni("w75 = 100"), advanced, xml)).toEqual([0, 188, 255]);
    expect(edhmTargetText(parseEdhmIni("w75 = 199"), advanced, xml)).toEqual([48, 217, 252]);
    expect(edhmTargetText(parseEdhmIni("w75 = 199"), advanced, new Map())).toBeNull();
    expect(edhmTargetText(parseEdhmIni("w75 = 200"), advanced, xml)).toBeNull();
    expect(edhmTargetText(new Map(), advanced, xml)).toBeNull();
  });

  it("re-read the main text colour when Startup-Profile changes", () => {
    const { home: h, startup } = home(ORANGE_RETICLE + ini("x77 = 1", "y77 = 1", "z77 = 1"), true, "w75 = 200");
    expect(readEdhmColours(h)?.targetText).toBeNull();
    writeFileSync(startup, "w75 = 100");
    const later = new Date(Date.now() + 5000);
    utimesSync(startup, later, later);
    expect(readEdhmColours(h)?.targetText).toEqual([255, 255, 255]);
  });

  it("are none without EDHM in the game folder, or without EDHM-UI", () => {
    expect(readEdhmColours(home(ORANGE_RETICLE, false).home)).toBeNull();
    const bare = mkdtempSync(join(tmpdir(), "edexo-edhm-"));
    homes.push(bare);
    expect(readEdhmColours(bare)).toBeNull();
  });
});
