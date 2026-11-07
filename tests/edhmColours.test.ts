/**
 * EDHM's pitch box colours from its own files (owner 2026-11-07: read the ini instead of photographing every theme).
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { edhmColour, parseEdhmIni, readEdhmColours } from "../src/server/edhmColours.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

/** A home with EDHM-UI pointing at a game folder that has EDHM (d3dx.ini) and an Advanced.ini. */
function home(advanced: string, withD3dx = true): { home: string; ini: string } {
  const h = mkdtempSync(join(tmpdir(), "edexo-edhm-"));
  homes.push(h);
  const game = join(h, "game");
  mkdirSync(join(game, "EDHM-ini"), { recursive: true });
  if (withD3dx) writeFileSync(join(game, "d3dx.ini"), "");
  writeFileSync(join(game, "EDHM-ini", "Advanced.ini"), advanced);
  mkdirSync(join(h, "EDHM_UI"));
  writeFileSync(
    join(h, "EDHM_UI", "Settings.json"),
    JSON.stringify({
      ActiveInstance: "Steam (Odyssey (Live))",
      GameInstances: [{ instance: "Steam", games: [{ instance: "Steam (Odyssey (Live))", path: game }] }],
    }),
  );
  return { home: h, ini: join(game, "EDHM-ini", "Advanced.ini") };
}

const ORANGE_RETICLE = "; Main\nx209 = 1\ny209 = 0.3763\nz209 = 0\nw209 = 1\n; Text in reticle boxes\nx95 = 1\ny95 = 1\nz95 = 1\nw95 = 1\n";

describe("EDHM's ini colours", () => {
  it("are linear channels shown through the sRGB curve (EDHM-UI's 165 orange is stored as 0.3763)", () => {
    expect(edhmColour(parseEdhmIni(ORANGE_RETICLE), 209)).toEqual([255, 165, 0]);
    expect(edhmColour(parseEdhmIni(ORANGE_RETICLE), 95)).toEqual([255, 255, 255]);
    expect(edhmColour(parseEdhmIni("x95 = 1\ny95 = 1\n"), 95)).toBeNull();
  });

  it("are read from the game EDHM-UI names, and again when the file changes (F11 in game)", () => {
    const { home: h, ini } = home(ORANGE_RETICLE);
    expect(readEdhmColours(h)).toEqual({ pitchText: [255, 255, 255], pitchFrame: [255, 165, 0] });
    writeFileSync(ini, ORANGE_RETICLE.replace("y209 = 0.3763", "y209 = 1").replace("z209 = 0", "z209 = 1"));
    const later = new Date(Date.now() + 5000);
    utimesSync(ini, later, later);
    expect(readEdhmColours(h)?.pitchFrame).toEqual([255, 255, 255]);
  });

  it("are none without EDHM in the game folder, or without EDHM-UI", () => {
    expect(readEdhmColours(home(ORANGE_RETICLE, false).home)).toBeNull();
    const bare = mkdtempSync(join(tmpdir(), "edexo-edhm-"));
    homes.push(bare);
    expect(readEdhmColours(bare)).toBeNull();
  });
});
