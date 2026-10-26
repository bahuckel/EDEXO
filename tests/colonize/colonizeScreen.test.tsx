/**
 * @vitest-environment jsdom
 *
 * The Colonize window (1.3.0) drawn against a stubbed server: a site being built, docked at it with cargo aboard,
 * one of your carriers. Each tab draws without throwing, and the things a commander reads first are on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ColonizeSnapshot, DepotSnapshot } from "../../src/shared/colonize/types";
import { IDLE_MATERIAL_BUY_SCAN_STATUS } from "../../src/shared/colonize/materialBuyScanStatus";

const site: DepotSnapshot = {
  marketId: "3950000001",
  starSystem: "Smoke Colony",
  systemAddress: 1,
  stationName: "Orbital Construction Site: Hammond Port",
  constructionSiteLabel: "Hammond Port",
  progress: 0.25,
  complete: false,
  failed: false,
  lastTimestamp: "2026-10-20T10:00:00Z",
  resources: [
    { name: "$steel_name;", nameLocalised: "Steel", required: 4000, provided: 1000, payment: 5000 },
    { name: "$aluminium_name;", nameLocalised: "Aluminium", required: 1200, provided: 1200, payment: 3000 },
    { name: "$cmmcomposite_name;", nameLocalised: "CMM Composite", required: 3000, provided: 700, payment: 6000 },
  ],
  contributions: [],
  progressHistory: [],
  contributionProgressHistory: [],
};

const elsewhere: DepotSnapshot = { ...site, marketId: "3950000002", starSystem: "Other Colony", systemAddress: 2, constructionSiteLabel: "Their Port", stationName: "Orbital Construction Site: Their Port" };

const snapshot = {
  ownColonies: [{ name: "Smoke Colony", systemAddress: 1, claimedAt: "2026-05-15T19:04:23Z" }],
  journalDir: "journals",
  journalDirConfigured: true,
  edsmApiKeyPresent: false,
  wingRoster: [],
  carriers: [
    {
      carrierId: "3700000001",
      kind: "fleet",
      name: "Smoke Hauler",
      callsign: "ABC-123",
      tonsByCommodity: { steel: 500 },
      labels: { steel: "Steel" },
      reportedTons: 500,
      capacityTons: 25000,
      lastEventIso: "2026-10-20T09:00:00Z",
    },
  ],
  liveJournalPath: null,
  activeDepots: [site, elsewhere],
  completedDepots: [],
  archivedDepots: [],
  liveDocked: { marketId: site.marketId, stationName: site.stationName!, starSystem: "Smoke Colony", timestamp: "2026-10-20T10:00:00Z" },
  navContext: { starSystem: "Smoke Colony", systemAddress: 1 },
  lastDockedEconomy: null,
  shipCargo: [{ name: "steel", nameLocalised: "Steel", count: 300 }],
  shipCargoTimestamp: "2026-10-20T10:00:00Z",
  shipCargoCapacity: 784,
  dockMarket: null,
  journalShopHistory: [],
  replayBusy: false,
  lastError: null,
} as unknown as ColonizeSnapshot;

/* Every contract method: the snapshot and a few answers, an empty "ok" for the rest (nothing saved, no network). */
const answers: Record<string, unknown> = {
  getSnapshot: snapshot,
  getMaterialBuyScanStatus: IDLE_MATERIAL_BUY_SCAN_STATUS,
  getInaraImportDir: { ok: true, dir: "inara", defaultDir: "inara" },
  resolveSystems: { ok: true, coords: {}, distances: {} },
  getDepotMaterialListings: { ok: true, listings: [] },
  searchBuyIndexStationsForMaterials: { ok: true, stations: [] },
};
const called: string[] = [];
vi.mock("../../src/client/colonize/api", () => {
  const listen = () => () => {};
  const api = new Proxy(
    { onUpdate: listen, onMaterialBuyScanStatus: listen, onInaraImport: listen } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        return (..._args: unknown[]) => {
          called.push(prop);
          return Promise.resolve(prop in answers ? answers[prop] : { ok: true });
        };
      },
    },
  );
  return {
    colonizeApi: api,
    colonizeReadOnly: () => false, // the PC's window (the phone's has phoneView.test.tsx)
    ColonizeRequestError: class extends Error {},
    useColonizeAppState: () => ({ state: { commanderName: "Smoke", currentSystem: "Smoke Colony" }, connected: true }),
  };
});

