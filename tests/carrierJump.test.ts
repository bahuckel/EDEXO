// @vitest-environment jsdom
/**
 * His fleet carrier's jump timer (owner, 2026-11-02: "carrier jump timer - yes"): the journal side in
 * shared/ownAssets.ts (`ownCarrierJump`, and `carrierPhase`, the counting the HUD's Carrier section and the main
 * window's tray tile share).
 * Times from his own journals: requested 18:39:39, departing 18:55:10, CarrierJump at 18:56:01.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CarrierTile } from "../src/client/header/CarrierTile.js";
import {
  CARRIER_ARRIVE_MS,
  CARRIER_COOLDOWN_MS,
  CARRIER_LOCKDOWN_MS,
  hydrateOwnAssets,
  newOwnAssets,
  ownAssetsLine,
  ownCarrierJump,
  ownCarrierNow,
  carrierPhase,
} from "../src/shared/ownAssets.js";

const at = (t: string, o: Record<string, unknown>) => ({ ...o, timestamp: t });
const ms = (t: string) => Date.parse(t);

function scheduled() {
  const st = newOwnAssets();
  ownAssetsLine(
    st,
    at("2025-10-04T18:00:00Z", {
      event: "CarrierLocation",
      CarrierType: "FleetCarrier",
      CarrierID: 3713878016,
      StarSystem: "Wregoe TA-E d12-25",
      SystemAddress: 869521246571,
    }),
  );
  ownAssetsLine(
    st,
    at("2025-10-04T18:01:00Z", {
      event: "CarrierStats",
      CarrierType: "FleetCarrier",
      CarrierID: 3713878016,
      Callsign: "KBX-05T",
      Name: "NO MONEY FOR SQUADRON",
      FuelLevel: 512,
      JumpRangeMax: 500,
    }),
  );
  ownAssetsLine(
    st,
    at("2025-10-04T18:39:39Z", {
      event: "CarrierJumpRequest",
      CarrierType: "FleetCarrier",
      CarrierID: 3713878016,
      SystemName: "G 224-46",
      SystemAddress: 2175140907371,
      BodyID: 4,
      Body: "G 224-46 A 1",
      DepartureTime: "2025-10-04T18:55:10Z",
    }),
  );
  return st;
}

describe("the carrier jump timer, from the journal", () => {
  it("counts to the lockdown and the departure of a requested jump, with the carrier's name and tritium", () => {
    const st = scheduled();
    const v = ownCarrierJump(st, ms("2025-10-04T18:40:00Z"))!;
    expect(v).toMatchObject({ name: "NO MONEY FOR SQUADRON", callsign: "KBX-05T", fuel: 512, system: "Wregoe TA-E d12-25" });
    expect(v.pending).toEqual({
      system: "G 224-46",
      body: "G 224-46 A 1",
      departureMs: ms("2025-10-04T18:55:10Z"),
      lockdownMs: ms("2025-10-04T18:55:10Z") - CARRIER_LOCKDOWN_MS,
      arriveMs: ms("2025-10-04T18:55:10Z") + CARRIER_ARRIVE_MS,
    });
    expect(v.cooldownUntilMs).toBe(v.pending!.arriveMs + CARRIER_COOLDOWN_MS);
  });

  it("forgets a cancelled jump, and the newest request wins", () => {
    const st = scheduled();
    ownAssetsLine(st, at("2025-10-04T18:41:00Z", { event: "CarrierJumpCancelled", CarrierType: "FleetCarrier" }));
    expect(ownCarrierJump(st, ms("2025-10-04T18:42:00Z"))).toBeNull();
    ownAssetsLine(
      st,
      at("2025-10-04T18:43:00Z", {
        event: "CarrierJumpRequest",
        CarrierType: "FleetCarrier",
        SystemName: "HIP 109310",
        SystemAddress: 1457973596882,
        DepartureTime: "2025-10-04T18:59:10Z",
      }),
    );
    expect(ownCarrierJump(st, ms("2025-10-04T18:44:00Z"))?.pending?.system).toBe("HIP 109310");
  });

  it("lands the jump about a minute after departure when he is not aboard, then runs the cooldown out", () => {
    const st = scheduled();
    const arrive = ms("2025-10-04T18:55:10Z") + CARRIER_ARRIVE_MS;
    expect(ownCarrierNow(st, arrive)?.name).toBe("G 224-46");
    const cool = ownCarrierJump(st, arrive + 60_000)!;
    expect(cool.pending).toBeNull();
    expect(cool.system).toBe("G 224-46");
    expect(cool.cooldownUntilMs).toBe(arrive + CARRIER_COOLDOWN_MS);
    expect(ownCarrierJump(st, arrive + CARRIER_COOLDOWN_MS + 1)).toBeNull();
  });

  it("lands it at CarrierJump when he is aboard, and ignores a stranger's carrier jumping elsewhere", () => {
    const st = scheduled();
    ownAssetsLine(st, at("2025-10-04T18:50:00Z", { event: "CarrierJump", StarSystem: "Somewhere Else", SystemAddress: 9 }));
    expect(st.pendingJump?.name).toBe("G 224-46");
    ownAssetsLine(
      st,
      at("2025-10-04T18:56:01Z", { event: "CarrierJump", Docked: false, OnFoot: true, StarSystem: "G 224-46", SystemAddress: 2175140907371 }),
    );
    expect(st.pendingJump).toBeNull();
    expect(st.carrier?.name).toBe("G 224-46");
    expect(st.lastArrival).toBe("2025-10-04T18:56:01Z");
    expect(ownCarrierJump(st, ms("2025-10-04T18:58:00Z"))?.cooldownUntilMs).toBe(ms("2025-10-04T18:56:01Z") + CARRIER_COOLDOWN_MS);
  });

  it("shows nothing for a jump replayed from an old journal, and keeps a jump still counting down across a relog", () => {
    const st = scheduled();
    // Read back today: departed a year ago.
    expect(ownCarrierJump(st, ms("2026-11-02T12:00:00Z"))).toBeNull();
    // A relog during the countdown: CarrierLocation names the old system, the jump stays.
    ownAssetsLine(
      st,
      at("2025-10-04T18:45:00Z", { event: "CarrierLocation", CarrierType: "FleetCarrier", StarSystem: "Wregoe TA-E d12-25", SystemAddress: 869521246571 }),
    );
    expect(ownCarrierJump(st, ms("2025-10-04T18:46:00Z"))?.pending?.system).toBe("G 224-46");
    // The next login, an hour later: the jump landed while the game was closed.
    ownAssetsLine(
      st,
      at("2025-10-04T19:50:00Z", { event: "CarrierLocation", CarrierType: "FleetCarrier", StarSystem: "G 224-46", SystemAddress: 2175140907371 }),
    );
    expect(st.pendingJump).toBeNull();
    expect(st.lastArrival).toBe(new Date(ms("2025-10-04T18:55:10Z") + CARRIER_ARRIVE_MS).toISOString());
  });

  it("reads its new fields back from the journal cache, and an older cache without them", () => {
    const st = scheduled();
    expect(hydrateOwnAssets(structuredClone(st))).toEqual(st);
    const old = { carrier: { name: "A", addr: 1, at: "" }, pendingJump: null, colonies: [] };
    expect(hydrateOwnAssets(old)).toEqual({ ...newOwnAssets(), carrier: { name: "A", addr: 1, at: "" } });
  });
});

describe("the HUD's Carrier section counting", () => {
  const v = ownCarrierJump(scheduled(), ms("2025-10-04T18:40:00Z"))!;
  const dep = ms("2025-10-04T18:55:10Z");

  it("goes countdown, lockdown, jumping, cooldown, then nothing, without another snapshot", () => {
    expect(carrierPhase(v, dep - 10 * 60_000)).toMatchObject({ kind: "countdown", system: "G 224-46", toDepartMs: 600_000, toLockdownMs: 400_000 });
    expect(carrierPhase(v, dep - 60_000)).toMatchObject({ kind: "lockdown", toDepartMs: 60_000 });
    expect(carrierPhase(v, dep + 30_000)).toMatchObject({ kind: "jumping" });
    expect(carrierPhase(v, dep + CARRIER_ARRIVE_MS + 60_000)).toEqual({ kind: "cooldown", leftMs: CARRIER_COOLDOWN_MS - 60_000 });
    expect(carrierPhase(v, dep + CARRIER_ARRIVE_MS + CARRIER_COOLDOWN_MS)).toBeNull();
    expect(carrierPhase(null, dep)).toBeNull();
  });
});

describe("the main window's Carrier tile (owner, 2026-11-02: it was on the HUD only)", () => {
  const v = ownCarrierJump(scheduled(), ms("2025-10-04T18:40:00Z"))!;
  const dep = ms("2025-10-04T18:55:10Z");
  const tile = (now: number) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    return renderToStaticMarkup(createElement(CarrierTile, { jump: v }));
  };
  afterEach(() => vi.useRealTimers());

  it("counts down, then says locked down, jumping and cooldown, then hides", () => {
    expect(tile(dep - 10 * 60_000)).toMatch(/Carrier jump<\/span><span class="tray-tile__value">10:00</);
    const locked = tile(dep - 60_000);
    expect(locked).toMatch(/Locked down<\/span><span class="tray-tile__value">01:00</);
    expect(locked).toContain("header-carrier--warn");
    expect(tile(dep + 30_000)).toMatch(/Jumping<\/span><span class="tray-tile__value">G 224-46 A 1</);
    expect(tile(dep + CARRIER_ARRIVE_MS + 60_000)).toMatch(/Cooldown<\/span><span class="tray-tile__value">04:00</);
    expect(tile(dep + CARRIER_ARRIVE_MS + CARRIER_COOLDOWN_MS)).toBe("");
  });
});
