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
let liveAnswer: unknown = { active: false, view: null, hops: null, version: 0 };
/** The neutron stars downloaded. */
let present = true;

function answer(url: string): unknown {
  if (url.startsWith("/api/neutron/status"))
    return {
      present,
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
  if (url.startsWith("/api/neutron/live")) return liveAnswer;
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
      // A fresh object each time, as a real answer is.
      return { ok: true, status: 200, json: async () => structuredClone(answer(url)) };
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

  /*
    A guild mate's report (2026-11-05): flying to Colonia, stop 7 of 25, the next stop on the clipboard and the line on
    the map, but no jumps in the drawer. A re-plot in flight (or a route started from the Spansh drawer, or kept over a
    restart) is a new live version: the drawer's own plan table goes, and the route being flown is listed instead.
  */
  it("lists the stops ahead of a route re-plotted in flight", async () => {
    const hop = (name: string, x: number, kind: string, boosted: number, refuel = false) => ({
      name, x, y: 0, z: 0, kind, jumps: 1, boosted, refuel, scoopLs: refuel ? 40 : null, scoopOnWay: false,
    });
    const hops = [hop("Sol", 0, "start", 0), hop("N1", 300, "neutron", 1), hop("N2", 600, "neutron", 1, true), hop("Colonia", 900, "waypoint", 1)];
    liveAnswer = { active: true, view: { at: 1, total: 3, next: "N2", destination: "Colonia", done: false, replanning: false }, hops, version: 7 };
    await mount();
    const rows = [...host.querySelectorAll("[data-testid=g3d-neutron-live] tbody tr")].map((r) => r.textContent ?? "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("N2");
    expect(rows[0]).toContain("next");
    expect(rows[0]).toContain("scoop (40 ls)");
    expect(rows[1]).toContain("Colonia");

    // Without the neutron stars downloaded (a Spansh route on a fresh install): still listed, with its Stop.
    unmount();
    present = false;
    await mount();
    expect(host.textContent).toContain("Download neutron stars");
    expect(host.querySelectorAll("[data-testid=g3d-neutron-live] tbody tr")).toHaveLength(2);
    expect(button("Stop flying")).toBeDefined();
    present = true;
    liveAnswer = { active: false, view: null, hops: null, version: 0 };
  });

  it("keeps a plan that was not flown when the route being flown is re-plotted (review 2026-11-05)", async () => {
    unmount();
    planAnswer = route;
    await mount();
    act(() => button("Plan").click());
    await settle();
    expect(host.querySelector(".g3d-neutron-table")!.textContent).toContain("Colonia");
    // Another route is flown and re-plotted meanwhile: a new live version.
    const hops = [route.hops[0]!, { ...route.hops[1]!, name: "Jaques" }];
    liveAnswer = { active: true, view: { at: 0, total: 1, next: "Jaques", destination: "Jaques", done: false, replanning: false }, hops, version: 99 };
    unmount();
    await mount();
    const tables = [...host.querySelectorAll(".g3d-neutron-table")].map((t) => t.textContent ?? "");
    expect(tables.some((t) => t.includes("Jaques"))).toBe(true); // the route being flown, its stops ahead
    expect(tables.some((t) => t.includes("Colonia"))).toBe(true); // the plan, kept
    liveAnswer = { active: false, view: null, hops: null, version: 0 };
  });

  it("lists a plan flown from here in its own table, the next hop marked, not in a second one (review P8)", async () => {
    planAnswer = route;
    const { handToNeutron } = await import("../src/client/NeutronDrawer");
    handToNeutron([{ name: "Colonia", x: 900, y: 0, z: 0 }]);
    liveAnswer = { active: true, view: { at: 0, total: 1, next: "Colonia", destination: "Colonia", done: false, replanning: false }, hops: route.hops, version: 100 };
    await mount();
    act(() => button("Plan").click());
    await settle();
    act(() => button("Fly this route").click());
    await settle();
    const tables = host.querySelectorAll(".g3d-neutron-table");
    expect(tables).toHaveLength(1);
    expect(host.querySelector('[data-testid="g3d-neutron-live"]')).toBeNull();
    expect(host.querySelector(".g3d-neutron-table tr.is-next")?.textContent).toContain("Colonia");
    liveAnswer = { active: false, view: null, hops: null, version: 0 };
  });

  it("takes a Spansh route's ends handed over, dropping the start when the ship is there (review P12)", async () => {
    const { handToNeutron } = await import("../src/client/NeutronDrawer");
    handToNeutron([
      { name: "Sol", x: 0, y: 0, z: 0 },
      { name: "Beagle Point", x: -1111, y: -134, z: 65269 },
    ]);
    await mount();
    await settle();
    const stops = host.querySelector(".g3d-neutron-stops")!.textContent ?? "";
    expect(stops).toContain("Beagle Point");
    expect(stops).not.toMatch(/Sol.*Beagle/); // the ship is in Sol: the plan starts there already
    expect(host.querySelector(".g3d-neutron-table")).toBeNull(); // the plan before is gone
    unmount();
    // Somewhere else: both stay.
    handToNeutron([
      { name: "Colonia", x: 900, y: 0, z: 0 },
      { name: "Beagle Point", x: -1111, y: -134, z: 65269 },
    ]);
    await mount();
    await settle();
    expect(host.querySelector(".g3d-neutron-stops")!.textContent).toMatch(/Colonia.*Beagle Point/);
  });
});