// The server's copy of settings and progress has its own test (uiStateSync.test.ts): here there is none.
// Compare's shell (C3): its live snapshot, and its app bar reduced to the tray Colonize hands it.
vi.mock("../../src/client/useLiveSnapshot", async (orig) => ({
  ...(await orig<typeof import("../../src/client/useLiveSnapshot")>()),
  useLiveSnapshot: () => ({ snapshot: { commanderName: "Smoke", bodies: [] }, connected: true }),
}));
vi.mock("../../src/client/HeaderBar", () => ({
  HeaderBar: ({ trayContent }: { trayContent?: unknown }) => <header data-testid="shell-bar">{trayContent as never}</header>,
}));

vi.mock("../../src/client/colonize/uiStateSync", () => ({
  loadColonizeUiState: () => Promise.resolve("local"),
  onRemoteUiState: () => () => {},
}));

const { ColonizeScreen } = await import("../../src/client/colonize/ColonizeScreen");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  called.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}
const tab = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((b) => b.textContent?.trim().startsWith(name));

describe("the Colonize window", () => {
  it("opens on the plan: the site with its progress, what to deliver while docked there", async () => {
    act(() => root.render(<ColonizeScreen />));
    await settle();
    const text = host.textContent ?? "";
    expect(called).toContain("getSnapshot");
    expect(text).toContain("Hammond Port");
    expect(text).toContain("25%");
    // Docked at the site with 300 t of steel aboard: deliver all of it (3,000 t still needed).
    expect(text).toContain("Docked at your site");
    // The cards (R5b): "Unload now", then a tile per material aboard.
    expect(text).toContain("Unload now");
    expect(text).toMatch(/Steel\s*Deliver 300 t/);
    // Whose system each site is in, and the colonies with what was built there.
    expect(host.querySelector("article[aria-label='Hammond Port']")?.textContent).toContain("Your colony");
    expect(host.querySelector("article[aria-label='Their Port']")?.textContent).toContain("Helping");
    const colonies = host.querySelector("[data-testid='colonies']")?.textContent ?? "";
    expect(colonies).toContain("Your colonies (1)");
    expect(colonies).toContain("Smoke Colony");
    expect(colonies).toContain("claimed 2026-05-15");
    expect(colonies).toContain("1 building");
    // Aluminium is delivered in full, so it is not among the needs shown on the card (only in its folded list).
    expect(host.querySelector("article[aria-label='Hammond Port'] > .cz-mats")?.textContent).not.toContain("Aluminium");
  });

  it("a commander with no claim sees every site as Helping, and how to hide one (guild member, 2026-10-25)", async () => {
    answers.getSnapshot = { ...snapshot, ownColonies: [] };
    try {
      act(() => root.render(<ColonizeScreen />));
      await settle();
      for (const name of ["Hammond Port", "Their Port"]) {
        const chip = [...host.querySelectorAll(`article[aria-label='${name}'] .sys-chip`)].find((c) => c.textContent === "Helping");
        expect(chip?.getAttribute("title"), name).toMatch(/No claim of yours.*Put away/);
      }
      expect(host.textContent).not.toContain("Your colony");
      expect(host.querySelector("[data-testid='colonies']")).toBeNull();
    } finally {
      answers.getSnapshot = snapshot;
    }
  });

  it("draws every tab", async () => {
    act(() => root.render(<ColonizeScreen />));
    await settle();
    for (const [name, expectText] of [
      ["Search", "Commodity"],
      ["Sources", "Smoke Hauler"],
      ["Wing", "Who hauls what"],
    ] as const) {
      const b = tab(name);
      expect(b, name).toBeTruthy();
      act(() => b!.click());
      await settle();
      expect(host.textContent, name).toContain(expectText);
    }
  });

  it("searches saved sellers for a commodity and says when nothing matches", async () => {
    act(() => root.render(<ColonizeScreen />));
    await settle();
    act(() => tab("Search")!.click());
    await settle();
    const input = host.querySelector<HTMLInputElement>("input[type=search]")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(input, "Steel");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => input.form!.requestSubmit());
    await settle();
    expect(called).toContain("searchBuyIndexStationsForMaterials");
    expect(host.textContent).toContain("Nothing in your journal or the saved sellers matches");
  });
});
