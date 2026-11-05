// @vitest-environment jsdom
/**
 * The Spansh drawer and the route being flown (owner, 2026-11-05): one banner and one Stop for both drawers (review
 * P10; the bare "Stop" could end a Neutron route unseen), and a route only being read keeps off the map's line while
 * another is flown (Q2: "No" to a second line).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../src/client/serverChanges", () => ({ onServerChange: () => () => {} }));

const stop = (name: string, x: number, jumps: number) => ({
  name,
  id64: null,
  x,
  y: 0,
  z: 0,
  jumps,
  neutron: false,
  refuel: false,
  inject: false,
  valueCr: 0,
  bodies: [],
});
const ROUTE = {
  job: "6418B058-0000-4000-8000-000000000001",
  kind: "neutron",
  from: "Sol",
  to: "Colonia",
  rangeLy: 60,
  stops: [stop("Sol", 0, 0), stop("PSR A", 400, 1), stop("Colonia", 900, 2)],
  totalJumps: 3,
  totalValueCr: 0,
  url: "",
};
const flying = {
  active: true,
  view: { at: 2, total: 9, next: "PSR B", destination: "Beagle Point", replanning: false, progress: { jump: 2, jumps: 9, dest: 0, dests: 1, stop: 2, stops: 9 } },
  hops: [],
  version: 3,
};
let live: unknown = flying;
const posts: unknown[] = [];

let root: Root | null = null;
let host: HTMLDivElement;
const onRoute = vi.fn();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  live = flying;
  posts.length = 0;
  onRoute.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/neutron/live") && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        live = { active: false, view: null, hops: null, version: 4 };
        return { ok: true, status: 200, json: async () => live };
      }
      const body = url.startsWith("/api/neutron/live")
        ? live
        : url.startsWith("/api/spansh-route/saved")
          ? { routes: [] }
          : url.startsWith("/api/spansh-route")
            ? { state: "ok", route: ROUTE }
            : {};
      return { ok: true, status: 200, json: async () => body };
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

const settle = async () => {
  for (let i = 0; i < 3; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
};
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

async function mount() {
  const { SpanshRouteDrawer } = await import("../src/client/galaxy3d/SpanshRouteDrawer");
  root = createRoot(host);
  act(() => root!.render(createElement(SpanshRouteDrawer, { onRoute, onFocus: () => {} })));
  await settle();
}
async function read() {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Spansh link"]')!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, ROUTE.job);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => button("Read from Spansh")!.click());
  await settle();
}

describe("the Spansh drawer while a route is flown", () => {
  it("shows the route being flown with the one Stop, and no bare Stop", async () => {
    await mount();
    const banner = host.querySelector('[data-testid="g3d-live-route"]')!;
    expect(banner.textContent).toContain("Beagle Point");
    expect(banner.textContent).toContain("jump 2 of 9 · destination 0 of 1");
    expect(button("Stop")).toBeUndefined();
    act(() => button("■ Stop flying this route")!.click());
    await settle();
    expect(posts).toEqual([{ stop: true }]);
    expect(host.querySelector('[data-testid="g3d-live-route"]')).toBeNull();
  });

  it("reads a route without drawing it over the flown one, and draws it once the flown one is stopped", async () => {
    await mount();
    await read();
    expect(onRoute).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Not drawn on the map");
    act(() => button("■ Stop flying this route")!.click());
    await settle();
    expect(onRoute).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ name: "Colonia" })]));
  });

  it("draws a route read with nothing flown", async () => {
    live = { active: false, view: null, hops: null, version: 0 };
    await mount();
    await read();
    expect(onRoute).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="g3d-live-route"]')).toBeNull();
  });
});
