/*
  System look-ups on Spansh and EDSM and the EDSM, Canonn and EDDN switches (split out of settingsRoutes.ts, plan
  2026-11-10 Phase 7.2; registered from it).
*/
import type express from "express";
import { localOnly } from "../lanAuth.js";
import { isEdsmCatchUpScope } from "../edsmCatchUp.js";
import type { HttpServerOptions } from "../httpServerTypes.js";
import { errorText, fail } from "../errorText.js";

export function registerCommunityRoutes(app: express.Express, opts: HttpServerOptions): void {
  app.get("/api/system/spansh-search", async (req, res) => {
    if (typeof opts.searchSpanshSystems !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    const qRaw = req.query?.q;
    const q = typeof qRaw === "string" ? qRaw : "";
    try {
      const result = await opts.searchSpanshSystems(q);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ systems: result.systems });
    } catch (e) {
      res.status(500).json({ error: errorText(e) });
    }
  });

  app.post("/api/system/hydrate-from-spansh", async (req, res) => {
    if (typeof opts.hydrateSystemFromSpansh !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const systemAddress = req.body?.systemAddress;
    const systemName = req.body?.systemName;
    if (typeof systemAddress !== "number" || !Number.isFinite(systemAddress)) {
      res.status(400).json({ ok: false, error: 'JSON body must include numeric "systemAddress".' });
      return;
    }
    if (typeof systemName !== "string" || !systemName.trim()) {
      res.status(400).json({ ok: false, error: 'JSON body must include non-empty string "systemName".' });
      return;
    }
    try {
      const result = await opts.hydrateSystemFromSpansh(systemAddress, systemName.trim());
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error ?? "Spansh hydrate failed." });
        return;
      }
      opts.scheduleBroadcast?.();
      res.json({ ok: true });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/system/edsm-search", async (req, res) => {
    if (typeof opts.searchEdsmSystems !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    const qRaw = req.query?.q;
    const q = typeof qRaw === "string" ? qRaw : "";
    try {
      const result = await opts.searchEdsmSystems(q);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ systems: result.systems });
    } catch (e) {
      res.status(500).json({
        error: errorText(e),
      });
    }
  });

  app.get("/api/settings/edsm-credentials", localOnly, (_req, res) => {
    if (typeof opts.getEdsmCredentialsStatus !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    res.json({ ok: true, ...opts.getEdsmCredentialsStatus() });
  });

  app.post("/api/settings/edsm-credentials", localOnly, (req, res) => {
    if (typeof opts.setEdsmCredentials !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const commanderName = req.body?.commanderName;
    const apiKey = req.body?.apiKey;
    if (typeof commanderName !== "string" || typeof apiKey !== "string") {
      res.status(400).json({ ok: false, error: "commanderName and apiKey are required." });
      return;
    }
    const r = opts.setEdsmCredentials(commanderName, apiKey);
    // The key is never echoed back, not even on success — the status shape carries a four-character
    // hint and nothing more.
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.delete("/api/settings/edsm-credentials", localOnly, (_req, res) => {
    if (typeof opts.forgetEdsmCredentials !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    opts.forgetEdsmCredentials();
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.post("/api/settings/edsm-auto-fetch", localOnly, (req, res) => {
    if (typeof opts.setEdsmAutoFetchEnabled !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ ok: false, error: "enabled must be a boolean." });
      return;
    }
    const r = opts.setEdsmAutoFetchEnabled(enabled);
    if (r.ok) opts.scheduleBroadcast?.();
    res.status(r.ok ? 200 : 400).json(r);
  });

  /**
   * Contributing the journal to EDSM.
   *
   * Two endpoints, because the switch and the work are different decisions: turning it on says the
   * commander agrees to send their journal, and the catch-up run is what actually sends four years
   * of it. Neither happens on its own.
   */
  app.post("/api/settings/edsm-upload", localOnly, (req, res) => {
    if (typeof opts.setEdsmUploadEnabled !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ ok: false, error: "enabled must be a boolean." });
      return;
    }
    const r = opts.setEdsmUploadEnabled(enabled);
    if (r.ok) opts.scheduleBroadcast?.();
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/settings/edsm-live-upload", localOnly, (req, res) => {
    if (typeof opts.setEdsmLiveUploadEnabled !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ ok: false, error: "enabled must be a boolean." });
      return;
    }
    const r = opts.setEdsmLiveUploadEnabled(enabled);
    if (r.ok) opts.scheduleBroadcast?.();
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/settings/edsm-catch-up", localOnly, (req, res) => {
    if (typeof opts.startEdsmCatchUp !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    // Required (combined plan 1.4): a body-less POST from anywhere used to mean "upload everything".
    const scope = req.body?.scope;
    if (!isEdsmCatchUpScope(scope)) {
      res.status(400).json({ ok: false, error: "scope must be day, week, month, year or all." });
      return;
    }
    const r = opts.startEdsmCatchUp(scope);
    if (r.ok) opts.scheduleBroadcast?.();
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/settings/edsm-catch-up-cancel", localOnly, (_req, res) => {
    if (typeof opts.cancelEdsmCatchUp !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    opts.cancelEdsmCatchUp();
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.post("/api/settings/canonn-upload", localOnly, (req, res) => {
    if (typeof opts.setCanonnUploadEnabled !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ ok: false, error: "enabled must be a boolean." });
      return;
    }
    const r = opts.setCanonnUploadEnabled(enabled);
    if (r.ok) opts.scheduleBroadcast?.();
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/settings/eddn-upload", localOnly, (req, res) => {
    if (typeof opts.setEddnUploadEnabled !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ ok: false, error: "enabled must be a boolean." });
      return;
    }
    const r = opts.setEddnUploadEnabled(enabled);
    if (r.ok) opts.scheduleBroadcast?.();
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/system/hydrate-from-edsm", async (req, res) => {
    if (typeof opts.hydrateSystemFromEdsm !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const systemAddress = req.body?.systemAddress;
    const systemName = req.body?.systemName;
    if (typeof systemAddress !== "number" || !Number.isFinite(systemAddress)) {
      res.status(400).json({ ok: false, error: 'JSON body must include numeric "systemAddress".' });
      return;
    }
    if (typeof systemName !== "string" || !systemName.trim()) {
      res.status(400).json({ ok: false, error: 'JSON body must include non-empty string "systemName".' });
      return;
    }
    try {
      const result = await opts.hydrateSystemFromEdsm(systemAddress, systemName.trim());
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error ?? "EDSM hydrate failed." });
        return;
      }
      opts.scheduleBroadcast?.();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: errorText(e),
      });
    }
  });
}
