/**
 * Where the commander is, the launcher-sized status, and two checks of this PC (moved out of
 * httpServer.ts, audit 2026-10-22).
 */
import type express from "express";
import { eliteDisplaySettingsPath, eliteDisplayWarning, readEliteDisplayMode } from "../eliteDisplayMode.js";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";
import { linuxCheckForThisMachine } from "../linuxProbes.js";
import { perfCount } from "../perf.js";

export function registerSystemInfoRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
  /**
   * Where the commander is (§10.3).
   *
   * Its own endpoint rather than a field on the snapshot: the sector map is a separate screen with no
   * WebSocket, and it wants one small thing on a slow poll. `/api/state` rebuilds the whole snapshot
   * (~186 ms, ~630 kB) and would be absurd for three numbers.
   *
   * Null is a real answer — the app may not have seen a jump yet — and the map draws nothing rather
   * than guessing the origin.
   */
  app.get("/api/commander-position", (_req, res) => {
    perfCount("http.commanderPosition");
    const pos = opts.getCommanderPosition();
    res.json({ position: pos, system: opts.getCommanderSystem() });
  });

  app.get("/api/status", (_req, res) => {
    perfCount("http.apiStatus");
    res.json(opts.getStatus());
  });

  /**
   * The Linux start-up check (linuxCheck.ts): what is missing here and the command to install it on
   * this distro. `{ applicable: false }` off Linux. The HUD rows only for the Electron app.
   */
  app.get("/api/system/linux-check", (_req, res) => {
    const r = linuxCheckForThisMachine(process.env.EDEXO_ELECTRON === "1");
    res.json(r ? { applicable: true, ...r } : { applicable: false });
  });

  /**
   * Whether Elite is in a display mode the HUDs can be drawn over.
   *
   * Read fresh on every call rather than cached at boot: the commander changes this while the app is
   * running, and a cached "borderless" would keep telling him everything is fine while he stares at
   * a screen with no overlay on it.
   */
  app.get("/api/elite-display-mode", (_req, res) => {
    const status = readEliteDisplayMode(eliteDisplaySettingsPath(opts.getSnapshot().journalDir));
    res.json({ ...status, warning: eliteDisplayWarning(status) });
  });
}
