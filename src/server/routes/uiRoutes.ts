/*
  What the pages tell the server about the view: the system shown, the body picked, the streamer mirror, links and
  the miss log opened on the PC (split out of settingsRoutes.ts, plan 2026-11-10 Phase 7.2; registered from it).
*/
import type express from "express";
import { localOnly, requestIsFromThisPc } from "../lanAuth.js";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";
import { APP_VIEWS, isAppView } from "../appViews.js";
import { setUiMirror, uiMirror } from "../uiMirror.js";

export function registerUiRoutes(app: express.Express, opts: HttpServerOptions, ctx: RouteContext): void {
  app.post("/api/ui/view-system", (req, res) => {
    if (typeof opts.setViewingSystem !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const addrRaw = req.body?.systemAddress;
    if (addrRaw !== null && typeof addrRaw !== "number") {
      res.status(400).json({
        ok: false,
        error: 'JSON body must include "systemAddress": number or null to follow live location.',
      });
      return;
    }
    if (typeof addrRaw === "number" && !Number.isFinite(addrRaw)) {
      res.status(400).json({ ok: false, error: "systemAddress must be a finite number." });
      return;
    }
    if (typeof addrRaw === "number") {
      const starRaw = req.body?.starSystem;
      if (typeof starRaw === "string" && starRaw.trim()) {
        opts.lookupSystem?.(addrRaw, starRaw.trim());
      }
    }
    opts.setViewingSystem(addrRaw as number | null);
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.post("/api/ui/selected-body", (req, res) => {
    if (typeof opts.setUiSelectedBodyKey !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const raw = req.body?.bodyKey;
    if (raw !== null && typeof raw !== "string") {
      res.status(400).json({ ok: false, error: 'JSON body must include "bodyKey": string | null.' });
      return;
    }
    // The client applies the selection optimistically; the broadcast exists only so the overlay
    // windows follow along. Skip it when nothing changed — this fires on every tab click.
    const changed = opts.setUiSelectedBodyKey(raw);
    // `focus`: a notice's or bookmark's Show — the main window's tab strip follows only the one-shot auto-select, so
    // the body is queued there too (1.2.19 review: Show switched the system but opened another tab).
    const focus = req.body?.focus === true && typeof raw === "string";
    if (focus) opts.focusUiBody?.(raw);
    if (changed !== false || focus) opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });


  /*
    The streamer view's mirror of the app's own settings (uiMirror.ts). Only the app on this PC may
    set it: a phone on the LAN has settings of its own that are not the streamer's.
  */
  app.get("/api/ui/mirror", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(uiMirror());
  });
  // The streamer view redraws when the streamer changes a setting (R2: it asked every second).
  ctx.watchTopic("ui-mirror", () => uiMirror().rev);
  app.post("/api/ui/mirror", (req, res) => {
    if (!requestIsFromThisPc(req)) {
      res
        .status(403)
        .json({ ok: false, error: "Only the app on the PC running it sets the streamer view's settings." });
      return;
    }
    res.json({ ok: true, rev: setUiMirror(req.body?.values).rev });
    ctx.topicsMayHaveChanged();
  });

  app.post("/api/ui/open-external", localOnly, (req, res) => {
    if (typeof opts.openAppView !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    if (!requestIsFromThisPc(req)) {
      res.status(403).json({
        ok: false,
        error: "A browser opens on the PC running the app, so it can only be opened from there.",
      });
      return;
    }
    const view: unknown = req.body?.view;
    if (!isAppView(view)) {
      res
        .status(400)
        .json({ ok: false, error: `Send JSON { "view": ${APP_VIEWS.map((v) => `"${v}"`).join(" | ")} }.` });
      return;
    }
    res.json(opts.openAppView(view));
  });

  app.post("/api/settings/open-miss-log", localOnly, (req, res) => {
    if (typeof opts.openExoMissLog !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    if (!requestIsFromThisPc(req)) {
      res.status(403).json({
        ok: false,
        error: "The miss log opens on the PC running the app, so it can only be opened from there.",
      });
      return;
    }
    res.json(opts.openExoMissLog());
  });
}
