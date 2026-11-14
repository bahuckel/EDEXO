/**
 * Who may call each route, as an allow-list (review 2026-11-10 C3, plan 1.1): every route the assembled server
 * registers has a row in routeReach.ts, `pc` rows get `localOnly`, and a route without a row is closed to other
 * devices and fails here until someone decides. The phone rule (owner 2026-11-07) is read off the table.
 */
import express from "express";
import { describe, expect, it } from "vitest";
import { createHttpServer } from "../src/server/httpServer.js";
import { localOnly } from "../src/server/lanAuth.js";
import { enforceRouteReach } from "../src/server/routeAccess.js";
import { ROUTE_REACH } from "../src/server/routeReach.js";

/** The server with every optional feature present, so every route registers. */
async function allRoutes(): Promise<string[]> {
  const base: Record<string, unknown> = {
    port: 0,
    bindHost: "127.0.0.1",
    getSnapshot: () => ({}),
    getStatus: () => ({}),
    getCommanderPosition: () => null,
    getCommanderSystem: () => null,
  };
  const opts = new Proxy(base, {
    get: (t, k) => (k in t ? t[k as string] : typeof k === "string" ? () => undefined : undefined),
    has: () => true,
  });
  const { server, listening, unclassifiedRoutes } = createHttpServer(opts as never);
  await listening;
  await new Promise((r) => server.close(r));
  return unclassifiedRoutes();
}

describe("the route table", () => {
  it("has a row for every route the server registers", async () => {
    expect(await allRoutes()).toEqual([]);
  });

  it("puts localOnly on a pc route and on an unlisted one, not on a lan route", () => {
    const app = express();
    enforceRouteReach(app, { "GET /pc": "pc", "GET /lan": "lan" });
    const h = (_req: express.Request, res: express.Response) => void res.end();
    app.get("/pc", h);
    app.get("/lan", h);
    app.get("/unlisted", h);
    const stack = (app as unknown as { _router: { stack: { route?: { path: string; stack: { handle: unknown }[] } }[] } })
      ._router.stack;
    const first = (p: string) => stack.find((l) => l.route?.path === p)!.route!.stack[0]!.handle;
    expect([first("/pc"), first("/lan"), first("/unlisted")]).toEqual([localOnly, h, localOnly]);
  });
});

describe("the phone rule, read off the table", () => {
  const pc = (k: string) => ROUTE_REACH[k] === "pc";

  it("deletes nothing from another device", () => {
    expect(Object.keys(ROUTE_REACH).filter((k) => k.startsWith("DELETE ") && !pc(k))).toEqual([]);
  });

  it("keeps restores, installs, browsers, folders, LAN access, game files and the screen reader on this PC", () => {
    for (const k of [
      "POST /api/backup/restore",
      "POST /api/app/update/download",
      "POST /api/app/open-update",
      "POST /api/ui/open-external",
      "POST /api/backup/open-folder",
      "POST /api/exomastery/open-shared-folder",
      "POST /api/launcher/lan-access",
      "POST /api/commanders/switch",
      "POST /api/scan-route/netlog",
      "POST /api/hud-pitch",
      "POST /api/hud-target-distance",
      "POST /api/exobiology/reset",
    ])
      expect([k, ROUTE_REACH[k]]).toEqual([k, "pc"]);
  });

  it("lets a paired phone use the app's views and start a route it flies", () => {
    for (const k of [
      "POST /api/ui/view-system",
      "POST /api/bookmarks",
      "POST /api/spansh-route/fly",
      "POST /api/neutron/live",
      "PATCH /api/boxels/:id",
    ])
      expect([k, ROUTE_REACH[k]]).toEqual([k, "lan"]);
  });

  it("keeps the PC's own screen and settings from a phone: the HUD's windows, the launcher's open mode, a test notification", () => {
    // Owner 2026-11-13: the phone is a window or a HUD, nothing it does reaches the PC itself.
    for (const k of [
      "POST /api/hud/overlay/open",
      "POST /api/hud/overlay/toggle",
      "POST /api/hud/overlay/set",
      "POST /api/hud/overlay/close",
      "POST /api/hud/visibility",
      "POST /api/hud/layout",
      "POST /api/launcher/open-mode",
      "POST /api/notices/test",
    ])
      expect([k, ROUTE_REACH[k]]).toEqual([k, "pc"]);
  });
});
