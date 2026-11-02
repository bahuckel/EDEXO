import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const T0 = Date.parse("2026-09-13T10:00:00Z");
const iso = (offsetS: number) => new Date(T0 + offsetS * 1000).toISOString();

function line(event: string, offsetS: number, extra: Record<string, unknown>): JournalLine {
  return { timestamp: iso(offsetS), event, ...extra } as unknown as JournalLine;
}

/** Arrive somewhere first, so the store has a current system. */
function arrivedAt(st: GameStateStore, name: string, addr: number, offsetS = 0): void {
  st.apply(line("FSDJump", offsetS, { StarSystem: name, SystemAddress: addr, StarPos: [0, 0, 0] }));
}

/**
 * The next-jump card's ladder: a jump in progress, then the arrival held for a minute, then the
 * nav-panel target, then the route's next hop — so the star class is on screen before the countdown.
 */
describe("nextJumpTarget", () => {
  it("names the route's next hop as soon as the route says so", () => {
    const st = new GameStateStore();
    arrivedAt(st, "A", 1);
    st.applyLiveNavRoute([
      { systemAddress: 1, starSystem: "A", starPos: [0, 0, 0], starClass: "G" },
      { systemAddress: 2, starSystem: "B", starPos: [10, 0, 0], starClass: "M" },
      { systemAddress: 3, starSystem: "C", starPos: [20, 0, 0], starClass: "K" },
    ]);
    const jt = st.nextJumpTarget();
    expect(jt).toMatchObject({ starSystem: "B", starClass: "M", source: "route", arrived: false });
  });

  it("prefers the nav-panel lock over the route hop", () => {
    const st = new GameStateStore();
    arrivedAt(st, "A", 1);
    st.applyLiveNavRoute([
      { systemAddress: 1, starSystem: "A", starPos: [0, 0, 0] },
      { systemAddress: 2, starSystem: "B", starPos: [10, 0, 0], starClass: "M" },
    ]);
    st.apply(line("FSDTarget", 5, { Name: "Blo Eurl YM-J b42-0", SystemAddress: 9, StarClass: "F" }));
    expect(st.nextJumpTarget()).toMatchObject({
      starSystem: "Blo Eurl YM-J b42-0",
      starClass: "F",
      source: "target",
    });
  });

  it("shows the jump in progress, then the next lock the moment the jump ends", () => {
    const st = new GameStateStore();
    arrivedAt(st, "A", 1);
    st.apply(line("FSDTarget", 5, { Name: "B", SystemAddress: 2, StarClass: "M" }));
    st.apply(
      line("StartJump", 10, { JumpType: "Hyperspace", StarSystem: "B", SystemAddress: 2, StarClass: "M" }),
    );
    expect(st.nextJumpTarget()).toMatchObject({ starSystem: "B", source: "jump", arrived: false });

    arrivedAt(st, "B", 2, 30);
    // nothing plotted yet: the arrival
    expect(st.nextJumpTarget()).toMatchObject({ starSystem: "B", source: "jump", arrived: true });
    st.apply(line("FSDTarget", 31, { Name: "C", SystemAddress: 3, StarClass: "K" }));
    // the next lock, at once
    expect(st.nextJumpTarget()).toMatchObject({ starSystem: "C", starClass: "K", source: "target" });
  });

  it("drops a spent lock on arrival and falls back to the route", () => {
    const st = new GameStateStore();
    arrivedAt(st, "A", 1);
    st.apply(line("FSDTarget", 5, { Name: "B", SystemAddress: 2, StarClass: "M" }));
    st.applyLiveNavRoute([
      { systemAddress: 1, starSystem: "A", starPos: [0, 0, 0] },
      { systemAddress: 2, starSystem: "B", starPos: [10, 0, 0] },
      { systemAddress: 3, starSystem: "C", starPos: [20, 0, 0], starClass: "A" },
    ]);
    arrivedAt(st, "B", 2, 30);
    expect(st.nextJumpTarget()).toMatchObject({ starSystem: "C", starClass: "A", source: "route" });
  });

  it("returns null with nothing plotted, targeted or in flight", () => {
    const st = new GameStateStore();
    expect(st.nextJumpTarget()).toBeNull();
  });
});

