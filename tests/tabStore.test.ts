// @vitest-environment jsdom
/**
 * Tab view's store (src/client/tabs/tabStore.ts; owner, 2026-10-06): one tab per screen, closing brings
 * the neighbour forward, the strip can be reordered, and the switch and the tabs are remembered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tabStore } from "../src/client/tabs/tabStore.js";

beforeEach(() => {
  localStorage.clear();
  tabStore.resetForTests();
});

describe("tab view", () => {
  it("opens one tab per screen and brings it to the front", () => {
    tabStore.open("boxels");
    tabStore.open("encyclopedia");
    tabStore.open("boxels");
    expect(tabStore.get()).toMatchObject({ tabs: ["boxels", "encyclopedia"], active: "boxels" });
  });

  it("closing the tab in front brings its left neighbour forward, then Main", () => {
    tabStore.open("boxels");
    tabStore.open("galaxy");
    tabStore.close("galaxy");
    expect(tabStore.get().active).toBe("boxels");
    tabStore.close("boxels");
    expect(tabStore.get()).toMatchObject({ tabs: [], active: "main" });
  });

  it("moves a tab within the strip", () => {
    tabStore.open("boxels");
    tabStore.open("galaxy");
    tabStore.open("stats");
    tabStore.move("stats", 0);
    expect(tabStore.get().tabs).toEqual(["stats", "boxels", "galaxy"]);
  });

  it("remembers the switch, the tabs and the one in front", () => {
    tabStore.open("poi");
    tabStore.open("carriers");
    tabStore.activate("poi");
    expect(JSON.parse(localStorage.getItem("edexo.tabs")!)).toEqual({
      tabs: ["poi", "carriers"],
      active: "poi",
    });
    tabStore.setOn(false);
    expect(localStorage.getItem("edexo.tabView")).toBe("0");
    expect(tabStore.get()).toMatchObject({ on: false, active: "main" });
  });

  it("the streamer view shows the home screen with no tab strip, whatever tabs the mirror brought", async () => {
    localStorage.setItem("edexo.tabView", "1");
    localStorage.setItem("edexo.tabs", JSON.stringify({ tabs: ["galaxy", "boxels"], active: "galaxy" }));
    window.history.replaceState(null, "", "/?view=stream");
    try {
      vi.resetModules();
      const { tabStore: streamer } = await import("../src/client/tabs/tabStore.js");
      expect(streamer.get()).toEqual({ on: false, tabs: [], active: "main" });
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});
