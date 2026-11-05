// @vitest-environment jsdom
/**
 * Tab view's store (src/client/tabs/tabStore.ts; owner, 2026-10-06): one tab per screen, closing brings
 * the neighbour forward, the strip can be reordered, and the switch and the tabs are remembered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { showPickedSystem, tabStore } from "../src/client/tabs/tabStore.js";

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

  it("a system picked in a screen: the screen stays, Main comes forward; a pop-up closes", () => {
    // Owner, 2026-11-05: My discoveries closed and its left neighbour came forward instead of Compare.
    tabStore.open("boxels");
    tabStore.open("myExo");
    const close = vi.fn();
    showPickedSystem(close);
    expect(tabStore.get()).toMatchObject({ tabs: ["boxels", "myExo"], active: "main" });
    expect(close).not.toHaveBeenCalled();
    tabStore.setOn(false);
    showPickedSystem(close);
    expect(close).toHaveBeenCalledOnce();
  });

  it("in Colonize's window a picked system opens Compare's system map, through the app window", async () => {
    const showInMain = vi.fn(async () => true);
    const bridge = { report: vi.fn(), registry: async () => ({}), focus: async () => false, showInMain, on: () => () => {} };
    (window as unknown as { edexoElectron?: unknown }).edexoElectron = { tabs: bridge };
    window.history.replaceState(null, "", "/?screen=colonize");
    try {
      vi.resetModules();
      const colonize = await import("../src/client/tabs/tabStore.js");
      colonize.tabStore.open("myExo");
      colonize.showPickedSystem(vi.fn());
      expect(showInMain).toHaveBeenCalledWith("systemMap");
      expect(colonize.tabStore.get().active).toBe("myExo");
    } finally {
      delete (window as unknown as { edexoElectron?: unknown }).edexoElectron;
      window.history.replaceState(null, "", "/");
    }
  });
});
