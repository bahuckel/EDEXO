/*
  The journal folder, its history window and the feeder's data folder and imports (split out of settingsRoutes.ts,
  plan 2026-11-10 Phase 7.2; registered from it).
*/
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type express from "express";
import { isJournalHistoryPreset } from "../../shared/journalHistoryPreset.js";
import { feederDataDirExists, feederInboxDir, setConfiguredFeederDataDir } from "../../feeder/paths.js";
import { parseSpanshRouteFile, summariseSpanshRouteFile } from "../../feeder/spanshRouteFile.js";
import { localOnly } from "../lanAuth.js";
import type { HttpServerOptions } from "../httpServerTypes.js";
import { errorText } from "../errorText.js";

export function registerJournalSettingsRoutes(app: express.Express, opts: HttpServerOptions): void {
  app.post("/api/settings/journal-directory", localOnly, async (req, res) => {
    if (typeof opts.setJournalDirectory !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const dir = req.body?.journalDir;
    if (typeof dir !== "string" || !dir.trim()) {
      res.status(400).json({ ok: false, error: 'JSON body must include string "journalDir".' });
      return;
    }
    const result = await opts.setJournalDirectory(dir.trim());
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error ?? "Invalid folder." });
      return;
    }
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  /**
   * Where the feeder corpus lives, remembered across restarts.
   *
   * Needed because the two built-in search paths are relative to `PROJECT_ROOT`, which in a packaged
   * build is the install directory — so a corpus kept beside the repository is unreachable and the
   * feeder hides itself. Sending `null` forgets the path and falls back to the search.
   */
  /**
   * Accept a Spansh exobiology route export and queue it for the feeder.
   *
   * The file is parsed here so the panel can say what is in it immediately, and then written to the
   * corpus inbox rather than imported: the packaged app has no `sql.js` and cannot write a row to
   * the corpus. `npm run feeder -- import` drains the inbox.
   *
   * A route export is a few hundred kilobytes, so it arrives as text in the JSON body rather than as
   * a multipart upload, which would mean a new dependency for one endpoint.
   */
  app.post("/api/feeder/import", localOnly, (req, res) => {
    const text = req.body?.text;
    const name = typeof req.body?.filename === "string" ? req.body.filename : "route";
    if (typeof text !== "string" || !text.trim()) {
      res.status(400).json({ ok: false, error: 'JSON body must include a non-empty string "text".' });
      return;
    }
    if (!feederDataDirExists()) {
      res
        .status(409)
        .json({ ok: false, error: "No corpus on this machine. Set its folder in Options first." });
      return;
    }
    let summary;
    try {
      summary = summariseSpanshRouteFile(parseSpanshRouteFile(text));
    } catch (e) {
      res
        .status(400)
        .json({ ok: false, error: e instanceof Error ? e.message : "Could not read that file." });
      return;
    }
    if (summary.rows === 0) {
      res.status(400).json({ ok: false, error: "No landmark rows in that file." });
      return;
    }
    try {
      const dir = feederInboxDir();
      mkdirSync(dir, { recursive: true });
      // Timestamp first so the inbox drains oldest-first by name, and the original name is kept so
      // the owner can tell two routes apart.
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "route";
      const ext = summary.format === "json" ? "json" : "csv";
      const file = path.join(dir, `${stamp}__${safe.replace(/\.(json|csv)$/i, "")}.${ext}`);
      writeFileSync(file, text, "utf8");
      res.json({ ok: true, queuedAs: file, summary });
    } catch (e) {
      res
        .status(500)
        .json({ ok: false, error: e instanceof Error ? e.message : "Could not queue the file." });
    }
  });

  app.post("/api/settings/feeder-data-directory", localOnly, (req, res) => {
    const raw = req.body?.feederDataDir;
    if (raw !== null && typeof raw !== "string") {
      res.status(400).json({ ok: false, error: 'JSON body must include string or null "feederDataDir".' });
      return;
    }
    const result = setConfiguredFeederDataDir(raw);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error ?? "Invalid folder." });
      return;
    }
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.post("/api/settings/journal-history", async (req, res) => {
    if (typeof opts.setJournalHistoryPreset !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const preset = req.body?.preset;
    if (!isJournalHistoryPreset(preset)) {
      res.status(400).json({
        ok: false,
        error: 'JSON body must include string "preset" (all | 1m | 6m | 1y … 5y).',
      });
      return;
    }
    try {
      await opts.setJournalHistoryPreset(preset);
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
