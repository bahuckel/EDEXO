/**
 * The NavRoute star finder's log (owner, 2026-10-04): every plotted route kept with its star classes,
 * one list of systems, and EDSM asked politely about the ones the commander chooses.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkNavRouteSystemsOnEdsm,
  findPlottedSystems,
  lastNavRoute,
  MAX_ROUTES,
  navRouteLog,
  plottedSystem,
  plottedSystemsCompact,
  recordNavRoute,
  resetNavRouteLogForTests,
} from "../src/server/navRouteLog.js";
import { plottedTag } from "../src/shared/plottedTag.js";
import type { NavRouteWaypointDTO } from "../src/server/navRouteFuel.js";

let dir: string;
let before: string | undefined;
beforeEach(() => {
  before = process.env.EDEXO_USER_DATA_DIR;
  dir = mkdtempSync(path.join(os.tmpdir(), "edexo-navlog-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
  resetNavRouteLogForTests();
});
afterEach(() => {
  if (before === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = before;
  resetNavRouteLogForTests();
  rmSync(dir, { recursive: true, force: true });
});

const wp = (a: number, name: string, starClass: string): NavRouteWaypointDTO => ({
  systemAddress: a,
  starSystem: name,
  starPos: [a, 0, 0],
  starClass,
});

describe("the NavRoute log", () => {
  it("keeps a new route once, and merges systems seen on several", () => {
    const r1 = [wp(1, "Sol", "G"), wp(2, "Neut A", "N"), wp(3, "Wolf B", "W")];
    expect(recordNavRoute(r1, "2026-10-04T10:00:00Z")).toBe(true);
    expect(recordNavRoute(r1, "2026-10-04T10:01:00Z")).toBe(false);
    expect(recordNavRoute([wp(3, "Wolf B", "W"), wp(4, "Hole C", "H")], "2026-10-04T11:00:00Z")).toBe(true);
    const log = navRouteLog();
    expect(log.routes.map((r) => [r.from, r.to, r.count])).toEqual([
      ["Sol", "Wolf B", 3],
      ["Wolf B", "Hole C", 2],
    ]);
    const wolf = log.systems.find((s) => s.address === 3)!;
    expect(wolf).toMatchObject({ starClass: "W", routes: 2, firstSeen: "2026-10-04T10:00:00Z", lastSeen: "2026-10-04T11:00:00Z" });
    expect(lastNavRoute().map((s) => s.name)).toEqual(["Wolf B", "Hole C"]);
  });

  it("keeps every plotted system past the routes kept, to find by name (plan 1.3.3 R-2: 500 routes)", () => {
    for (let k = 0; k < MAX_ROUTES + 50; k++) {
      recordNavRoute([wp(10_000 + k, `Plotted ${k} A`, "K"), wp(20_000 + k, `Plotted ${k} B`, "N")], `2026-10-30T00:${String(k % 60).padStart(2, "0")}:00Z`);
    }
    expect(navRouteLog().routes).toHaveLength(MAX_ROUTES);
    // The first route's systems stay after its record has gone.
    expect(plottedSystem(10_000)?.name).toBe("Plotted 0 A");
    expect(plottedSystemsCompact()).toHaveLength(2 * (MAX_ROUTES + 50));
    expect(findPlottedSystems("plotted 7 b").map((s) => s.address)).toEqual([20_007]);
    expect(findPlottedSystems("pl")).toEqual([]);
  });

  it("tags a plotted system by what is known of it", () => {
    expect(plottedTag({ visited: false, edsm: false })).toBe("Plotted in-game, not visited · not on EDSM");
    expect(plottedTag({ visited: false, edsm: undefined })).toBe("Plotted in-game, not visited · EDSM not asked");
    expect(plottedTag({ visited: true, edsm: false })).toBeNull();
  });

  it("asks EDSM forty names at a time, and remembers which it knows", async () => {
    const route = Array.from({ length: 45 }, (_, i) => wp(100 + i, `Sys ${i}`, i % 2 ? "N" : "M"));
    recordNavRoute(route);
    const asked: string[][] = [];
    const fetchImpl = (async (url: string) => {
      const names = new URL(url).searchParams.getAll("systemName[]");
      asked.push(names);
      // EDSM knows the even ones.
      const known = names.filter((n) => Number(n.split(" ")[1]) % 2 === 0).map((name) => ({ name }));
      return new Response(JSON.stringify(known), { status: 200 });
    }) as unknown as typeof fetch;
    await checkNavRouteSystemsOnEdsm(route.map((w) => w.systemAddress), fetchImpl, 0);
    expect(asked.map((a) => a.length)).toEqual([40, 5]);
    const by = (n: string) => navRouteLog().systems.find((s) => s.name === n)!;
    expect(by("Sys 2").edsm).toBe(true);
    expect(by("Sys 3").edsm).toBe(false);
    expect(navRouteLog().checking).toBeNull();
    // Asked again: nothing left to ask.
    asked.length = 0;
    await checkNavRouteSystemsOnEdsm(route.map((w) => w.systemAddress), fetchImpl, 0);
    expect(asked).toEqual([]);
  });
});

describe("the plotted list's revision (review 2026-11-10 F3)", () => {
  it("moves when the kept systems change, not when the same route is seen again", async () => {
    const { plottedRevision } = await import("../src/server/navRouteLog.js");
    const r1 = [wp(1, "Sol", "G"), wp(2, "Neut A", "N")];
    recordNavRoute(r1, "2026-10-04T10:00:00Z");
    const after = plottedRevision();
    recordNavRoute(r1, "2026-10-04T10:01:00Z");
    expect(plottedRevision()).toBe(after);
    recordNavRoute([wp(2, "Neut A", "N"), wp(3, "Wolf B", "W")], "2026-10-04T11:00:00Z");
    expect(plottedRevision()).toBeGreaterThan(after);
  });

  it("is what the map asks with: the whole list once, then unchanged", async () => {
    const { createHttpServer } = await import("../src/server/httpServer.js");
    recordNavRoute([wp(1, "Sol", "G"), wp(2, "Neut A", "N")], "2026-10-04T10:00:00Z");
    const { server, listening } = createHttpServer({
      port: 0,
      bindHost: "127.0.0.1",
      getSnapshot: () => ({}) as never,
      getStatus: () => ({}) as never,
      getCommanderPosition: () => null,
      getCommanderSystem: () => null,
    });
    await listening;
    try {
      const port = (server.address() as { port: number }).port;
      const get = async (q = "") => (await fetch(`http://127.0.0.1:${port}/api/navroutes/plotted${q}`)).json();
      const whole = (await get()) as { rev: number; visitedCount: number; systems: unknown[] };
      expect(whole.systems).toHaveLength(2);
      expect(await get(`?since=${whole.rev}&visited=${whole.visitedCount}`)).toEqual({
        rev: whole.rev,
        visitedCount: whole.visitedCount,
        unchanged: true,
      });
      expect(((await get(`?since=${whole.rev - 1}&visited=0`)) as { systems: unknown[] }).systems).toHaveLength(2);
    } finally {
      await new Promise((r) => server.close(() => r(null)));
    }
  });
});
