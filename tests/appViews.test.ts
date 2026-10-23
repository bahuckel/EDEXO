/**
 * The app views `/api/ui/open-external` may open (server/appViews.ts). Audit 2026-10-22: the type, the route's
 * allowlist and the bootstrap's chain of ternaries were three lists; one table now gives the same six addresses.
 */
import { describe, expect, it } from "vitest";
import { APP_VIEWS, APP_VIEW_PATHS, appViewUrl, isAppView, type AppView } from "../src/server/appViews.js";

/** edexoBootstrap.ts's openAppView before the table, copied as it was. */
function oldUrl(port: number, view: string): string {
  return view === "phone"
    ? `http://127.0.0.1:${port}/?screen=triage`
    : view === "stream"
      ? `http://127.0.0.1:${port}/?view=stream`
      : view === "colonize"
        ? `http://127.0.0.1:${port}/?screen=colonize`
        : view === "colonize-phone"
          ? `http://127.0.0.1:${port}/?screen=colonize&phone=1`
          : view === "colonize-stream"
            ? `http://127.0.0.1:${port}/?screen=colonize&view=stream`
            : `http://127.0.0.1:${port}/`;
}

describe("the app views", () => {
  it("are the six the route allowed, in its order", () => {
    expect(APP_VIEWS).toEqual(["app", "phone", "stream", "colonize", "colonize-phone", "colonize-stream"]);
  });

  it("open the same addresses as before", () => {
    for (const view of APP_VIEWS) expect(appViewUrl(7117, view), view).toBe(oldUrl(7117, view));
    expect(Object.keys(APP_VIEW_PATHS)).toHaveLength(6);
  });

  it("take nothing else, not even what every object has", () => {
    for (const v of ["app", "colonize-stream"]) expect(isAppView(v), v).toBe(true);
    for (const v of ["toString", "__proto__", "constructor", "", "APP", null, undefined, 1, {}])
      expect(isAppView(v), String(v)).toBe(false);
  });

  it("fall back to the app for a view the table does not know, as the old chain did", () => {
    expect(appViewUrl(7117, "nope" as AppView)).toBe(oldUrl(7117, "nope"));
  });
});
