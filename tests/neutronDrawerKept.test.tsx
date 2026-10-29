// @vitest-environment jsdom
/**
 * The Neutron drawer keeps its plan while another galaxy map drawer is open (owner, 2026-10-28: "click on some other
 * tab (i.e. Layers) … it forgets the whole route", its line still on the map). The map unmounts the drawer it is not
 * showing; opening it again shows the same stops, numbers and route, and draws the route's line again.
 * And the ship's range follows the ship (a refit) until it is typed over.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../src/client/serverChanges", () => ({ onServerChange: () => () => {} }));

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let ship = { rangeLy: 60, jumpsPerTank: 8 };
const route = {
  hops: [
    { name: "Sol", x: 0, y: 0, z: 0, kind: "start", jumps: 0, boosted: 0, distanceLy: 0, refuel: false, scoopOnWay: false, scoopLs: null, jumpsLeft: 8, fsdHealth: 1 },
    { name: "Colonia", x: 900, y: 0, z: 0, kind: "waypoint", jumps: 4, boosted: 1, distanceLy: 900, refuel: false, scoopOnWay: false, scoopLs: null, jumpsLeft: 4, fsdHealth: 0.99 },
  ],
  jumps: 4,
  boosted: 1,
  distanceLy: 900,
  plainJumps: 15,
  refuels: 0,
  repairBefore: null,
  unsafeLegs: [],
  waypoints: [
    { name: "Sol", x: 0, y: 0, z: 0 },
    { name: "Colonia", x: 900, y: 0, z: 0 },
  ],
  ms: 3,
};

/** A plan answer held back until the test lets it go (a plan that takes seconds). */
let held: { release: () => void } | null = null;
let planAnswer: unknown = route;

function answer(url: string): unknown {
  if (url.startsWith("/api/neutron/status"))
    return {
      present: true,
      neutrons: 1,
      dump: null,
      downloading: null,
      error: null,
      release: null,
      ship: {
        ...ship,
        jumpsNow: 8,
        fsdHealth: 1,
        wearPerBoost: 0.01,
        wearIsDefault: true,
        wearFrom: "default",
        boostFactor: 4,
        shipKnown: true,
        shipType: "asp",
        fsdWarn: 0.8,
        position: { x: 0, y: 0, z: 0 },
        system: "Sol",
      },
    };
  if (url.startsWith("/api/neutron/live")) return { active: false, view: null, hops: null, version: 0 };
  if (url.startsWith("/api/galaxy/find")) return { systems: [{ name: "Colonia", x: 900, y: 0, z: 0 }] };
  if (url.startsWith("/api/neutron/plan")) return planAnswer;
  return {};
}

let root: Root | null = null;
let host: HTMLDivElement;
const onRoute = vi.fn();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Element.prototype.scrollIntoView ??= () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/neutron/plan") && held) await new Promise<void>((r) => (held!.release = r));
      return { ok: true, status: 200, json: async () => answer(url) };
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

const settle = async (ms = 0) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};
async function mount() {
  const { NeutronDrawer } = await import("../src/client/NeutronDrawer");
  root = createRoot(host);
  act(() => root!.render(createElement(NeutronDrawer, { onRoute, onFocus: () => {} })));
  await settle();
  await settle();
}
function unmount() {
  act(() => root?.unmount());
  root = null;
}
function type(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const rangeField = () => host.querySelector<HTMLInputElement>('input[aria-label="Jump range (ly)"]')!;
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe("Neutron drawer", () => {
  it("keeps the stops and the route through another drawer, and draws its line again", async () => {
    await mount();
    expect(rangeField().value).toBe("60.0");
    act(() => host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!.click());
    type(host.querySelector<HTMLInputElement>('input[role="combobox"]')!, "Colonia");
    await settle(300);
    act(() => host.querySelector<HTMLLIElement>('li[role="option"]')!.click());
    expect(host.querySelector(".g3d-neutron-stops")!.textContent).toContain("Colonia");
    act(() => button("Plan").click());
    await settle();
    expect(host.querySelector(".g3d-neutron-table")).not.toBeNull();

    unmount(); // Layers opened
    onRoute.mockClear();
    await mount(); // back to Neutron

    expect(host.querySelector(".g3d-neutron-stops")!.textContent).toContain("Colonia");
    expect(host.querySelector(".g3d-neutron-table")!.textContent).toContain("Colonia");
    // The stops go to the map with what each one is (its dots, owner 2026-10-28), and stay kept for the map itself.
    expect(onRoute).toHaveBeenCalledWith(route.hops);
    const { keptNeutronMarks } = await import("../src/client/galaxy3d/neutronMarks");
    expect(keptNeutronMarks()).toEqual(route.hops);
  });

  it("follows the ship's range after a refit, until it is typed over", async () => {
    ship = { rangeLy: 55, jumpsPerTank: 7 };
    await mount();
    expect(rangeField().value).toBe("55.0"); // was 60.0 from the ship: follows
    type(rangeField(), "50");
    unmount();
    ship = { rangeLy: 52, jumpsPerTank: 7 };
    await mount();
    expect(rangeField().value).toBe("50"); // typed: kept
  });

  it("shows a plan that came back after its drawer was closed for another (2026-10-29)", async () => {
    const later = { ...route, hops: [route.hops[0]!, { ...route.hops[1]!, name: "Jaques", jumps: 3 }], jumps: 3 };
    planAnswer = later;
    held = { release: () => {} };
    await mount();
    act(() => button("Plan").click());
    await settle();
    unmount(); // Layers opened while the plan runs
    onRoute.mockClear();
    await mount(); // back to Neutron before the answer
    act(() => held!.release());
    held = null;
    await settle();
    await settle();
    expect(host.querySelector(".g3d-neutron-table")!.textContent).toContain("Jaques");
    expect(button("Plan").disabled).toBe(false);
    const { keptNeutronMarks } = await import("../src/client/galaxy3d/neutronMarks");
    expect(keptNeutronMarks()).toEqual(later.hops);
  });
});
