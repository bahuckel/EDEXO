/**
 * Review 2026-11-10 D7: every dragged-out tab window kept an entry in window-state.json, one per drag, never let go.
 * The newest 24 stay; the app's own windows are never touched.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const { pruneTabWindows } = createRequire(import.meta.url)("../electron/windowState.cjs") as {
  pruneTabWindows: (all: Record<string, { savedAt?: number }>) => void;
};

describe("window-state.json", () => {
  it("keeps the newest 24 tab windows and every app window", () => {
    const all: Record<string, { savedAt?: number }> = { app: {}, launcher: {} };
    for (let i = 0; i < 30; i++) all[`tab:w${i}`] = { savedAt: i };
    pruneTabWindows(all);
    const tabs = Object.keys(all).filter((k) => k.startsWith("tab:"));
    expect(tabs).toHaveLength(24);
    expect(tabs).not.toContain("tab:w0");
    expect(tabs).toContain("tab:w29");
    expect(all.app).toBeDefined();
    expect(all.launcher).toBeDefined();
  });
});
