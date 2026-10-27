// @vitest-environment jsdom
/**
 * Options › Look › Font (src/client/uiFont.ts; owner, 2026-10-27): Classic by default, EDEXO on `<html data-font>`,
 * and a change made in another window of the app is followed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { applyUiFont, setUiFont, uiFont } from "../src/client/uiFont.js";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.font;
});

describe("interface font", () => {
  it("is Classic until EDEXO is chosen, and marks <html> only for EDEXO", () => {
    applyUiFont();
    expect(uiFont()).toBe("classic");
    expect(document.documentElement.dataset.font).toBeUndefined();
    setUiFont("edexo");
    expect(document.documentElement.dataset.font).toBe("edexo");
    setUiFont("classic");
    expect(document.documentElement.dataset.font).toBeUndefined();
  });

  it("follows a choice made in another window", () => {
    applyUiFont();
    localStorage.setItem("edexo.uiFont", "edexo");
    window.dispatchEvent(new StorageEvent("storage", { key: "edexo.uiFont" }));
    expect(document.documentElement.dataset.font).toBe("edexo");
  });
});
