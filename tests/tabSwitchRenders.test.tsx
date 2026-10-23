// @vitest-environment jsdom
/**
 * The first tab switch after a start was slow (owner, 2026-10-09): the header, which holds every screen,
 * read the whole tab state, so each switch rendered it and every open screen again (95-425 ms a switch
 * in the dev build, 2-6 ms after). A screen's open state and its slot read only their own slice. A
 * tab's screen starts the first time its tab is in front, not when the tab is restored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useEffect } from "react";
import { tabStore } from "../src/client/tabs/tabStore.js";
import { TabSlot, useScreenOpen } from "../src/client/tabs/TabHost.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  localStorage.clear();
  tabStore.resetForTests();
});

describe("switching tabs", () => {
  it("does not render a screen's owner or its slot again", () => {
    let owner = 0;
    let screen = 0;
    function Screen() {
      screen++;
      return <p>boxels</p>;
    }
    function Owner() {
      owner++;
      const [open] = useScreenOpen("boxels");
      return open ? (
        <TabSlot kind="boxels">
          <Screen />
        </TabSlot>
      ) : null;
    }
    const pane = document.createElement("div");
    document.body.append(pane);
    const root = createRoot(document.createElement("div"));
    act(() => {
      tabStore.open("boxels");
      tabStore.open("galaxy");
      tabStore.setPane("boxels", pane);
      root.render(<Owner />);
    });
    // Restored behind another tab: not started until it comes to the front (owner, 2026-10-09).
    expect(pane.textContent).toBe("");
    expect(screen).toBe(0);
    act(() => tabStore.activate("boxels"));
    expect(pane.textContent).toBe("boxels");
    const [o, s] = [owner, screen];

    act(() => tabStore.activate("main"));
    act(() => tabStore.activate("galaxy"));
    act(() => tabStore.activate("boxels"));
    act(() => tabStore.activate("main"));
    expect([owner, screen]).toEqual([o, s]);
    // Started, it stays while another tab is in front.
    expect(pane.textContent).toBe("boxels");

    // Closing it still reaches the owner.
    act(() => tabStore.close("boxels"));
    expect(owner).toBe(o + 1);
    expect(pane.textContent).toBe("");
    act(() => root.unmount());
  });
});

describe("a tab left behind", () => {
  afterEach(() => vi.useRealTimers());
  it("lets its screen go after releaseAfterMs, and starts it afresh when it comes back (discuss item 23)", () => {
    vi.useFakeTimers();
    let mounts = 0;
    function Screen() {
      // Once per mount, not per render.
      useEffect(() => {
        mounts++;
      }, []);
      return <p>map</p>;
    }
    const pane = document.createElement("div");
    document.body.append(pane);
    const root = createRoot(document.createElement("div"));
    act(() => {
      tabStore.open("boxels");
      tabStore.setPane("boxels", pane);
      tabStore.activate("boxels");
      root.render(
        <TabSlot kind="boxels" releaseAfterMs={1000}>
          <Screen />
        </TabSlot>,
      );
    });
    expect(pane.textContent).toBe("map");
    expect(mounts).toBe(1);
    act(() => tabStore.activate("main"));
    act(() => vi.advanceTimersByTime(999));
    expect(pane.textContent).toBe("map");
    act(() => vi.advanceTimersByTime(1));
    expect(pane.textContent).toBe("");
    act(() => tabStore.activate("boxels"));
    expect(pane.textContent).toBe("map");
    expect(mounts).toBe(2);
    act(() => root.unmount());
  });
});
