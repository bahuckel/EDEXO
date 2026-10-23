/**
 * @vitest-environment jsdom
 *
 * The Colonize window's own state is the four things 1.3.0 shows (audit 2026-10-22): filters, routing, pinned hubs
 * and the carriers switched on. EDEXO-Colonize's app mode, basket, auto-basket switch and shopping run went; their
 * keys are removed from the browser, and the server's copy stops keeping the synced ones.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { RETIRED_KEYS } from "../../src/client/colonize/state/persisted";
import { initialUiState, uiReducer } from "../../src/client/colonize/state/uiState";
import { ColonizeUiState } from "../../src/server/colonize/uiState";
import { COLONIZE_SYNCED_KEYS, KEY_CARRIER_HAUL, KEY_TRIP_PLAN } from "../../src/shared/colonize/uiStateKeys";

beforeEach(() => localStorage.clear());

describe("the window's UI state", () => {
  it("holds only what 1.3.0 shows, and clears the retired keys from the browser", () => {
    for (const key of RETIRED_KEYS) localStorage.setItem(key, "x");
    localStorage.setItem(KEY_CARRIER_HAUL, JSON.stringify({ "3700000001": true, off: false }));
    const state = initialUiState();
    expect(Object.keys(state).sort()).toEqual(["carrierHaul", "checkoutFilters", "depotRefPins", "hudFollow", "projects", "routingMode"]);
    expect(state.carrierHaul).toEqual({ "3700000001": true });
    for (const key of RETIRED_KEYS) expect(localStorage.getItem(key), key).toBeNull();
    expect(localStorage.getItem(KEY_CARRIER_HAUL)).not.toBeNull();
  });

  it("still names every transition it has", () => {
    const s = initialUiState();
    const pinned = uiReducer(s, { type: "setDepotRefPin", marketId: "1", system: " Hub " });
    expect(pinned.depotRefPins).toEqual({ "1": "Hub" });
    const on = uiReducer(s, { type: "toggleCarrierHaul", carrierId: "3700000001" });
    expect(on.carrierHaul).toEqual({ "3700000001": true });
    expect(uiReducer(on, { type: "toggleCarrierHaul", carrierId: "3700000001" }).carrierHaul).toEqual({});
  });
});

describe("the server's copy", () => {
  it("is no longer asked to keep the retired keys, and drops them from an older file", () => {
    for (const key of RETIRED_KEYS) expect(COLONIZE_SYNCED_KEYS as readonly string[]).not.toContain(key);
    const file = path.join(mkdtempSync(path.join(tmpdir(), "edexo-ui-state-")), "ui-state.json");
    writeFileSync(
      file,
      JSON.stringify({ version: 1, values: { [KEY_TRIP_PLAN]: "{}", "edexo-colonize-basket-v2": "[]", "edexo-colonize-shopping-run-v1": "{}" } }),
    );
    expect(new ColonizeUiState(file).all()).toEqual({ [KEY_TRIP_PLAN]: "{}" });
  });
});
