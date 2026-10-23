/**
 * @vitest-environment jsdom
 *
 * The Colonize window's snapshot (audit 2026-10-22): a failed first load is asked again (the server pushes only on a
 * change, so an idle commander saw "Nothing to haul yet" with sites on the server), and pushes are applied by the same
 * rule the server sends them by, the newest one winning.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { colonizeApi } from "../../src/client/colonize/api";
import { useColonizeSnapshot } from "../../src/client/colonize/hooks/useColonizeSnapshot";
import type { ColonizeSnapshot } from "../../src/shared/colonize/types";

function snap(over: Partial<ColonizeSnapshot> = {}): ColonizeSnapshot {
  return {
    ownColonies: [],
    journalDir: "J",
    journalDirConfigured: true,
    edsmApiKeyPresent: false,
    wingRoster: [],
    carriers: [],
    liveJournalPath: null,
    activeDepots: [],
    completedDepots: [],
    archivedDepots: [],
    liveDocked: null,
    navContext: { starSystem: "Sol", systemAddress: 1 },
    lastDockedEconomy: null,
    shipCargo: [],
    shipCargoTimestamp: null,
    shipCargoCapacity: null,
    dockMarket: null,
    journalShopHistory: [],
    replayBusy: false,
    lastError: null,
    ...over,
  };
}

let push: ((s: ColonizeSnapshot) => void) | null = null;
function fakeApi(getSnapshot: () => Promise<ColonizeSnapshot>): typeof colonizeApi {
  return {
    getSnapshot,
    onUpdate: (fn: (s: ColonizeSnapshot) => void) => {
      push = fn;
      return () => {
        push = null;
      };
    },
  } as unknown as typeof colonizeApi;
}

let seen: ColonizeSnapshot | null = null;
function Probe({ api }: { api: typeof colonizeApi }) {
  seen = useColonizeSnapshot(api).snap;
  return null;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
  seen = null;
  push = null;
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useColonizeSnapshot", () => {
  it("asks again after a failed first load", async () => {
    const getSnapshot = vi.fn<() => Promise<ColonizeSnapshot>>()
      .mockRejectedValueOnce(new Error("The server answered 503."))
      .mockResolvedValue(snap({ replayBusy: true }));
    await act(async () => root.render(<Probe api={fakeApi(getSnapshot)} />));
    expect(seen).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(seen?.replayBusy).toBe(true);
    // Loaded: no more asking.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["the wing", { wingRoster: [{ commanderName: "Mate", lastSeenIso: "2026-10-22T10:00:00Z" }] }],
    ["the end of a replay", { replayBusy: false }],
    ["an error", { lastError: "The journal folder is gone." }],
  ] as [string, Partial<ColonizeSnapshot>][])("applies a push that changes only %s", async (_what, over) => {
    await act(async () => root.render(<Probe api={fakeApi(() => Promise.resolve(snap()))} />));
    const before = snap({ replayBusy: true });
    await act(async () => {
      push!(before);
      await vi.advanceTimersByTimeAsync(800);
    });
    await act(async () => {
      push!({ ...before, ...over });
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(seen).toMatchObject(over);
  });

  it("shows the newest push when one went A, B and back to A within the debounce", async () => {
    await act(async () => root.render(<Probe api={fakeApi(() => Promise.resolve(snap()))} />));
    const a = snap();
    const b = snap({ shipCargo: [{ name: "steel", nameLocalised: "Steel", count: 10 }] });
    await act(async () => {
      push!(a);
      await vi.advanceTimersByTimeAsync(800);
    });
    await act(async () => {
      push!(b);
      push!(a);
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(seen?.shipCargo).toEqual([]);
  });
});
