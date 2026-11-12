/*
  The settings routes the launcher and the app post to: HUD prefs, poll rates, collection focus, the radar,
  the switches; the rest by sub-path in their own files (plan 2026-11-10 Phase 7.2).
*/
import type express from "express";
import type { PhotoStampPrefs } from "../../shared/types.js";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";
import { registerJournalSettingsRoutes } from "./journalSettingsRoutes.js";
import { registerNoticesRoutes } from "./noticesRoutes.js";
import { registerCommunityRoutes } from "./communityRoutes.js";
import { registerUiRoutes } from "./uiRoutes.js";

export function registerSettingsRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  ctx: RouteContext,
): void {
  registerJournalSettingsRoutes(app, opts);

  /** POST /api/settings/hud-prefs — the launcher mirrors its HUD settings here for phones. */
  app.post("/api/settings/hud-prefs", (req, res) => {
    if (typeof opts.setHudPrefs !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const body = req.body;
    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "JSON body must be an object." });
      return;
    }
    opts.setHudPrefs(body);
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  /**
   * How often the server re-reads `Status.json` and tails the journal.
   *
   * Both numbers are sent together even when one changed: the pair is one setting in the launcher,
   * and a partial body would make "leave the other alone" a second, silent meaning for a missing
   * field. The values are clamped server-side (`shared/pollRates.ts`) and the accepted pair comes
   * back, so a launcher that is out of step with the bounds still ends up showing the truth.
   */
  app.post("/api/settings/poll-rates", (req, res) => {
    if (typeof opts.setPollRates !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const body = req.body;
    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "JSON body must be an object." });
      return;
    }
    const statusMs = (body as { statusPollMs?: unknown }).statusPollMs;
    const journalMs = (body as { journalPollMs?: unknown }).journalPollMs;
    if (!Number.isFinite(Number(statusMs)) || !Number.isFinite(Number(journalMs))) {
      res
        .status(400)
        .json({ ok: false, error: 'JSON body must include numbers "statusPollMs" and "journalPollMs".' });
      return;
    }
    const applied = opts.setPollRates(statusMs, journalMs);
    res.json({ ok: true, ...applied });
  });

  /**
   * The collection marker's thresholds, read and written.
   *
   * The reply is always the stored config, so a value the server clamped comes straight back and the
   * panel shows what will actually be used rather than what was typed.
   */
  app.get("/api/settings/collection-focus", (_req, res) => {
    if (typeof opts.getCollectionFocus !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    res.json({ ok: true, config: opts.getCollectionFocus() });
  });

  app.post("/api/settings/collection-focus", (req, res) => {
    if (typeof opts.setCollectionFocus !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const body = req.body;
    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "JSON body must be an object." });
      return;
    }
    res.json({ ok: true, config: opts.setCollectionFocus(body) });
  });

  /** How far the sample radar draws. See `shared/radarRadius.ts` for the bounds and the reason. */
  app.post("/api/settings/radar-radius", (req, res) => {
    if (typeof opts.setRadarRadiusM !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const raw = (req.body as { radiusM?: unknown } | undefined)?.radiusM;
    if (!Number.isFinite(Number(raw))) {
      res.status(400).json({ ok: false, error: 'JSON body must include a number "radiusM".' });
      return;
    }
    res.json({ ok: true, radiusM: opts.setRadarRadiusM(raw) });
  });

  /*
    A switch the launcher or a window flips: 501 when this build has no such setting, 400 unless the body
    is {"value": true|false}, then set it and push. Six handlers were this, line for line (code review C7).
    The setter is read per request, as each handler did.
  */
  const boolSetting = (route: string, setter: () => ((value: boolean) => void) | undefined): void => {
    app.post(route, (req, res) => {
      const set = setter();
      if (typeof set !== "function") {
        res.status(501).json({ ok: false, error: "Not available" });
        return;
      }
      const value = req.body?.value;
      if (typeof value !== "boolean") {
        res.status(400).json({ ok: false, error: 'JSON body must include boolean "value".' });
        return;
      }
      set(value);
      opts.scheduleBroadcast?.();
      res.json({ ok: true });
    });
  };

  boolSetting("/api/settings/include-bacterium", () => opts.setIncludeBacterium);

  boolSetting("/api/settings/include-exploration-scan-data", () => opts.setIncludeExplorationScanData);

  /** The Data value window's "+30% Pranav Antal bonus" (owner, 2026-10-03). */
  boolSetting("/api/settings/pranav-antal-bonus", () => opts.setPranavAntalBonus);

  /** The Data value window's "Selling at a fleet carrier (−25 %)" (owner, 2026-10-03). */
  boolSetting("/api/settings/fleet-carrier-sale", () => opts.setSellAtFleetCarrier);
  boolSetting("/api/settings/feeder", () => opts.setFeederEnabled);

  /** ...and "My own carrier (−15 %)" under it (owner, 2026-10-04). */
  boolSetting("/api/settings/fleet-carrier-own", () => opts.setFleetCarrierIsOwn);

  app.post("/api/settings/photo-stamp", (req, res) => {
    if (typeof opts.setPhotoStamp !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const p: Partial<PhotoStampPrefs> = {};
    for (const k of ["commander", "system", "timestamp"] as const) {
      if (body[k] === undefined) continue;
      if (typeof body[k] !== "boolean") {
        res.status(400).json({ ok: false, error: `"${k}" must be a boolean.` });
        return;
      }
      p[k] = body[k] as boolean;
    }
    opts.setPhotoStamp(p);
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  boolSetting("/api/settings/foot-travel-odometer", () => opts.setFootTravelOdometer);

  app.post("/api/settings/exo-map-tiers", (req, res) => {
    if (typeof opts.setExoMapTierThresholds !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const plus = req.body?.plusMinCr;
    const pp = req.body?.plusPlusMinCr;
    if (
      typeof plus !== "number" ||
      typeof pp !== "number" ||
      !Number.isFinite(plus) ||
      !Number.isFinite(pp)
    ) {
      res.status(400).json({
        ok: false,
        error: 'JSON body must include finite numbers "plusMinCr" and "plusPlusMinCr" (CR).',
      });
      return;
    }
    opts.setExoMapTierThresholds(plus, pp);
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  registerNoticesRoutes(app, opts);
  registerCommunityRoutes(app, opts);
  registerUiRoutes(app, opts, ctx);
}
