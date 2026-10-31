/**
 * Any system a neutron stop (plan 1.3.4 S-4, neutronStops.ts): a stop with a name and a place only gets its address
 * from what this PC knows, else from Spansh / EDSM, and only from a system at that place.
 */
import { describe, expect, it, vi } from "vitest";
import { localStopLookup, withStopAddresses, type NamedSystem, type StopPoint } from "../src/server/neutronStops.js";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const anchorage: StopPoint = { name: "Stuemeae FG-Y d7561", x: -1.5, y: 2.25, z: 4000 };

describe("stop addresses", () => {
  it("keeps an address given, and fills one in from what is known here", async () => {
    const local = vi.fn((): NamedSystem[] => [{ addr: 260_000_000_123, ...anchorage }]);
    const out = await withStopAddresses([{ ...anchorage }, { name: "Sol", x: 0, y: 0, z: 0, address: 10477373803 }], { local });
    expect(out.map((s) => s.address)).toEqual([260_000_000_123, 10477373803]);
    expect(local).toHaveBeenCalledTimes(1);
  });

  it("asks Spansh / EDSM only when nothing here knows the name", async () => {
    const remote = vi.fn(async (): Promise<NamedSystem[]> => [{ name: "stuemeae fg-y d7561", addr: 99, x: -1.5, y: 2.25, z: 4000.4 }]);
    const out = await withStopAddresses([anchorage], { local: () => [], remote });
    expect(out[0]!.address).toBe(99);
    expect(remote).toHaveBeenCalledWith("Stuemeae FG-Y d7561");
  });

  it("takes no address from a system of the same name somewhere else, nor from a failed search", async () => {
    const far = await withStopAddresses([anchorage], { local: () => [{ name: anchorage.name, addr: 7, x: 500, y: 0, z: 0 }] });
    expect(far[0]!.address).toBeUndefined();
    const failed = await withStopAddresses([anchorage], { local: () => [], remote: () => Promise.reject(new Error("offline")) });
    expect(failed[0]).toEqual(anchorage);
  });

  it("finds the commander's own systems without the galaxy index", async () => {
    const st = new GameStateStore();
    st.apply({
      timestamp: "2026-10-31T10:00:00Z",
      event: "FSDJump",
      StarSystem: "Hypi Fraae EL-Y b16-2",
      SystemAddress: 5_068_464_906_673,
      StarPos: [-19221.71875, 424.8125, 24904.15625],
    } as unknown as JournalLine);
    const stop: StopPoint = { name: "Hypi Fraae EL-Y b16-2", x: -19221.7, y: 424.8, z: 24904.2 };
    const out = await withStopAddresses([stop], { local: localStopLookup(null, st, []) });
    expect(out[0]!.address).toBe(5_068_464_906_673);
  });
});
