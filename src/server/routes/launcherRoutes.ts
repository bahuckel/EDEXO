/**
 * The launcher's open mode, its LAN access switch (moved out of httpServer.ts, audit 2026-10-22) and the commander
 * dropdown (per-commander profiles, 1.3.1).
 */
import type express from "express";
import type { CommandersDTO } from "../../shared/types.js";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";
import { getHudBridge } from "../hudBridge.js";
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
  const commanders = (): CommandersDTO =>
    opts.getCommanders?.() ?? { active: null, game: null, list: [], canSwitch: false };
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

  /** Whose data this run shows, who the game is playing, and every commander the journals name. */
  app.get("/api/commanders", (_req, res) => {
    res.json({ ok: true, ...commanders() });
  });

  /*
    Show another commander: the desktop app starts the server again for them (hudBridge `switchCommander`). Answered
    at once; the pages then wait for the server to come back as that commander. From this PC only, like LAN access:
    it restarts the app.
  */
  app.post("/api/commanders/switch", async (req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({ ok: false, error: "The commander can only be switched on the PC running the app." });
      return;
    }
    const fid = (req.body as { fid?: unknown } | undefined)?.fid;
    const target = typeof fid === "string" ? commanders().list.find((c) => c.fid === fid) : undefined;
    if (!target) {
      res.status(400).json({ ok: false, error: "No such commander in the journals." });
      return;
    }
    const bridge = getHudBridge();
    if (typeof bridge?.switchCommander !== "function") {
      res.status(501).json({
        ok: false,
        error: `This server cannot start itself again. Start it with EDEXO_COMMANDER=${target.fid} to show CMDR ${target.name}.`,
      });
      return;
    }
    try {
      const r = await bridge.switchCommander({ fid: target.fid });
      res.status(r.ok ? 200 : 500).json({ ...r, commander: { fid: target.fid, name: target.name } });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
