/**
 * @vitest-environment jsdom
 * The interface style (src/client/uiStyle.ts): Classic unless chosen, kept, on <html> for the stylesheet, and a
 * stored value that is not a style (broken, or one of the two dropped on trial) is Classic.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { UI_STYLES, UI_STYLE_EVENT, applyUiStyle, setUiStyle, uiStyle } from "../src/client/uiStyle";

describe("interface style", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.uiStyle;
  });

  it("is Classic until chosen, and Classic leaves <html> without the attribute every rule is keyed on", () => {
    expect(uiStyle()).toBe("classic");
    applyUiStyle();
    expect(document.documentElement.hasAttribute("data-ui-style")).toBe(false);
  });

  it("keeps each choice, puts it on <html>, tells the page, and goes back to Classic cleanly", () => {
    applyUiStyle();
    let told = 0;
    const on = () => told++;
    window.addEventListener(UI_STYLE_EVENT, on);
    for (const { style } of UI_STYLES.filter((s) => s.style !== "classic")) {
      setUiStyle(style);
      expect(uiStyle()).toBe(style);
      expect(document.documentElement.dataset.uiStyle).toBe(style);
    }
    setUiStyle("classic");
    window.removeEventListener(UI_STYLE_EVENT, on);
    expect(uiStyle()).toBe("classic");
    expect(document.documentElement.hasAttribute("data-ui-style")).toBe(false);
    expect(localStorage.getItem("edexo.uiStyle")).toBeNull();
    expect(told).toBe(UI_STYLES.length);
  });

  it("reads a broken stored value, and a style that was only on trial, as Classic", () => {
    for (const v of ["neon", "blueprint", "terminal", ""]) {
      localStorage.setItem("edexo.uiStyle", v);
      expect(uiStyle()).toBe("classic");
      applyUiStyle();
      expect(document.documentElement.hasAttribute("data-ui-style")).toBe(false);
    }
  });

  it("offers Classic first, then Holo and Nebula", () => {
    expect(UI_STYLES.map((s) => s.style)).toEqual(["classic", "holo", "nebula"]);
  });
});
