// @vitest-environment jsdom
/**
 * The streamer view redraws only for a mirrored setting it has read (src/client/uiMirror.ts; owner, 2026-10-27:
 * switching Compare's tabs redrew it with nothing changed — the tab list and the opened screen's filters).
 */
import { describe, expect, it } from "vitest";
import { changedKeys, touchesWhatWasRead } from "../src/client/uiMirror.js";

describe("streamer view mirror", () => {
  it("lists the keys a mirror adds, changes or drops", () => {
    const current = { "edexo.a": "1", "edexo.b": "2", "edexo.gone": "x" };
    const m = { rev: 2, values: { "edexo.a": "1", "edexo.b": "3", "edexo.new": "y" } };
    expect(changedKeys(m, current).sort()).toEqual(["edexo.b", "edexo.gone", "edexo.new"]);
  });

  it("redraws for a setting it read, not for the tab list or another screen's filters", () => {
    const read = new Set(["edexo.filters.edexo.candidateView", "edexo.units"]);
    expect(touchesWhatWasRead(["edexo.tabs", "edexo.filters.boxel.lookOpen"], read)).toBe(false);
    expect(touchesWhatWasRead(["edexo.tabs", "edexo.filters.edexo.candidateView"], read)).toBe(true);
  });
});
