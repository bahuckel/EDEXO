/**
 * The exo-data alerts' Fix stubs and the exobiology reset (moved out of httpServer.ts,
 * audit 2026-10-22).
 */
import type express from "express";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";
import { localOnly } from "../lanAuth.js";
import type { ExoDataAlertDTO } from "../../shared/types.js";

export function registerExoDataRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
  app.post("/api/exo-data-alerts/fix", localOnly, (req, res) => {
    if (typeof opts.writeExoDataAlertFix !== "function") {
      res.status(501).json({ ok: false, error: "Fix stubs are not available in this build." });
      return;
    }
    const alert = req.body?.alert as ExoDataAlertDTO | undefined;
    if (!alert?.id || !alert.speciesEntryId || !alert.genusDataDir) {
      res.status(400).json({
        ok: false,
        error: 'Send JSON { "alert": { ... full ExoDataAlertDTO with speciesEntryId + genusDataDir } }.',
      });
      return;
    }
    try {
      const out = opts.writeExoDataAlertFix(alert);
      const lines =
        out.ok && out.written?.length
          ? [
              "Wrote or updated fixes_*.json in your user data folder, and next to the codex where that folder is writable (original JSON unchanged).",
              "Species data was reloaded — criteriaPatch entries (e.g. volcanism) apply immediately.",
              "",
              ...out.written.map((w) => `${w.relativePath}\n  (${w.root})`),
            ].join("\n")
          : "";
      let notifyTarget: "native" | "browser" = "browser";
      if (out.ok && lines && opts.showFixStubNativeDialog?.(lines)) notifyTarget = "native";
      res.json({ ...out, notifyTarget });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/exobiology/reset", localOnly, (req, res) => {
    if (typeof opts.resetExobiology !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    if (req.body?.confirm !== true) {
      res.status(400).json({
        ok: false,
        error:
          'Send JSON { "confirm": true } to clear organic progress, pending data value, and footfall flags in this session.',
      });
      return;
    }
    opts.resetExobiology();
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });
}
