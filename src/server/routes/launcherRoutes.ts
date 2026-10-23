/** The launcher's open mode and its LAN access switch (moved out of httpServer.ts, audit 2026-10-22). */
import type express from "express";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";
import { isLoopbackAddress } from "../lanAuth.js";
import {
  isLauncherOpenMode,
  readColonizeOpenMode,
  readLauncherOpenMode,
  writeColonizeOpenMode,
  writeLanAccess,
  writeLauncherOpenMode,
} from "../launcherPrefs.js";

export function registerLauncherRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
  /** Where the launcher opens the UI — saved in user data so a rebuilt exe keeps it (launcherPrefs.ts). */
  /* `?app=colonize`: Colonize's own choice (owner, 2026-10-22); without it, Compare's. */
  const colonizeApp = (req: express.Request) => req.query.app === "colonize";
  app.get("/api/launcher/open-mode", (req, res) => {
    res.json({ ok: true, mode: colonizeApp(req) ? readColonizeOpenMode() : readLauncherOpenMode() });
  });

  app.post("/api/launcher/open-mode", (req, res) => {
    const mode = (req.body as { mode?: unknown } | undefined)?.mode;
    if (!isLauncherOpenMode(mode)) {
      res.status(400).json({ ok: false, error: "mode must be browser, window or phone." });
      return;
    }
    try {
      if (colonizeApp(req)) writeColonizeOpenMode(mode);
      else writeLauncherOpenMode(mode);
      res.json({ ok: true, mode });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** The launcher's "LAN access" switch; applies at the next start. From this PC only. */
  app.post("/api/launcher/lan-access", (req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({ ok: false, error: "LAN access can only be changed on the PC running the app." });
      return;
    }
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ ok: false, error: "enabled must be true or false." });
      return;
    }
    try {
      writeLanAccess(enabled);
      res.json({ ok: true, lanAccess: opts.getStatus().lanAccess });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
