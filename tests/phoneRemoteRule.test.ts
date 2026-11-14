/**
 * The phone as a remote (owner 2026-11-07): "everything so alt-tabbing is not required, including opening new tabs,
 * but not browser and nothing that can be considered destructive". A paired phone may drive the app; it may not delete
 * or restore anything, open a browser or a URL on the PC, open Explorer windows, install an update or change LAN
 * access. Narrowed 2026-11-13 (owner): the phone is a window or a HUD; nothing it does reaches the PC itself (the HUD's
 * windows, the launcher's open mode, a test notification). Those routes carry `localOnly` (lanAuth.ts); this reads the
 * route files so a new one cannot slip by.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_REACH } from "../src/server/routeReach.js";

const dir = join(__dirname, "../src/server/routes");
type Route = { method: string; path: string; pcOnly: boolean };
const routes: Route[] = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
  const s = readFileSync(join(dir, f), "utf8");
  for (const m of s.matchAll(/app\.(get|post|put|delete|patch)\(\s*"([^"]+)",\s*([A-Za-z]+)?/g))
    // `localOnly` in the file, or a `pc` row in the route table (routeAccess.ts adds it; plan 1.1).
    routes.push({
      method: m[1]!,
      path: m[2]!,
      pcOnly: m[3] === "localOnly" || ROUTE_REACH[`${m[1]!.toUpperCase()} ${m[2]!}`] === "pc",
    });
}

const PC_ONLY = [
  "/api/app/open-update",
  "/api/backup/settings",
  "/api/backup/open-folder",
  "/api/backup/restore",
  "/api/visited-cache/import",
  "/api/visited-cache/remove",
  "/api/exomastery/open-shared-folder",
  "/api/galaxy/index/download",
  "/api/launcher/lan-access",
  "/api/notices/clear-read",
  "/api/ui/open-external",
  "/api/settings/open-miss-log",
  "/api/exobiology/reset",
  // Only this PC captures its own screen (review 2026-11-07 §7).
  "/api/hud-pitch",
  "/api/hud-target-distance",
  // The game's AppConfigLocal.xml, rewritten or deleted (review 2026-11-10 C3).
  "/api/scan-route/netlog",
  // The PC's own screen and launcher, and a Windows notification on it (owner 2026-11-13).
  "/api/hud/overlay/open",
  "/api/hud/overlay/toggle",
  "/api/hud/overlay/set",
  "/api/hud/overlay/close",
  "/api/hud/layout",
  "/api/hud/visibility",
  "/api/launcher/open-mode",
  "/api/notices/test",
];

describe("the phone as a remote", () => {
  it("cannot delete anything", () => {
    const open = routes.filter((r) => r.method === "delete" && !r.pcOnly).map((r) => r.path);
    expect(open).toEqual([]);
  });

  it("cannot restore, install, open a browser, a URL or a folder, or change LAN access", () => {
    for (const p of PC_ONLY) {
      const r = routes.filter((x) => x.path === p && x.method !== "get");
      expect(r.length, p).toBeGreaterThan(0);
      expect(r.every((x) => x.pcOnly), p).toBe(true);
    }
  });

  it("still uses the app's views and starts a route it flies", () => {
    for (const p of ["/api/ui/view-system", "/api/bookmarks", "/api/spansh-route/fly", "/api/neutron/live"])
      expect(routes.some((r) => r.path === p && r.method === "post" && !r.pcOnly), p).toBe(true);
  });
});
