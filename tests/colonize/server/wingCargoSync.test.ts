/**
 * The wing's cargo from EDSM (owner, 2026-10-24): the commander's EDSM key goes only with the name it was saved
 * with, never with a wingmate's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { name: string; key: string | null | undefined }[] = [];
vi.mock("../../../src/server/colonize/edsmCommanderCargo", () => ({
  fetchEdsmCommanderCargo: async (name: string, key?: string | null) => {
    calls.push({ name, key });
    return { ok: true, lines: [{ commodityId: "steel", label: "Steel", tons: 10 }] };
  },
}));

const { syncWingCargoFromEdsm } = await import("../../../src/server/colonize/wingCargoSync");

const roster = (...names: string[]) => names.map((commanderName) => ({ commanderName, lastSeenIso: "2026-10-24T00:00:00Z" }));

describe("syncWingCargoFromEdsm", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("sends the key only with the commander it belongs to", async () => {
    await syncWingCargoFromEdsm({ roster: roster("Wingmate One", "CMDR Falrenica"), edsmApiKey: "k3y", edsmCommanderName: "FALrenica" });
    expect(calls).toEqual([
      { name: "Wingmate One", key: null },
      { name: "CMDR Falrenica", key: "k3y" },
    ]);
  });

  it("sends no key when the key's commander is unknown", async () => {
    const res = await syncWingCargoFromEdsm({ roster: roster("Wingmate One"), edsmApiKey: "k3y" });
    expect(calls).toEqual([{ name: "Wingmate One", key: null }]);
    expect(res.members[0]?.claims).toEqual([{ commodityId: "steel", label: "Steel", tons: 10 }]);
  });
});
