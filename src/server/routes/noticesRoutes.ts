/*
  The bell: "Notify me" settings, read / unread, the test notice, clearing the read ones (split out of
  settingsRoutes.ts, plan 2026-11-10 Phase 7.2; registered from it).
*/
import type express from "express";
import { localOnly } from "../lanAuth.js";
import type { HttpServerOptions } from "../httpServerTypes.js";

export function registerNoticesRoutes(app: express.Express, opts: HttpServerOptions): void {
  /* "Notify me" (shared/notices.ts). The reply is the stored settings, after the allow-list. */
  app.get("/api/settings/notify", (_req, res) => {
    if (typeof opts.getNotifySettings !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    res.json({ ok: true, ...opts.getNotifySettings() });
  });

  app.post("/api/settings/notify", (req, res) => {
    if (typeof opts.setNotifyPrefs !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ ok: false, error: "JSON body must be an object." });
      return;
    }
    res.json({ ok: true, ...opts.setNotifyPrefs(req.body) });
  });

  app.post("/api/notices/read", (req, res) => {
    if (typeof opts.markNoticesRead !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const b = (req.body ?? {}) as { ids?: unknown; all?: unknown };
    if (b.all === true) {
      res.json({ ok: true, removed: opts.markNoticesRead("all") });
      return;
    }
    if (!Array.isArray(b.ids) || !b.ids.every((x) => typeof x === "string")) {
      res.status(400).json({ ok: false, error: 'JSON body must be { "ids": string[] } or { "all": true }.' });
      return;
    }
    res.json({ ok: true, removed: opts.markNoticesRead(b.ids as string[]) });
  });

  app.post("/api/notices/unread", (req, res) => {
    const b = (req.body ?? {}) as { ids?: unknown };
    if (typeof opts.markNoticesUnread !== "function")
      return void res.status(501).json({ ok: false, error: "Not available" });
    if (!Array.isArray(b.ids) || !b.ids.every((x) => typeof x === "string")) {
      res.status(400).json({ ok: false, error: 'JSON body must be { "ids": string[] }.' });
      return;
    }
    res.json({ ok: true, changed: opts.markNoticesUnread(b.ids as string[]) });
  });

  app.post("/api/notices/test", (_req, res) => {
    if (typeof opts.sendTestNotice !== "function")
      return void res.status(501).json({ ok: false, error: "Not available" });
    opts.sendTestNotice();
    res.json({ ok: true });
  });

  app.post("/api/notices/clear-read", localOnly, (_req, res) => {
    if (typeof opts.clearReadNotices !== "function")
      return void res.status(501).json({ ok: false, error: "Not available" });
    res.json({ ok: true, removed: opts.clearReadNotices() });
  });
}
