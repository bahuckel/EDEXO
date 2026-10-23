/**
 * @vitest-environment jsdom
 *
 * The Colonize window's shell and its views (audit 2026-10-22). Compare's live snapshot and the colonize socket's app
 * state change several times a second while flying, and only the shared header and the tray read them: a push redraws
 * those, not the Colonize views. And a redraw for another window's change ("Show the changes", or at once while this
 * window is behind) remounts the Colonize tree but keeps Compare's live snapshot and its socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useEffect, useState, useSyncExternalStore } from "react";

const count = { liveMounts: 0, colonizeMounts: 0, plan: 0, header: 0 };
let pushLive: ((n: number) => void) | null = null;
let remoteChange: (() => void) | null = null;

/* The colonize socket's app state, as a little store a test can change. */
let appState = { state: { commanderName: "Smoke", currentSystem: "Smoke Colony" }, connected: true };
const appSubs = new Set<() => void>();
const setAppState = (next: typeof appState) => {
  appState = next;
  for (const s of appSubs) s();
};

vi.mock("../../src/client/colonize/api", () => ({
  colonizeApi: {},
  colonizeReadOnly: () => false,
  ColonizeRequestError: class extends Error {},
  useColonizeAppState: () =>
    useSyncExternalStore(
      (fn) => {
        appSubs.add(fn);
        return () => appSubs.delete(fn);
      },
      () => appState,
    ),
}));

/* Compare's live snapshot: counts its mounts (one socket each) and takes pushes from the test. */
vi.mock("../../src/client/useLiveSnapshot", async (orig) => ({
  ...(await orig<typeof import("../../src/client/useLiveSnapshot")>()),
  useLiveSnapshot: () => {
    const [snapshot, setSnapshot] = useState({ commanderName: "Smoke", bodies: [], n: 0 });
    useEffect(() => {
      count.liveMounts++;
      pushLive = (n) => setSnapshot({ commanderName: "Smoke", bodies: [], n });
    }, []);
    return { snapshot, connected: true };
  },
}));

vi.mock("../../src/client/HeaderBar", () => ({
  HeaderBar: ({ trayContent }: { trayContent?: unknown }) => {
    count.header++;
    return <header data-testid="shell-bar">{trayContent as never}</header>;
  },
}));

/* The Colonize model: one object, so ColonizeApp redraws only when the test remounts it. */
const model = {
  snap: {
    liveDocked: null,
    activeDepots: [],
    navContext: { starSystem: "Smoke Colony" },
    wingRoster: [],
    replayBusy: false,
    lastError: null,
    shipCargoCapacity: 784,
  },
  carriers: [],
  haulingCarrierIds: new Set<string>(),
  toggleCarrier: () => undefined,
  stations: { checkoutBundle: null },
  shopHistory: [],
  cargoOnHand: 0,
  capacity: 784,
  manualCapacity: null,
  setCapacity: () => undefined,
  inaraNotice: null,
  dismissInaraNotice: () => undefined,
};
vi.mock("../../src/client/colonize/useColonize", () => ({
  useColonize: () => {
    useEffect(() => {
      count.colonizeMounts++;
    }, []);
    return model;
  },
}));

vi.mock("../../src/client/colonize/views/PlanView", () => ({
  PlanView: () => {
    count.plan++;
    return <div data-testid="plan">The plan</div>;
  },
}));
// The other tabs have their own tests (colonizeScreen.test.tsx); here they only need to be there.
vi.mock("../../src/client/colonize/views/SearchView", () => ({ SearchView: () => <div>Search</div> }));
vi.mock("../../src/client/colonize/views/SourcesView", () => ({ SourcesView: () => <div>Sources</div> }));
vi.mock("../../src/client/colonize/views/WingView", () => ({ WingView: () => <div>Wing</div> }));

vi.mock("../../src/client/colonize/uiStateSync", () => ({
  loadColonizeUiState: () => Promise.resolve("local"),
  onRemoteUiState: (fn: () => void) => {
    remoteChange = fn;
    return () => {
      remoteChange = null;
    };
  },
}));

const { ColonizeScreen } = await import("../../src/client/colonize/ColonizeScreen");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  Object.assign(count, { liveMounts: 0, colonizeMounts: 0, plan: 0, header: 0 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}

describe("the Colonize shell", () => {
  it("a Compare push or a colonize app-state frame redraws the header, not the Colonize views", async () => {
    act(() => root.render(<ColonizeScreen />));
    await settle();
    expect(host.querySelector("[data-testid='plan']")).toBeTruthy();
    const plan = count.plan;
    const header = count.header;
    for (let n = 1; n <= 3; n++) act(() => pushLive!(n));
    act(() => setAppState({ ...appState, connected: false }));
    expect(count.header).toBeGreaterThanOrEqual(header + 4);
    expect(count.plan).toBe(plan);
    // The tray reads the app state, and still follows it.
    expect(host.querySelector("[data-testid='shell-bar']")?.textContent).toContain("Reconnecting…");
    act(() => setAppState({ ...appState, connected: true }));
    expect(host.querySelector("[data-testid='shell-bar']")?.textContent).not.toContain("Reconnecting…");
    expect(count.plan).toBe(plan);
  });

  it("a redraw for another window's change remounts the Colonize views and keeps Compare's live snapshot", async () => {
    act(() => root.render(<ColonizeScreen />));
    await settle();
    expect([count.liveMounts, count.colonizeMounts]).toEqual([1, 1]);
    // Behind other windows: redrawn at once.
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    act(() => remoteChange!());
    await settle();
    expect([count.liveMounts, count.colonizeMounts]).toEqual([1, 2]);
    expect(host.querySelector("[data-testid='plan']")).toBeTruthy();
    // In front: a note offers it, and "Show the changes" redraws.
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    act(() => remoteChange!());
    const show = [...host.querySelectorAll("button")].find((b) => b.textContent === "Show the changes");
    expect(show).toBeTruthy();
    act(() => show!.click());
    await settle();
    expect([count.liveMounts, count.colonizeMounts]).toEqual([1, 3]);
    expect(host.textContent).not.toContain("Another window changed your plan");
  });

  it("the section tabs are one Tab stop, and the arrow keys move and choose", async () => {
    act(() => root.render(<ColonizeScreen />));
    await settle();
    const tabs = () => [...host.querySelectorAll<HTMLButtonElement>("[aria-label='Colonize sections'] [role=tab]")];
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
    tabs()[0]!.focus();
    act(() => {
      tabs()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    await settle();
    expect(document.activeElement?.textContent).toContain("Wing");
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "false", "false", "true"]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, -1, 0]);
  });
});
