/**
 * @vitest-environment jsdom
 * The pre-release review of 2026-10-24, client side: a wing sync keeps what changed while it was out, and the "Find
 * colony sites" link keeps its own behaviour when there is no Galaxy tab to open here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mergeWingSync, type WingMember } from "../../src/shared/colonize/wingManifest";
import { onGalaxyDrawerLinkClick, peekGalaxyDrawer, takeGalaxyDrawer } from "../../src/client/galaxyDrawerRequest";
import { tabStore } from "../../src/client/tabs/tabStore";

const member = (name: string, tons: number): WingMember => ({
  id: `wing-${name}`,
  name,
  color: "#ff7a24",
  claims: tons ? [{ commodityId: "steel", label: "Steel", tons }] : [],
});

describe("mergeWingSync", () => {
  it("takes the sync's claims for members nobody touched meanwhile", () => {
    const before = [member("A", 100)];
    expect(mergeWingSync(before, before, [member("A", 0)])).toEqual([member("A", 0)]);
  });

  it("keeps a claim typed in, a member added, and a member removed while EDSM was asked", () => {
    const before = [member("A", 100), member("B", 50)];
    const now = [member("A", 400), member("C", 10)];
    const synced = [member("A", 0), member("B", 0)];
    expect(mergeWingSync(before, now, synced)).toEqual([member("A", 400), member("C", 10)]);
  });
});

describe("Find colony sites", () => {
  afterEach(() => tabStore.setOn(true));
  const click = () => {
    let prevented = false;
    onGalaxyDrawerLinkClick("finder")({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  };

  it("opens the map in a window of its own when tab view is off", () => {
    tabStore.setOn(false);
    expect(click()).toBe(false);
  });

  it("opens the Galaxy tab when tab view is on", () => {
    tabStore.setOn(true);
    expect(click()).toBe(true);
  });

  /*
    The map's first render can be thrown away (its Finder chunk suspends it) and run again: a render that took the
    request left the next one without it, and the map opened with no Finder (e2e, 2026-10-24). Renders peek; the map
    takes it once it is on screen.
  */
  it("keeps the request through any number of renders until the map takes it", () => {
    tabStore.setOn(true);
    expect(click()).toBe(true);
    expect(peekGalaxyDrawer()).toBe("finder");
    expect(peekGalaxyDrawer()).toBe("finder");
    expect(takeGalaxyDrawer()).toBe("finder");
    expect(peekGalaxyDrawer()).toBeNull();
  });
});
