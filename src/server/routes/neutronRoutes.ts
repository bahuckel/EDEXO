/**
 * `/api/neutron/*` — the neutron route planner (plan 8): the index's status and download, the ship as the journals
 * know it (range, tank, fuel, the FSD's health), and a plan through two or more systems.
 */
import type express from "express";
import { localOnly } from "../lanAuth.js";
import { touchGalaxyMemory } from "../galaxyMemory.js";
import { fullJumpRange } from "../../shared/jumpRange.js";
import { fsdFuelModel } from "../../shared/fsdFuel.js";
import { fsdWearEstimate, FSD_WARN } from "../../shared/fsdWear.js";
import { downloadNeutrons, loadNeutronIndex, neutronsStatus, probeNeutronsRelease } from "../neutronIndex.js";
import { optimiseOrder, planNeutronRoute } from "../neutronRoute.js";
import { parseLiveHops } from "../neutronLive.js";
import type { HttpServerOptions, RouteContext } from "../httpServer.js";

type Waypoint = { name: string; x: number; y: number; z: number };

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function registerNeutronRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
  /** What the journals say about the ship: range, jumps a full tank and the fuel aboard allow, the FSD's health. */
  const ship = () => {
    const store = opts.getJournalStore?.() ?? null;
    if (!store) return null;
    const model = fsdFuelModel(store.fsdFuel);
    const perJump = model?.maxFuelPerJumpT ?? null;
    const tank = store.loadoutFuelMainCapacityT;
    const now = store.liveStatusFuelMainT;
    const wear = fsdWearEstimate(store.fsdWear);
    return {
      rangeLy: fullJumpRange(store.jumpRange) ?? store.loadoutMaxJumpRangeLy ?? null,
      fuelPerJumpT: perJump,
      jumpsPerTank: perJump && tank ? Math.floor(tank / perJump) : null,
      jumpsNow: perJump && now != null ? Math.floor(now / perJump) : null,
      fsdHealth: wear.health,
      wearPerBoost: wear.wearPerBoost,
      wearIsDefault: wear.wearIsDefault,
      wearFrom: wear.wearFrom,
      boostFactor: wear.boostFactor,
      shipType: wear.ship,
      boostsSinceLoadout: wear.boostsSince,
      fsdWarn: FSD_WARN,
      position: store.commanderPos ?? opts.getCommanderPosition?.() ?? null,
      system: store.currentSystem ?? null,
    };
  };

  app.get("/api/neutron/status", async (_req, res) => {
    await probeNeutronsRelease();
    res.json({ ...neutronsStatus(), ship: ship() });
  });

  app.post("/api/neutron/download", localOnly, (_req, res) => {
    void downloadNeutrons(() => opts.scheduleBroadcast?.());
    res.json({ ok: true, status: neutronsStatus() });
  });

  /*
    The route being flown (plan 8.5): `GET` what it is, `POST { hops }` starts it (the plan's hops; its next stop goes
    to the clipboard, the boxel run ends), `POST { stop: true }` ends it.
  */
  const liveState = () => {
    const live = opts.neutronLive;
    const here = opts.shipHere?.() ?? { name: null, pos: null };
    return { active: !!live?.active(), view: live?.view(here) ?? null, hops: live?.hops() ?? null };
  };
  app.get("/api/neutron/live", (_req, res) => res.json(liveState()));
  app.post("/api/neutron/live", (req, res) => {
    const live = opts.neutronLive;
    if (!live) return void res.status(501).json({ error: "Not available in this build." });
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.stop === true) live.stop();
    else {
      const hops = parseLiveHops(body.hops);
      if (!hops) return void res.status(400).json({ error: "Not a route: plan one first." });
      live.start(hops, opts.shipHere?.() ?? { name: null, pos: null });
    }
    opts.scheduleBroadcast?.();
    res.json(liveState());
  });

  app.post("/api/neutron/plan", async (req, res) => {
    touchGalaxyMemory();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(body.waypoints) ? (body.waypoints as Record<string, unknown>[]) : [];
    const waypoints: Waypoint[] = [];
    for (const w of raw.slice(0, 20)) {
      const x = finite(w.x);
      const y = finite(w.y);
      const z = finite(w.z);
      if (x == null || y == null || z == null)
        return void res.status(400).json({ error: "Every stop needs x, y and z." });
      waypoints.push({ name: String(w.name ?? "").slice(0, 80) || "Stop", x, y, z });
    }
    if (waypoints.length < 2)
      return void res.status(400).json({ error: "A route needs at least two systems." });
    const s = ship();
    const rangeLy = finite(body.rangeLy) ?? s?.rangeLy ?? null;
    const jumpsPerTank = finite(body.jumpsPerTank) ?? s?.jumpsPerTank ?? null;
    const jumpsNow = finite(body.jumpsNow) ?? s?.jumpsNow ?? jumpsPerTank;
    if (rangeLy == null || !(rangeLy >= 5 && rangeLy <= 500))
      return void res.status(400).json({ error: "Jump range unknown: fly a jump, or give it (5-500 ly)." });
    if (jumpsPerTank == null || !(jumpsPerTank >= 1 && jumpsPerTank <= 200))
      return void res.status(400).json({ error: "Jumps per tank unknown: give it (1-200)." });
    let index;
    try {
      index = loadNeutronIndex();
    } catch (e) {
      return void res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
    if (!index) return void res.status(404).json({ error: "No neutron star data yet: download it first." });
    const ordered = body.optimise === true ? optimiseOrder(waypoints) : waypoints;
    const t0 = Date.now();
    try {
      const route = await planNeutronRoute(index, ordered, {
        rangeLy,
        jumpsPerTank,
        jumpsNow: Math.min(jumpsPerTank, Math.max(0, jumpsNow ?? jumpsPerTank)),
        boost: s?.boostFactor ?? undefined,
        fsdHealth: finite(body.fsdHealth) ?? s?.fsdHealth ?? null,
        wearPerBoost: finite(body.wearPerBoost) ?? s?.wearPerBoost ?? null,
      });
      res.json({
        ...route,
        waypoints: ordered,
        ship: { rangeLy, jumpsPerTank, jumpsNow },
        ms: Date.now() - t0,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
