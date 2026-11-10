// @vitest-environment jsdom
/**
 * The streamer view redraws only for a mirrored setting it has read (src/client/uiMirror.ts; owner, 2026-10-27:
 * switching Compare's tabs redrew it with nothing changed — the tab list and the opened screen's filters).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { changedKeys, startUiMirrorSource, touchesWhatWasRead } from "../src/client/uiMirror.js";

describe("the app's mirror source (review 2026-11-07 §4.2, D14)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports at start and a second after a setting changes, and nothing while none does", async () => {
    vi.useFakeTimers();
    const sent: Record<string, string>[] = [];
    vi.stubGlobal("fetch", (_u: string, init: { body: string }) => {
      sent.push((JSON.parse(init.body) as { values: Record<string, string> }).values);
      return Promise.resolve(new Response("{}"));
    });
    localStorage.clear();
    localStorage.setItem("edexo.units", "metric");
    // jsdom's page is http://localhost/.
    startUiMirrorSource();
    expect(sent).toEqual([{ "edexo.units": "metric" }]);
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(1);
    localStorage.setItem("other.key", "x");
    vi.advanceTimersByTime(2000);
    expect(sent).toHaveLength(1);
    localStorage.setItem("edexo.units", "imperial");
    localStorage.setItem("edexo.compact", "1");
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([{ "edexo.units": "metric" }, { "edexo.units": "imperial", "edexo.compact": "1" }]);
    // A removal counts too.
    localStorage.removeItem("edexo.compact");
    vi.advanceTimersByTime(1000);
    expect(sent.at(-1)).toEqual({ "edexo.units": "imperial" });
    // Another window's write is not this page's setItem (a named property stands in for it): seen by its storage event.
    const n = sent.length;
    (localStorage as unknown as Record<string, string>)["edexo.hud"] = "on";
    vi.advanceTimersByTime(2000);
    expect(sent).toHaveLength(n);
    window.dispatchEvent(new StorageEvent("storage", { key: "edexo.hud" }));
    vi.advanceTimersByTime(1000);
    expect(sent.at(-1)).toEqual({ "edexo.units": "imperial", "edexo.hud": "on" });
  });
});

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
