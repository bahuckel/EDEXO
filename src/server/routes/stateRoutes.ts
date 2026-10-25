/*
  The live state over HTTP (split out of httpServer.ts, discuss item 30, 1.3.1): the whole state or a channel's slice,
  its revision for the clients' backup check, a candidate's detail the pushes leave out, and the on-foot scans the
  Colonize window's shell feed leaves out. The state and its revision come from the socket hub (wsHub.ts).
*/
import type express from "express";
import { findMatchDetail, parseWsChannel, slimSnapshotForChannel } from "../wsChannels.js";
import { perfBytes, perfCount, perfTime } from "../perf.js";
import type { HttpServerOptions } from "../httpServerTypes.js";
import type { WsHub } from "../wsHub.js";
import { sendJson } from "./httpHelpers.js";

export function registerStateRoutes(app: express.Express, opts: HttpServerOptions, hub: WsHub): void {
  /**
   * The revision of the last push on the app channel — a few bytes the client asks for every 10 s
   * instead of the whole snapshot (UI review P2). A different number than the last push it saw means a
   * push was missed (a half-open socket), and only then does it fetch `/api/state`.
   */
  app.get("/api/state/rev", (_req, res) => {
    res.json({ rev: hub.rev() });
  });

  /**
   * A candidate's habitat detail, variety hints and other-details cards, which the app channel leaves
   * out of every push (UI review P1b): the species card asks for them when its modal or drawer opens.
   */
  app.get("/api/match-detail", (req, res) => {
    const body = typeof req.query.body === "string" ? req.query.body : "";
    const species = typeof req.query.species === "string" ? req.query.species : "";
    if (!body || !species) {
      res.status(400).json({ error: "body and species are required" });
      return;
    }
    const hit = findMatchDetail(hub.lastSnapshot() ?? opts.getSnapshot(), body, species);
    if (!hit) {
      res.status(404).json({ error: "That candidate is no longer on this body." });
      return;
    }
    res.json(hit);
  });

  app.get("/api/state", (req, res) => {
    perfCount("http.apiState");
    res.setHeader("X-Edexo-Rev", String(hub.rev()));
    const chq = parseWsChannel(req.query?.channel) ?? "app";
    /*
      The snapshot a push or another request built in the last second, as a new socket gets it (code
      review D7, 2026-10-14): a poller, a phone and the client's HTTP backup each used to cost a full
      rebuild. A push replaces it, so a client fetching after the revision moved still gets the new one.
    */
    const snap = hub.recentSnapshot();
    const body = perfTime("http.apiState.serialize", () => JSON.stringify(slimSnapshotForChannel(snap, chq)));
    sendJson(req, res, body, (raw, sent) => {
      perfBytes("http.apiState.bytes", raw);
      perfBytes("http.apiState.sent", sent);
    });
  });

  /*
    The on-foot scans alone (discuss item 22, 1.3.1): the Colonize window's `shell` channel leaves them out (501 KB on
    the owner's profile), and its Encyclopedia and My exobiology ask for them here when they open.
  */
  app.get("/api/foot-scanned", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ entries: hub.recentSnapshot().footScannedEntries ?? [] });
  });
}
