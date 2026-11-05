/**
 * Spansh routes kept on disk (owner 2026-11-03): Spansh deletes a result within hours, the copy read once is kept so the
 * route opens and flies after that and after a restart; newest first, at most MAX_SAVED.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SAVED, openSpanshRouteFile } from "../src/server/spanshRouteFile.js";
import type { SpanshRouteDTO } from "../src/shared/dto/spanshRoute.js";

const route = (job: string, from = "Sol"): SpanshRouteDTO => ({
  job,
  kind: "exobiology",
  from,
  to: null,
  rangeLy: 60,
  stops: [
    { name: from, id64: "10477373803", x: 0, y: 0, z: 0, jumps: 0, neutron: false, refuel: false, inject: false, valueCr: 0, bodies: [] },
    { name: "Stein 2051", id64: "1", x: 1, y: 2, z: 3, jumps: 2, neutron: false, refuel: false, inject: false, valueCr: 15_900_000, bodies: [] },
  ],
  totalJumps: 2,
  totalValueCr: 15_900_000,
  url: `https://spansh.co.uk/exobiology/results/${job}`,
});
const job = (n: number) => `6418B058-0000-4000-8000-${String(n).padStart(12, "0")}`;

const dirs: string[] = [];
const tmpFile = () => {
  const d = mkdtempSync(path.join(tmpdir(), "edexo-spansh-saved-"));
  dirs.push(d);
  return path.join(d, "routes.json");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("Spansh routes kept on disk", () => {
  it("survive a restart, newest first, a route read again moves to the front", () => {
    const file = tmpFile();
    const a = openSpanshRouteFile(file);
    a.put(route(job(1)), new Date("2026-11-03T10:00:00Z"));
    a.put(route(job(2)), new Date("2026-11-03T11:00:00Z"));
    a.put(route(job(1)), new Date("2026-11-03T12:00:00Z"));
    const b = openSpanshRouteFile(file);
    expect(b.list().map((s) => s.job)).toEqual([job(1), job(2)]);
    expect(b.list()[0]).toMatchObject({ stops: 1, totalJumps: 2, readAt: "2026-11-03T12:00:00.000Z" });
    expect(b.get(job(2))?.stops[1]?.name).toBe("Stein 2051");
  });

  it("keep the newest MAX_SAVED and forget one on request", () => {
    const file = tmpFile();
    const f = openSpanshRouteFile(file);
    for (let i = 0; i < MAX_SAVED + 3; i++) f.put(route(job(i)));
    expect(f.list()).toHaveLength(MAX_SAVED);
    expect(f.get(job(0))).toBeUndefined();
    expect(f.remove(job(MAX_SAVED + 2))).toBe(true);
    expect(f.remove(job(MAX_SAVED + 2))).toBe(false);
    expect(openSpanshRouteFile(file).list()).toHaveLength(MAX_SAVED - 1);
  });

  it("read a broken or foreign file as empty", () => {
    const file = tmpFile();
    writeFileSync(file, "{ not json");
    expect(openSpanshRouteFile(file).list()).toEqual([]);
    writeFileSync(file, JSON.stringify({ routes: [{ route: { job: "x" }, readAt: "y" }, "z"] }));
    expect(openSpanshRouteFile(file).list()).toEqual([]);
  });

  it("answer a kept route without asking Spansh, after Spansh has deleted it", async () => {
    const realFetch = globalThis.fetch;
    let spanshUp = true;
    const spansh = vi.fn(async (url: string | URL | Request) => {
      if (!String(url).startsWith("https://spansh.co.uk/")) return realFetch(url);
      if (!spanshUp) return new Response("Unable to find route", { status: 404 });
      return new Response(
        JSON.stringify({
          status: "ok",
          parameters: { from: "Sol", range: 60 },
          result: [
            { name: "Sol", id64: 10477373803, x: 0, y: 0, z: 0, jumps: 0, bodies: [] },
            { name: "Stein 2051", id64: 1, x: 1, y: 2, z: 3, jumps: 2, bodies: [{ name: "Stein 2051 1", landmark_value: 15_900_000, landmarks: [] }] },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", spansh);
    const file = tmpFile();
    const { registerSpanshRouteRoutes } = await import("../src/server/routes/spanshRouteRoutes.js");
    const app = express();
    registerSpanshRouteRoutes(app, {} as never, openSpanshRouteFile(file));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const asked = () => spansh.mock.calls.filter(([u]) => String(u).startsWith("https://spansh.co.uk/")).length;
    try {
      const first = (await (await realFetch(`${base}/api/spansh-route?q=${job(7)}`)).json()) as { state: string; saved?: boolean };
      expect(first).toMatchObject({ state: "ok" });
      expect(first.saved).toBeUndefined();
      expect(asked()).toBe(1);
      spanshUp = false;
      const again = (await (await realFetch(`${base}/api/spansh-route?q=${job(7)}`)).json()) as { state: string; saved?: boolean };
      expect(again).toMatchObject({ state: "ok", saved: true });
      expect(asked()).toBe(1);
      const list = (await (await realFetch(`${base}/api/spansh-route/saved`)).json()) as { routes: { job: string }[] };
      expect(list.routes.map((r) => r.job)).toEqual([job(7)]);
      expect(JSON.parse(readFileSync(file, "utf8")).routes).toHaveLength(1);
      const gone = (await (await realFetch(`${base}/api/spansh-route/saved?job=${job(7)}`, { method: "DELETE" })).json()) as { removed: boolean };
      expect(gone.removed).toBe(true);
      const lost = (await (await realFetch(`${base}/api/spansh-route?q=${job(7)}`)).json()) as { state: string };
      expect(lost.state).toBe("error");
    } finally {
      server.close();
    }
  });

  it("fly with the stops sent along, after the route was forgotten (review P13)", async () => {
    const { registerSpanshRouteRoutes } = await import("../src/server/routes/spanshRouteRoutes.js");
    const start = vi.fn((hops: { name: string }[]) => hops[1]!.name);
    const app = express();
    app.use(express.json());
    registerSpanshRouteRoutes(app, { neutronLive: { start }, shipHere: () => null } as never, openSpanshRouteFile(tmpFile()));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const fly = (body: unknown) =>
      fetch(`${base}/api/spansh-route/fly`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      const r = route(job(9));
      const ok = await fly({ job: r.job, kind: r.kind, stops: r.stops });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ ok: true, next: "Stein 2051", stops: 1 });
      expect(start.mock.calls[0]![0].map((h: { name: string }) => h.name)).toEqual(["Sol", "Stein 2051"]);
      // Not a route: the old answer.
      const bad = await fly({ job: r.job, kind: "teleport", stops: r.stops });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: string }).error).toBe("Read the route from Spansh first.");
      expect((await fly({ job: r.job, kind: r.kind, stops: [{ name: "Sol", x: 0, y: 0 }, r.stops[1]] })).status).toBe(400);
    } finally {
      server.close();
    }
  });
});
