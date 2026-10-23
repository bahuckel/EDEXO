/**
 * The app's update, its what's-new notes and Copy diagnostics (moved out of httpServer.ts,
 * audit 2026-10-22).
 */
import type express from "express";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";
import { isLoopbackAddress, localOnly } from "../lanAuth.js";

export function registerAppInfoRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
  app.get("/api/app/update", async (req, res) => {
    if (typeof opts.getUpdateInfo !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    res.json(await opts.getUpdateInfo(req.query.force === "1"));
  });

  // This PC only: what it writes is a program for this PC to run.
  app.post("/api/app/update/download", localOnly, (_req, res) => {
    if (typeof opts.startUpdateDownload !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    res.json(opts.startUpdateDownload());
  });

  app.get("/api/app/whats-new", async (req, res) => {
    if (typeof opts.getWhatsNew !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    res.json(await opts.getWhatsNew(req.query.any === "1"));
  });

  app.get("/api/app/diagnostics", async (_req, res) => {
    if (typeof opts.getDiagnostics !== "function") {
      res.status(501).type("text/plain").send("Not available");
      return;
    }
    res
      .type("text/plain")
      .set("Cache-Control", "no-store")
      .send(await opts.getDiagnostics());
  });

  app.post("/api/app/whats-new/seen", localOnly, (_req, res) => {
    if (typeof opts.markWhatsNewSeen !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    try {
      opts.markWhatsNewSeen();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/app/open-update", (req, res) => {
    if (typeof opts.openUpdatePage !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({
        ok: false,
        error: "A browser opens on the PC running the app, so it can only be opened from there.",
      });
      return;
    }
    res.json(opts.openUpdatePage());
  });
}
