/**
 * Plan 2026-11-10 Phase 7.1: one Status.json tick, out of startEdexo. A torn read is not "off the surface", a missing
 * file clears the live fields, and an unchanged file pushes nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { createStatusTick, type StatusTickDeps } from "../src/server/statusTick.js";

function setup(read: () => string, over: Partial<StatusTickDeps> = {}) {
  const store = new GameStateStore();
  const push = vi.fn();
  const broadcastExoLive = vi.fn();
  const readStatus = vi.fn(read);
  const tick = createStatusTick({
    store,
    getJournalDir: () => "J",
    gameIsAnotherCommander: () => false,
    applyNavRoute: () => false,
    readLiveNavRouteWaypoints: () => null,
    broadcastExoLive,
    buildExoLive: () => ({ exoOrganicOverlay: null, exoMinimap: null }) as never,
    push,
    readStatus,
    ...over,
  });
  return { store, push, broadcastExoLive, readStatus, tick };
}

const enoent = () => {
  throw Object.assign(new Error("gone"), { code: "ENOENT" });
};
const status = (fuelMain: number) =>
  JSON.stringify({ timestamp: "2026-11-11T12:00:00Z", event: "Status", Flags: 0, Fuel: { FuelMain: fuelMain, FuelReservoir: 0.5 } });

describe("createStatusTick", () => {
  it("reads nothing while the game plays another commander", () => {
    const { tick, readStatus, push } = setup(enoent, { gameIsAnotherCommander: () => true });
    tick();
    expect(readStatus).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("a missing file clears the destination and the fuel; a second missing read pushes nothing", () => {
    const { tick, store, push } = setup(enoent);
    store.statusDestination = { system: 1, body: 2, name: "X 1" } as never;
    tick();
    expect(store.statusDestination).toBeNull();
    expect(push).toHaveBeenCalledTimes(1);
    tick();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("a locked file (not ENOENT) and a torn read change nothing", () => {
    const locked = setup(() => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    });
    locked.store.statusDestination = { system: 1, body: 2, name: "X 1" } as never;
    locked.tick();
    expect(locked.store.statusDestination).not.toBeNull();
    expect(locked.push).not.toHaveBeenCalled();

    const torn = setup(() => '{"timestamp":"2026-11-11T12:00:00Z","event":"Sta');
    torn.store.exoOrganicLastFix = { lat: 1, lon: 2 } as never;
    torn.tick();
    expect(torn.store.exoOrganicLastFix).toEqual({ lat: 1, lon: 2 });
    expect(torn.push).not.toHaveBeenCalled();
  });

  it("pushes when the fuel moves, not for the same file again", () => {
    let fuel = 20;
    const { tick, push, store } = setup(() => status(fuel));
    tick();
    expect(push).toHaveBeenCalledTimes(1);
    expect(store.liveStatusFuelMainT).toBe(20);
    tick();
    expect(push).toHaveBeenCalledTimes(1);
    fuel = 18;
    tick();
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("sends the radar on every tick while a sample run is open", () => {
    const { tick, store, broadcastExoLive } = setup(() => status(20));
    store.overlayTouchdownBodyKey = "1:2";
    tick();
    tick();
    expect(broadcastExoLive).toHaveBeenCalledTimes(2);
  });
});
