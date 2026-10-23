/**
 * @vitest-environment jsdom
 *
 * Search (audit 2026-10-22): the distance shown is from your sites, read by the site-to-seller pairs the distance
 * look-up stores (it was read by plain name and always missed); and a picked station's market is the one picked, even
 * when an earlier pick's answer comes back last (the fetch ran during render and nothing checked).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { BuyIndexStationMaterial, BuyIndexStationResult } from "../../src/shared/colonize/buyIndexSearchTypes";
import { galaxyDistancePairKey } from "../../src/shared/colonize/systemDistanceLy";
import type { ColonizeModel } from "../../src/client/colonize/useColonize";
import { SearchView } from "../../src/client/colonize/views/SearchView";

const station = (stationName: string, systemName: string, minDistanceLy: number): BuyIndexStationResult => ({
  systemName,
  stationName,
  marketId: stationName,
  bodyName: null,
  stationType: "Coriolis Starport",
  isPlanetaryOrGround: false,
  materialCount: 1,
  minDistanceLy,
});
const row = (label: string): BuyIndexStationMaterial =>
  ({ commodityId: label.toLowerCase(), label, buyPrice: 100, supply: 5_000, distanceLy: null }) as unknown as BuyIndexStationMaterial;

type Catalog = { ok: true; materials: BuyIndexStationMaterial[] };
const pending = new Map<string, (r: Catalog) => void>();

function model(): ColonizeModel {
  const api = {
    searchBuyIndexStationsForMaterials: () =>
      Promise.resolve({ ok: true, stations: [station("Alpha Port", "Seller A", 99), station("Beta Port", "Seller B", 88)] }),
    getBuyIndexStationCatalog: ({ stationName }: { stationName: string }) =>
      new Promise<Catalog>((resolve) => pending.set(stationName, resolve)),
  };
  return {
    api,
    constructionSiteRefs: ["Site Sys"],
    homeSystem: "Site Sys",
    snap: null,
    setSearchDistanceTargets: () => {},
    // Measured from the site; the rows' saved 99 and 88 ly were measured from somewhere else.
    systemDistanceLy: { [galaxyDistancePairKey("Site Sys", "Seller A")]: 12.34 },
    summary: null,
    stations: { ban: () => {} },
  } as unknown as ColonizeModel;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  pending.clear();
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
const pick = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button.cz-pick")].find((b) => b.textContent === name)!;

async function search() {
  act(() => root.render(<SearchView m={model()} />));
  const input = host.querySelector<HTMLInputElement>("input[type=search]")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, "Steel");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => input.form!.requestSubmit());
  await settle();
}

describe("Search", () => {
  it("shows the distance from your site, and the saved one only while that is not measured yet", async () => {
    await search();
    const cells = [...host.querySelectorAll("tbody tr")].map((tr) => tr.querySelectorAll("td")[1]?.textContent);
    expect(cells).toEqual(["12.3 Ly", "88.0 Ly"]);
  });

  it("shows the market of the station picked last, whichever answer comes back first", async () => {
    await search();
    act(() => pick("Alpha Port").click());
    act(() => pick("Beta Port").click());
    await settle();
    await act(async () => pending.get("Beta Port")!({ ok: true, materials: [row("Beta Steel")] }));
    await act(async () => pending.get("Alpha Port")!({ ok: true, materials: [row("Alpha Steel")] }));
    await settle();
    const market = host.querySelector("aside[aria-label='Beta Port']")?.textContent ?? "";
    expect(market).toContain("Beta Steel");
    expect(market).not.toContain("Alpha Steel");
    expect(host.querySelector("aside[aria-label='Alpha Port']")).toBeNull();
  });
});