/**
 * A re-plot the game did not write to NavRoute.json (owner, 2026-11-01): a neutron route, then the same trip without
 * neutron jumps. FSDTarget named a system off the old route with 8 jumps left; the file kept the 7-system route.
 */
describe("a NavRoute.json the game did not rewrite", () => {
  const neutron = [
    { systemAddress: 1, starSystem: "Lyaisa VO-A e4883", starPos: [0, 0, 0] as [number, number, number], starClass: "B" },
    { systemAddress: 2, starSystem: "Lyaisa OI-B d2658", starPos: [60, 0, 0] as [number, number, number], starClass: "N" },
    { systemAddress: 3, starSystem: "Eembaids SZ-P e5-5249", starPos: [300, 0, 0] as [number, number, number], starClass: "B" },
  ];

  it("keeps the route while the game's target agrees with it", () => {
    const st = new GameStateStore();
    arrivedAt(st, "Lyaisa VO-A e4883", 1);
    st.applyLiveNavRoute(neutron);
    st.apply(line("FSDTarget", 1, { Name: "Lyaisa OI-B d2658", SystemAddress: 2, StarClass: "N", RemainingJumpsInRoute: 2 }));
    expect(st.liveNavRoute).toHaveLength(3);
    expect(st.nextJumpTarget()).toMatchObject({ starSystem: "Lyaisa OI-B d2658" });
  });

  it("drops it once the target is off the route or the count differs, and takes a rewritten file again", () => {
    const st = new GameStateStore();
    arrivedAt(st, "Lyaisa VO-A e4883", 1);
    st.applyLiveNavRoute(neutron);
    st.apply(line("FSDTarget", 1, { Name: "Lyaisa OI-B d2658", SystemAddress: 2, StarClass: "N", RemainingJumpsInRoute: 2 }));
    // Re-plotted without neutron jumps: the file stays, the target moves.
    st.apply(line("FSDTarget", 16, { Name: "Eembaids XF-O e6-521", SystemAddress: 9, StarClass: "B", RemainingJumpsInRoute: 8 }));
    expect(st.liveNavRoute).toBeNull();
    // The same file read again on the next tick stays dropped.
    st.applyLiveNavRoute(neutron);
    expect(st.liveNavRoute).toBeNull();
    // After the jump into a system off the old route, the next jump is the game's target, not the old route's start.
    arrivedAt(st, "Eembaids XF-O e6-521", 9, 60);
    st.apply(line("FSDTarget", 70, { Name: "Eembaids RQ-C d13-340", SystemAddress: 10, StarClass: "F", RemainingJumpsInRoute: 7 }));
    expect(st.nextJumpTarget()).toMatchObject({ starSystem: "Eembaids RQ-C d13-340", source: "target" });
    // The game writes the route at last: it agrees, and is used.
    const replot = [
      { systemAddress: 9, starSystem: "Eembaids XF-O e6-521", starPos: [50, 0, 0] as [number, number, number] },
      ...Array.from({ length: 7 }, (_, k) => ({ systemAddress: 10 + k, starSystem: `S${k}`, starPos: [100 + k, 0, 0] as [number, number, number] })),
    ];
    expect(st.applyLiveNavRoute(replot)).toBe(true);
    expect(st.liveNavRoute).toHaveLength(8);
  });

  it("checks nothing against a target locked without a route", () => {
    const st = new GameStateStore();
    arrivedAt(st, "Lyaisa VO-A e4883", 1);
    st.applyLiveNavRoute(neutron);
    st.apply(line("FSDTarget", 1, { Name: "Somewhere", SystemAddress: 99, StarClass: "K" }));
    expect(st.liveNavRoute).toHaveLength(3);
  });
});

