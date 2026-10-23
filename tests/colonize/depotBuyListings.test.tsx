/**
 * @vitest-environment jsdom
 *
 * "Saved sellers" says why it found nothing (audit 2026-10-22): the reason went to an optional callback nobody passed,
 * so the button did nothing visible. The hook now holds the note for the view to show.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const listings = vi.fn();
vi.mock("../../src/client/colonize/api", () => ({ colonizeApi: { getDepotMaterialListings: (...a: unknown[]) => listings(...a) } }));

const { useDepotBuyListings } = await import("../../src/client/colonize/planner/hooks/useDepotBuyListings");
type Result = ReturnType<typeof useDepotBuyListings>;

let seen: Result | null = null;
function Probe() {
  seen = useDepotBuyListings({
    isActive: true,
    depotNeeds: [],
    activeDepots: [],
    constructionRefSystems: ["Hub"],
    constructionSiteSystems: ["Site"],
    homeSystem: "",
    systemDistanceLy: {},
    buyIndexRefreshToken: 0,
  });
  return null;
}

const item = { id: "steel", label: "Steel", quantityTons: 400 } as Parameters<Result["fetchMissingMaterialLocally"]>[0];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  listings.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
  act(() => root.render(<Probe />));
});
afterEach(() => act(() => root.unmount()));

describe("Saved sellers", () => {
  it("says when nothing is saved within range", async () => {
    listings.mockResolvedValue({ ok: true, listings: [{ id: "steel", label: "Steel", stations: [] }] });
    await act(async () => seen!.fetchMissingMaterialLocally(item));
    expect(seen!.localFetchNotice).toMatch(/not found in scan range.*Steel/);
    expect(listings.mock.calls[0]![0]).toMatchObject({ referenceSystem: "Hub", distanceOrigin: "Site" });
  });

  it("says what went wrong when the server could not be asked", async () => {
    listings.mockRejectedValue(new Error("The server answered 503."));
    await act(async () => seen!.fetchMissingMaterialLocally(item));
    expect(seen!.localFetchNotice).toBe("Could not look up Steel: The server answered 503.");
  });
});
