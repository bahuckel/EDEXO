/**
 * R2 (owner 2026-10-24): the planner's coordinates and the sites' distances go out as one request when they are asked
 * for together (src/client/colonize/systemLookup.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_LOOKUP_WINDOW_MS, lookUpSystems } from "../../src/client/colonize/systemLookup";

type Ask = { systems: string[]; fromSystems: string[]; toSystems: string[] };

function fakeApi(answer: (ask: Ask) => unknown = () => ({ ok: true, coords: { sol: [0, 0, 0] }, distances: { x: 1 } })) {
  const asks: Ask[] = [];
  const api = {
    resolveSystems: vi.fn(async (ask: Ask) => {
      asks.push(ask);
      return answer(ask);
    }),
  };
  return { api: api as never, asks };
}

describe("lookUpSystems", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends the coordinates and the distances asked within the window as one request", async () => {
    const { api, asks } = fakeApi();
    const coords = lookUpSystems(api, { systems: ["Sol", "Achenar"] });
    await vi.advanceTimersByTimeAsync(500); // the distances hook settles 500 ms after the change
    const dist = lookUpSystems(api, { fromSystems: ["Site A"], toSystems: ["Sol"] });
    await vi.advanceTimersByTimeAsync(SYSTEM_LOOKUP_WINDOW_MS);
    expect(asks).toEqual([{ systems: ["Sol", "Achenar"], fromSystems: ["Site A"], toSystems: ["Sol"] }]);
    const [a, b] = await Promise.all([coords, dist]);
    expect(a).toEqual({ ok: true, coords: { sol: [0, 0, 0] }, distances: { x: 1 } });
    expect(b).toBe(a);
  });

  it("asks again for what comes after the request went out", async () => {
    const { api, asks } = fakeApi();
    void lookUpSystems(api, { systems: ["Sol"] });
    await vi.advanceTimersByTimeAsync(SYSTEM_LOOKUP_WINDOW_MS);
    void lookUpSystems(api, { systems: ["Achenar"] });
    await vi.advanceTimersByTimeAsync(SYSTEM_LOOKUP_WINDOW_MS);
    expect(asks.map((a) => a.systems)).toEqual([["Sol"], ["Achenar"]]);
  });

  it("splits a batch that would pass the server's 400 systems", async () => {
    const { api, asks } = fakeApi();
    const names = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
    void lookUpSystems(api, { systems: names(300, "a") });
    void lookUpSystems(api, { systems: names(300, "b") });
    await vi.advanceTimersByTimeAsync(SYSTEM_LOOKUP_WINDOW_MS);
    expect(asks.map((a) => a.systems.length)).toEqual([300, 300]);
  });

  it("answers a failed request as a failure, not a thrown error", async () => {
    const { api } = fakeApi(() => {
      throw new Error("offline");
    });
    const p = lookUpSystems(api, { systems: ["Sol"] });
    await vi.advanceTimersByTimeAsync(SYSTEM_LOOKUP_WINDOW_MS);
    expect(await p).toEqual({ ok: false, err: "offline" });
  });
});
