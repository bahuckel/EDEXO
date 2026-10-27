// @vitest-environment jsdom
/**
 * Options › Look › Font (src/client/uiFont.ts; owner, 2026-10-27): EDEXO by default (also after an update, with
 * nothing stored), Classic only when chosen, on `<html data-font>`; a change made in another window is followed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { applyUiFont, setUiFont, uiFont } from "../src/client/uiFont.js";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.font;
});

describe("interface font", () => {
  it("is EDEXO until Classic is chosen, and marks <html> only for EDEXO", () => {
    applyUiFont();
    expect(uiFont()).toBe("edexo");
    expect(document.documentElement.dataset.font).toBe("edexo");
    setUiFont("classic");
    expect(document.documentElement.dataset.font).toBeUndefined();
    setUiFont("edexo");
    expect(document.documentElement.dataset.font).toBe("edexo");
  });

  it("follows a choice made in another window", () => {
    applyUiFont();
    localStorage.setItem("edexo.uiFont", "classic");
    window.dispatchEvent(new StorageEvent("storage", { key: "edexo.uiFont" }));
    expect(document.documentElement.dataset.font).toBeUndefined();
  });
});
