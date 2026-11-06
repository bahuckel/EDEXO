/**
 * Elite's custom HUD colour (shared/hudColourMatrix.ts, owner 2026-11-06): the GUIColour matrix read from
 * GraphicsConfigurationOverride.xml, applied as the game does, and undone before the screen readers look.
 */
import { describe, expect, it } from "vitest";
import {
  applyHudMatrix,
  DEFAULT_TARGET_TEXT,
  hueMapper,
  parseHexColour,
  pickedColourReadable,
  hudColourSupport,
  invertHudMatrix,
  isIdentityHudMatrix,
  parseHudColourMatrix,
  recolourRgba,
  type HudColourMatrix,
} from "../src/shared/hudColourMatrix.js";

const XML = `<?xml version="1.0" encoding="UTF-8" ?>
<GraphicsConfig>
  <GUIColour>
    <Default>
      <LocalisationName>Standard</LocalisationName>
      <MatrixRed> 0, 0.3, 1 </MatrixRed>
      <MatrixGreen> 0, 1, 0 </MatrixGreen>
      <MatrixBlue> 1, 0, 0 </MatrixBlue>
    </Default>
  </GUIColour>
</GraphicsConfig>`;

describe("the HUD colour matrix", () => {
  it("reads the three rows, and nothing from the default file", () => {
    expect(parseHudColourMatrix(XML)).toEqual([
      [0, 0.3, 1],
      [0, 1, 0],
      [1, 0, 0],
    ]);
    expect(parseHudColourMatrix(`<?xml version="1.0" encoding="UTF-8" ?>\n<GraphicsConfig />`)).toBeNull();
    expect(parseHudColourMatrix(XML.replace("0, 1, 0", "0, x, 0"))).toBeNull();
  });

  it("recolours the HUD's orange as the game does, and the inverse brings it back", () => {
    const m = parseHudColourMatrix(XML)!;
    // Default orange: red goes to blue (and a little green), green stays, blue goes to red.
    expect(applyHudMatrix(m, 250, 150, 0)).toEqual([0, 225, 250]);
    const px = new Uint8Array([250, 150, 0, 255]);
    recolourRgba(px, m);
    recolourRgba(px, invertHudMatrix(m)!);
    expect([...px]).toEqual([250, 150, 0, 255]);
  });

  it("reads only the colours it can undo (bench 2026-11-06: no wrong read on those)", () => {
    expect(hudColourSupport(null)).toBe("default");
    expect(hudColourSupport([[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBe("default");
    // Channel swaps and a common blue HUD: undone.
    expect(hudColourSupport([[0, 0, 1], [0, 1, 0], [1, 0, 0]])).toBe("undo");
    expect(hudColourSupport([[0, 0.47, 1], [0, 0.37, 0], [1, 0, 0]])).toBe("undo");
    // Purple pushes the yellow text to 265, cyan and white past 255 too: the clamp cut it, left unread.
    expect(hudColourSupport([[0.6, 0, 1], [0, 0.3, 0], [0, 0, 1]])).toBe("unsupported");
    expect(hudColourSupport([[0, 0.7, 1], [0.2, 0.6, 0], [0, 0, 1]])).toBe("unsupported");
    expect(hudColourSupport([[1, 1, 1], [0, 1, 0], [0, 0, 1]])).toBe("unsupported");
    expect(hudColourSupport([[1, 1, 1], [1, 1, 1], [0, 0, 1]])).toBe("unsupported");
  });

  it("has no inverse when the matrix drops a colour, and knows the default", () => {
    const flat: HudColourMatrix = [
      [1, 1, 1],
      [1, 1, 1],
      [0, 0, 1],
    ];
    expect(invertHudMatrix(flat)).toBeNull();
    expect(isIdentityHudMatrix([[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBe(true);
    expect(isIdentityHudMatrix(parseHudColourMatrix(XML)!)).toBe(false);
  });
});

/*
  A modded HUD (EDHM recolours in its own shaders and leaves the XML alone): the commander picks his text colour and
  each reader turns it into the default's (owner 2026-11-06; a commander's EDHM target text: 165, 195, 5).
*/
describe("a picked HUD text colour", () => {
  it("turns the picked colour into the default target orange, and darker text along with it", () => {
    const picked = parseHexColour("#a5c305")!;
    expect(picked).toEqual([165, 195, 5]);
    const px = new Uint8Array([...picked, 255, 83, 98, 3, 255]);
    hueMapper(picked, DEFAULT_TARGET_TEXT)!(px);
    for (let i = 0; i < 3; i++) expect(Math.abs(px[i]! - DEFAULT_TARGET_TEXT[i]!)).toBeLessThanOrEqual(2);
    // The same hue at half the brightness: the same orange at about half.
    expect(px[4]! / px[0]!).toBeGreaterThan(0.45);
    expect(px[4]! / px[0]!).toBeLessThan(0.55);
    expect(px[4]!).toBeGreaterThan(px[5]!);
  });

  it("leaves the default look as it is when the picked colour is the default", () => {
    const px = new Uint8Array([...DEFAULT_TARGET_TEXT, 255, 20, 20, 30, 255]);
    hueMapper(DEFAULT_TARGET_TEXT, DEFAULT_TARGET_TEXT)!(px);
    expect([...px]).toEqual([...DEFAULT_TARGET_TEXT, 255, 20, 20, 30, 255]);
  });

  it("refuses a white or grey HUD (no hue to turn) and anything not a colour", () => {
    expect(pickedColourReadable([230, 230, 230])).toBe(false);
    expect(hueMapper([200, 200, 210], DEFAULT_TARGET_TEXT)).toBeNull();
    expect(parseHexColour("green")).toBeNull();
    expect(pickedColourReadable(parseHexColour("#3ca0ff"))).toBe(true);
  });
});