describe("the route the game did not save", () => {
  it("is flagged for the HUD while the file disagrees, and not once the game writes it", () => {
    const st = new GameStateStore();
    arrivedAt(st, "A", 1);
    st.applyLiveNavRoute([
      { systemAddress: 1, starSystem: "A", starPos: [0, 0, 0] },
      { systemAddress: 2, starSystem: "B", starPos: [10, 0, 0] },
    ]);
    expect(st.navRouteUnsaved).toBe(false);
    st.apply(line("FSDTarget", 5, { Name: "X", SystemAddress: 9, StarClass: "F", RemainingJumpsInRoute: 4 }));
    expect(st.navRouteUnsaved).toBe(true);
    st.applyLiveNavRoute([
      { systemAddress: 1, starSystem: "A", starPos: [0, 0, 0] },
      { systemAddress: 9, starSystem: "X", starPos: [10, 0, 0] },
      { systemAddress: 10, starSystem: "Y", starPos: [20, 0, 0] },
      { systemAddress: 11, starSystem: "Z", starPos: [30, 0, 0] },
      { systemAddress: 12, starSystem: "W", starPos: [40, 0, 0] },
    ]);
    expect(st.navRouteUnsaved).toBe(false);
  });

  it("stays dropped after arriving where the target pointed, until the game rewrites the file (code review 2026-11-02)", () => {
    const st = new GameStateStore();
    arrivedAt(st, "A", 1);
    const stale = [
      { systemAddress: 1, starSystem: "A", starPos: [0, 0, 0] as [number, number, number] },
      { systemAddress: 2, starSystem: "B", starPos: [10, 0, 0] as [number, number, number] },
    ];
    st.applyLiveNavRoute(stale);
    // A one-jump plot to X, off the file's route: the file is wrong.
    st.apply(line("FSDTarget", 5, { Name: "X", SystemAddress: 9, StarClass: "F", RemainingJumpsInRoute: 1 }));
    expect(st.liveNavRoute).toBeNull();
    // Arrived: the target is spent, and the same stale file read on the next tick must not come back as the route.
    arrivedAt(st, "X", 9, 60);
    st.applyLiveNavRoute(stale);
    expect(st.liveNavRoute).toBeNull();
    expect(st.nextJumpTarget()?.starSystem).not.toBe("A");
    // The game writes a new file: used again.
    const fresh = [
      { systemAddress: 9, starSystem: "X", starPos: [10, 0, 0] as [number, number, number] },
      { systemAddress: 12, starSystem: "W", starPos: [40, 0, 0] as [number, number, number] },
    ];
    st.applyLiveNavRoute(fresh);
    expect(st.liveNavRoute).toHaveLength(2);
  });
});

describe("a re-plot to the system already locked (owner, 2026-11-01, 15:50)", () => {
  it("uses the new file: an FSDTarget older than it says nothing about it", () => {
    const st = new GameStateStore();
    st.apply({ timestamp: "2026-11-01T15:38:26Z", event: "FSDJump", StarSystem: "Eembaids MK-E d12-4715", SystemAddress: 1, StarPos: [0, 0, 0] } as never);
    // Locked during the route before, 4 jumps left on that one.
    st.apply({ timestamp: "2026-11-01T15:38:15Z", event: "FSDTarget", Name: "Eorl Brou XE-G d11-7331", SystemAddress: 2, StarClass: "F", RemainingJumpsInRoute: 4 } as never);
    const route = [1, 2, 3, 4, 5, 6].map((a) => ({ systemAddress: a, starSystem: `S${a}`, starPos: [a, 0, 0] as [number, number, number] }));
    // Re-plotted at 15:50: the game wrote the file, and no new FSDTarget (the same system stays locked).
    st.applyLiveNavRoute(route, "2026-11-01T15:50:13Z");
    expect(st.liveNavRoute).toHaveLength(6);
    expect(st.navRouteUnsaved).toBe(false);
    // An FSDTarget after the file that disagrees still drops it.
    st.apply({ timestamp: "2026-11-01T15:51:00Z", event: "FSDTarget", Name: "Elsewhere", SystemAddress: 99, StarClass: "K", RemainingJumpsInRoute: 9 } as never);
    expect(st.liveNavRoute).toBeNull();
  });
});
