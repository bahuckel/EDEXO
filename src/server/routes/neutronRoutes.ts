/**
 * `/api/neutron/*` — the neutron route planner (plan 8): the index's status and download, the ship as the journals
 * know it (range, tank, fuel, the FSD's health), and a plan through two or more systems.
 */
import type express from "express";
import { localOnly } from "../lanAuth.js";
import { touchGalaxyMemory } from "../galaxyMemory.js";
import { neutronShip } from "../neutronShip.js";
import { downloadNeutrons, loadNeutronIndex, neutronsStatus, probeNeutronsRelease } from "../neutronIndex.js";
import { applyJumponium, optimiseOrder, planNeutronRoute } from "../neutronRoute.js";
import { jumponiumView, recipeFor } from "../../shared/jumponium.js";
import { parseLiveHops, parseLivePlan } from "../neutronLive.js";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";

type Waypoint = { name: string; x: number; y: number; z: number };

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The supercharge a plan uses: the drawer's ×4 / ×6 (the ship the range is for), else the current ship's (2026-10-15:
 * a range typed in for another ship was planned with the current one's, a Caspian's ×6 for every ship or none).
 */
export function planBoost(asked: unknown, current: number | null): number {
  return asked === 4 || asked === 6 ? asked : (current ?? 4);
}

export function registerNeutronRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  ctx: RouteContext,
): void {
  /** What the journals say about the ship: range, jumps a full tank and the fuel aboard allow, the FSD's health. */
  const ship = () => {
    const store = opts.getJournalStore?.() ?? null;
    return store ? neutronShip(store, opts.getCommanderPosition?.() ?? null) : null;
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
    return {
      active: !!live?.active(),
      view: live?.view(here) ?? null,
      hops: live?.hops() ?? null,
      version: live?.version() ?? 0,
    };
  };
  app.get("/api/neutron/live", (_req, res) => res.json(liveState()));
  // The Neutron drawer follows the route being flown and the ship's range from these (R2: was every 4-5 s).
  ctx.watchTopic("neutron-live", liveState);
  ctx.watchTopic("neutron-status", () => ({ ...neutronsStatus(), ship: ship() }));
  app.post("/api/neutron/live", (req, res) => {
    const live = opts.neutronLive;
    if (!live) return void res.status(501).json({ error: "Not available in this build." });
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.stop === true) {
      live.stop();
      opts.onNeutronStopped?.();
    } else {
      const hops = parseLiveHops(body.hops);
      if (!hops) return void res.status(400).json({ error: "Not a route: plan one first." });
      // The commander's own stops and the range: what a plan from wherever the ship goes is made of.
      live.start(hops, opts.shipHere?.() ?? { name: null, pos: null }, parseLivePlan(body.plan));
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
    const boost = planBoost(body.boost, s?.boostFactor ?? null);
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
        boost,
        fsdHealth: finite(body.fsdHealth) ?? s?.fsdHealth ?? null,
        wearPerBoost: finite(body.wearPerBoost) ?? s?.wearPerBoost ?? null,
      });
      // "Use Jumponium" (owner, 2026-10-13: a toggle): the route flown with FSD injections where one saves a jump.
      const store = opts.getJournalStore?.() ?? null;
      const jp = store?.jumponium ?? null;
      const use = body.useJumponium === true;
      // Only what the materials held make (null before a Materials line: every hop, as before).
      const stock = jp?.raw ?? null;
      const applied = use ? applyJumponium(route, rangeLy, boost, (t) => recipeFor(jp, t), stock) : null;
      const view = jp?.raw ? jumponiumView(jp) : null;
      res.json({
        ...(applied ? applied.route : route),
        jumponium: {
          on: use,
          // Off: how many jumps it would take off, for the toggle's label.
          possible: use ? applied!.plan.saved : applyJumponium(route, rangeLy, boost, (t) => recipeFor(jp, t), stock).plan.saved,
          // Hops an injection would help with more materials.
          short: (applied ?? applyJumponium(route, rangeLy, boost, (t) => recipeFor(jp, t), stock)).plan.short,
          plan: applied?.plan ?? null,
          held: view ? Object.fromEntries(view.stock.map((e) => [e.key, e.count])) : null,
          makes: view ? view.tiers.map((t) => ({ tier: t.tier, name: t.name, count: t.count })) : null,
          // The FSD-under-80 % note says what an AFMU could do (the Laboratory, 1.2.16).
          afmu: view?.afmu?.length ? view.afmTiers.map((t) => ({ tier: t.tier, name: t.name, count: t.count })) : null,
        },
        waypoints: ordered,
        ship: { rangeLy, jumpsPerTank, jumpsNow },
        ms: Date.now() - t0,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
