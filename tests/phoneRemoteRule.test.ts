/**
 * The phone as a remote (owner 2026-11-07): "everything so alt-tabbing is not required, including opening new tabs,
 * but not browser and nothing that can be considered destructive". A paired phone may drive the app; it may not delete
 * or restore anything, open a browser or a URL on the PC, open Explorer windows, install an update or change LAN
 * access. Those routes carry `localOnly` (lanAuth.ts); this reads the route files so a new one cannot slip by.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "../src/server/routes");
type Route = { method: string; path: string; pcOnly: boolean };
const routes: Route[] = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
  const s = readFileSync(join(dir, f), "utf8");
  for (const m of s.matchAll(/app\.(get|post|put|delete|patch)\(\s*"([^"]+)",\s*([A-Za-z]+)?/g))
    routes.push({ method: m[1]!, path: m[2]!, pcOnly: m[3] === "localOnly" });
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

  it("still drives the HUD, its overlays and the app's views", () => {
    for (const p of ["/api/hud/overlay/open", "/api/hud/visibility", "/api/hud/layout", "/api/ui/view-system", "/api/bookmarks"])
      expect(routes.some((r) => r.path === p && r.method === "post" && !r.pcOnly), p).toBe(true);
  });
});
