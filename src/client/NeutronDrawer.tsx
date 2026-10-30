/**
 * Galaxy map → Neutron route (plan 8, owner 2026-10-13): a route from where the ship is through one or more stops
 * ("always taking into consideration your current location"), by supercharged jumps
 * from neutron star to neutron star, with refuel stops at neutron stars that have a scoopable star of their own and
 * a warning where the FSD's health is expected under 80 %. The ship's range, tank and fuel come from the journals and
 * can be changed; the neutron stars are an optional download beside the galaxy index.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtLy } from "@shared/format";
import type { GalaxyFindDTO } from "@shared/dto/galaxy";
import { FlaskConical, Fuel, Zap } from "lucide-react";
import { G3D_HELP, MenuCheck, MenuHead, MenuRow } from "./galaxy3d/G3dMenu";
import { keepNeutronMarks, keptNeutronMarks, type NeutronMark } from "./galaxy3d/neutronMarks";
import { PickList, type PickOption } from "./galaxy3d/PickList";
import { CopySystemButton } from "./CopySystemButton";
import { isBool, usePersistedState } from "./usePersistedState";
import { onServerChange } from "./serverChanges";
import { routeTotals, routeValueLine, useRouteValues } from "./routeValues";
import { fmtCrShort } from "@shared/format";

const isBoost = (v: unknown): v is number | null => v === null || v === 4 || v === 6;

type Pt = { x: number; y: number; z: number };
/** A stop: its place, and its address when the search gave one (its worth from Spansh, plan 1.3.3 R-3). */
type Stop = Pt & { name: string; address?: number };

interface Ship {
  rangeLy: number | null;
  jumpsPerTank: number | null;
  jumpsNow: number | null;
  /** The main tank the plan starts from (t): live, or the last known with its time; null unknown (a full tank). */
  fuelNowT?: number | null;
  fuelNowFrom?: "live" | "last" | null;
  fuelNowAt?: string | null;
  fsdHealth: number | null;
  wearPerBoost: number;
  wearIsDefault: boolean;
  /** This ship's own supercharges, other ships with the same drive, or the default (shared/fsdWear.ts). */
  wearFrom: "ship" | "drive" | "default";
  /** A supercharge multiplies the range by this: the drive's (6 for the Mk II SCO drive, else 4). */
  boostFactor: number;
  /** The ship type is one the app knows; when not, the commander's own ×4 / ×6 is kept. */
  shipKnown?: boolean;
  shipType: string | null;
  fsdWarn: number;
  position: Pt | null;
  system: string | null;
}
interface Status {
  present: boolean;
  neutrons: number | null;
  dump: string | null;
  downloading: { done: number; total: number | null } | null;
  error: string | null;
  release: { neutrons: number; bytes: number } | null;
  ship: Ship | null;
}
export interface NeutronHopDTO {
  name: string;
  x: number;
  y: number;
  z: number;
  kind: "start" | "neutron" | "waypoint";
  jumps: number;
  boosted: number;
  distanceLy: number;
  refuel: boolean;
  /** Scoop to half a tank, not full: the plan counts on the lighter ship's range. */
  refuelHalf?: boolean;
  scoopOnWay: boolean;
  scoopLs: number | null;
  jumpsLeft: number;
  fsdHealth: number | null;
  /** "Use Jumponium": the FSD injections planned for this hop's normal jumps (one jump fewer), else null. */
  inject?: { tier: "basic" | "standard" | "premium"; count: number } | null;
  /** The unboosted range the hop is planned with: the fuel aboard as it leaves sets it. */
  rangeLy?: number;
  /** The neutron star's system address: its worth from Spansh (plan 1.3.3 R-3). */
  address?: number;
}
interface RouteDTO {
  hops: NeutronHopDTO[];
  jumps: number;
  boosted: number;
  distanceLy: number;
  plainJumps: number;
  refuels: number;
  repairBefore: number | null;
  unsafeLegs: number[];
  waypoints: Stop[];
  ms: number;
  /** "Use Jumponium" (owner, 2026-10-13: a toggle): what the injections do on this route and what they take. */
  jumponium?: {
    on: boolean;
    /** Jumps they take off (on), or would (off), with the materials held. */
    possible: number;
    /** Hops an injection would shorten with more materials than are held. */
    short?: number;
    plan: { saved: number; used: Record<string, number>; needs: Record<string, number>; short?: number } | null;
    held: Record<string, number> | null;
    makes: { tier: string; name: string; count: number }[] | null;
    /** An AFMU is fitted: the AFM refills the hold makes; null without one. */
    afmu?: { tier: string; name: string; count: number }[] | null;
  };
}

const TIER_NAME: Record<string, string> = { basic: "Basic", standard: "Standard", premium: "Premium" };
const SYMBOL: Record<string, string> = {
  carbon: "C",
  vanadium: "V",
  germanium: "Ge",
  arsenic: "As",
  cadmium: "Cd",
  niobium: "Nb",
  yttrium: "Y",
  polonium: "Po",
};

/** The route being flown (`/api/neutron/live`, plan 8.5). */
interface LiveDTO {
  active: boolean;
  view: {
    at: number;
    total: number;
    next: string | null;
    destination: string;
    done: boolean;
    replanning: boolean;
  } | null;
  hops: NeutronMark[] | null;
  /** Bumped with every new route, a re-plot from where the ship went included. */
  version: number;
}

const pct = (v: number | null) => (v == null ? "?" : `${Math.round(v * 100)} %`);

/*
  The plan, kept while another drawer is open (owner, 2026-10-28: "click on some other tab (i.e. Layers) … it forgets
  the whole route", its line still on the map): the map unmounts a drawer it is not showing, so the stops, the
  ship's numbers and the route live here, for as long as the window; its line and dots in galaxy3d/neutronMarks.ts.
*/
const kept = {
  stops: [] as Stop[],
  range: "",
  tank: "",
  /** The range and jumps a tank last filled in from the ship: a field still holding them follows the ship. */
  rangeFromShip: null as string | null,
  tankFromShip: null as string | null,
  boostNow: null as number | null,
  optimise: false,
  route: null as RouteDTO | null,
  liveVersion: -1,
  /** The newest plan asked for, by any opening of the drawer: an older answer is stale. */
  planSeq: 0,
  /** A plan still on its way, for a drawer opened while it runs. */
  inFlight: null as Promise<RouteDTO | null> | null,
};

export function NeutronDrawer({
  onRoute,
  onFocus,
}: {
  onRoute: (marks: NeutronMark[]) => void;
  onFocus: (p: Pt) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [stops, setStops] = useState<Stop[]>(kept.stops);
  const [query, setQuery] = useState("");
  // What the search found: the galaxy map's systems, the stations' (by station name), then Spansh's (any system).
  const [found, setFound] = useState<(Stop & { label?: string })[]>([]);
  const [range, setRange] = useState(kept.range);
  const [tank, setTank] = useState(kept.tank);
  /*
    The supercharge (owner, 2026-10-15; by the drive since 2026-10-20): the FSD in the ship's Loadout picks it (×6 the
    Mk II SCO drive, ×4 every other drive), else the ship type; when neither says, it stays at ×4 and the commander's
    own pick is remembered.
  */
  const [boostPicked, setBoostPicked] = usePersistedState<number | null>("galaxy.neutron.boost", null, isBoost);
  const [boostNow, setBoostNow] = useState<number | null>(kept.boostNow);
  const [optimise, setOptimise] = useState(kept.optimise);
  const [useJump, setUseJump] = usePersistedState("galaxy.neutron.jumponium", false, isBool);
  const [halfTank, setHalfTank] = usePersistedState("galaxy.neutron.halfTank", false, isBool);
  const [route, setRoute] = useState<RouteDTO | null>(kept.route);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveDTO | null>(null);
  useEffect(() => {
    Object.assign(kept, { stops, range, tank, boostNow, optimise, route });
  }, [stops, range, tank, boostNow, optimise, route]);
  const draw = useCallback(
    (marks: NeutronMark[]) => {
      keepNeutronMarks(marks);
      onRoute(marks);
    },
    [onRoute],
  );
  // Back from another drawer, or the galaxy tab drawn again: the kept route's line with it.
  useEffect(() => {
    if (keptNeutronMarks().length) onRoute(keptNeutronMarks());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the drawer opens
  }, []);
  // A plan still running when the drawer was closed for another menu: its answer here once it comes.
  useEffect(() => {
    const p = kept.inFlight;
    if (!p) return;
    let open = true;
    setBusy(true);
    void p.then((j) => {
      if (!open) return;
      if (j) {
        setRoute(j);
        setStops(kept.stops);
      }
      setBusy(false);
    });
    return () => {
      open = false;
    };
  }, []);

  const load = () =>
    void fetch("/api/neutron/status")
      .then((r) => r.json())
      .then((j: Status) => setStatus(j))
      .catch((e) => setError(String(e)));
  useEffect(load, []);
  /*
    A route being flown: shown and drawn on the map. Asked again every few seconds while one is flown, so a re-plot
    from where the ship went (server/neutronLive.ts) is drawn, and the end of the route clears the map.
  */
  const readLive = useCallback(() => {
    void fetch("/api/neutron/live")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: LiveDTO | null) => {
        if (!j) return;
        setLive(j);
        if (j.version === kept.liveVersion) return;
        const first = kept.liveVersion < 0;
        kept.liveVersion = j.version;
        if (j.active && j.hops) {
          draw(j.hops);
          // A re-plot replaced the plan in the table: the map shows the one being flown.
          if (!first) setRoute(null);
        } else {
          // Ended (arrived, stopped, a boxel run) — also while the drawer was closed: no line stays (review 1.2.16).
          if (!first) setRoute(null);
          draw([]);
        }
      })
      .catch(() => undefined);
  }, [draw]);
  useEffect(readLive, [readLive]);
  // A re-plot, an arrival or a stop from another window (R2, 2026-10-24: was asked every 4 s while flying).
  useEffect(() => onServerChange("neutron-live", readLive), [readLive]);
  const setFlying = async (body: object) => {
    setError(null);
    try {
      const r = await fetch("/api/neutron/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as LiveDTO & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
      kept.liveVersion = j.version;
      setLive(j);
      return j;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };
  /** Stop: nothing of the route stays, on the map, the HUD or the clipboard line (owner, 2026-10-13). */
  const stopFlying = async () => {
    const j = await setFlying({ stop: true });
    if (j && !j.active) {
      setRoute(null);
      draw([]);
    }
  };
  useEffect(() => {
    if (!status?.downloading) return;
    const t = setTimeout(load, 1000);
    return () => clearTimeout(t);
  }, [status]);

  /*
    The route always starts where the ship is (owner, 2026-10-13: "always taking into consideration your current
    location and trying to plot from it to your designated stops"): the stops are the destinations, and where the
    ship is comes from the journals, read again every few seconds while the drawer is open.
  */
  const ship = status?.ship ?? null;
  // A known ship: its own (picking another is for this plan only); an unknown one: the remembered pick, else ×4.
  const boost = boostNow ?? (ship?.shipKnown === false ? (boostPicked ?? 4) : null);
  const setBoost = (v: number) => {
    setBoostNow(v);
    if (ship?.shipKnown === false) setBoostPicked(v);
  };
  /*
    The ship's range and jumps a tank fill the fields, and follow the ship (a refit, another ship) until typed over
    (owner, 2026-10-28: after a refit they only showed after some jumps).
  */
  useEffect(() => {
    if (!ship) return;
    const r = ship.rangeLy ? ship.rangeLy.toFixed(1) : null;
    const t = ship.jumpsPerTank ? String(ship.jumpsPerTank) : null;
    if (r != null && (!range || range === kept.rangeFromShip)) setRange(r);
    if (t != null && (!tank || tank === kept.tankFromShip)) setTank(t);
    if (r != null) kept.rangeFromShip = r;
    if (t != null) kept.tankFromShip = t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ship]);
  // A jump or an outfitting changed the ship (R2, 2026-10-24: was asked every 5 s).
  useEffect(() => onServerChange("neutron-status", load), []);
  const from: Stop | null = ship?.position ? { name: ship.system ?? "Your ship", ...ship.position } : null;
  // Without a position from the journals (no jump yet), the first stop is where the route starts.
  const waypoints = from ? [from, ...stops] : stops;

  /*
    The galaxy map's index holds systems with biology recorded (and the commander's own): a system without, the
    destination of a trip to a station, was "Nothing matches" (owner, 2026-10-30: Stuemeae FG-Y d7561, Explorer's
    Anchorage). The stations by name, then Spansh's name search, which gives any system it knows with its place.
  */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setFound([]);
    const ac = new AbortController();
    const merged: (Stop & { label?: string })[] = [];
    const have = new Set<string>();
    const add = (rows: (Stop & { label?: string })[]) => {
      for (const r of rows) {
        const k = r.name.toLowerCase();
        if (have.has(k)) continue;
        have.add(k);
        merged.push(r);
      }
      if (!ac.signal.aborted) setFound(merged.slice(0, 40));
    };
    const t = window.setTimeout(() => {
      void fetch(`/api/galaxy/find?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: GalaxyFindDTO | null) => {
          add(
            (j?.systems ?? [])
              .slice(0, 30)
              .map((s) => ({ name: s.name, x: s.x, y: s.y, z: s.z, ...(s.addr ? { address: Number(s.addr) } : {}) })),
          );
          add((j?.stations ?? []).slice(0, 10).map((s) => ({ name: s.system, x: s.x, y: s.y, z: s.z, label: `${s.name} · ${s.system}` })));
        })
        .catch(() => undefined)
        .then(() =>
          q.length < 3
            ? null
            : fetch(`/api/system/spansh-search?q=${encodeURIComponent(q)}`, { signal: ac.signal })
                .then((r) =>
                  r.ok
                    ? (r.json() as Promise<{ systems?: { systemAddress: number; starSystem: string; x?: number; y?: number; z?: number }[] }>)
                    : null,
                )
                .then((j) =>
                  add(
                    (j?.systems ?? [])
                      .filter((s) => s.x != null && s.y != null && s.z != null)
                      // The name typed in full first: Spansh's completion lists near names in its own order.
                      .sort((a, b) => Number(b.starSystem.toLowerCase() === q.toLowerCase()) - Number(a.starSystem.toLowerCase() === q.toLowerCase()))
                      .map((s) => ({ name: s.starSystem, x: s.x!, y: s.y!, z: s.z!, address: s.systemAddress, label: `${s.starSystem} · Spansh` })),
                  ),
                ),
        )
        .catch(() => undefined);
    }, 250);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [query]);
  const options: PickOption[] = useMemo(() => found.map((s) => ({ value: s.name, label: s.label ?? s.name })), [found]);
  // Each hop's system valued from Spansh while a route is shown (routeValues.ts), at most the first 150 hops.
  const valued = useMemo(
    () =>
      (route?.hops ?? [])
        .filter((h): h is NeutronHopDTO & { address: number } => typeof h.address === "number")
        .slice(0, 150)
        .map((h) => ({ addr: h.address, name: h.name })),
    [route],
  );
  const { values: hopValues, read: hopsRead } = useRouteValues(valued, valued.length > 0);
  const hopTotals = routeTotals(hopValues.values());

  const move = (i: number, d: number) =>
    setStops((prev) => {
      const j = i + d;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  /*
    A plan takes seconds, and the drawer may close for another menu meanwhile (2026-10-29: the new route's line on the
    map, the old route in the list when it opened again): the answer goes into `kept` itself, not only into this
    drawer's state, which a closed drawer no longer has.
  */
  const plan = (): Promise<RouteDTO | null> => {
    const p = planNow();
    kept.inFlight = p;
    void p.finally(() => {
      if (kept.inFlight === p) kept.inFlight = null;
    });
    return p;
  };
  const planNow = async (): Promise<RouteDTO | null> => {
    const seq = ++kept.planSeq;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/neutron/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waypoints,
          rangeLy: Number(range) || undefined,
          jumpsPerTank: Number(tank) || undefined,
          boost: boost ?? undefined,
          optimise,
          useJumponium: useJump,
          halfTank,
        }),
      });
      const j = (await r.json()) as RouteDTO & { error?: string };
      // A newer plan was asked for meanwhile (Use Jumponium flipped twice): this answer is stale (review 1.2.16).
      if (seq !== kept.planSeq) return null;
      if (!r.ok) throw new Error(j.error ?? `Plan failed (${r.status})`);
      kept.route = j;
      if (optimise) kept.stops = from ? j.waypoints.slice(1) : j.waypoints;
      setRoute(j);
      setStops(kept.stops);
      draw(j.hops);
      return j;
    } catch (e) {
      if (seq === kept.planSeq) setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      if (seq === kept.planSeq) setBusy(false);
    }
  };
  // Use Jumponium or half a tank flipped with a route on screen: plan it again with (or without) it.
  const jumpSeen = useRef({ useJump, halfTank });
  useEffect(() => {
    if (jumpSeen.current.useJump === useJump && jumpSeen.current.halfTank === halfTank) return;
    jumpSeen.current = { useJump, halfTank };
    if (route && waypoints.length >= 2) void plan();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the toggles replan
  }, [useJump, halfTank]);
  /*
    Fly: from where the ship is now. A plan made somewhere else is made again from here first; the destinations go
    with it, so the server can plot again from wherever the ship goes off the route.
  */
  const fly = async () => {
    let r = route;
    const start = r?.hops[0];
    const moved = !!from && !!start && Math.hypot(start.x - from.x, start.y - from.y, start.z - from.z) > 0.1;
    if (!r || moved) r = await plan();
    if (!r) return;
    await setFlying({
      hops: r.hops,
      plan: {
        targets: r.waypoints.slice(1),
        rangeLy: Number(range) || ship?.rangeLy || undefined,
        boost: boost ?? undefined,
        useJumponium: r.jumponium?.on === true,
        halfTank,
      },
    });
  };

  /*
    A supercharge reaches the range times four (six), and the range grows as the tank empties: a hop leaving with
    part of a tank goes past the full tank's reach (owner, 2026-10-28: "74 ly … x4 is 296 ly, I still see 305 ly
    jumps"). Said on each supercharged hop, and once above the table.
  */
  const factor = boost ?? ship?.boostFactor ?? 4;
  const fullReach = (Number(range) || ship?.rangeLy || 0) * factor;
  const reachNote = (h: NeutronHopDTO) =>
    h.rangeLy
      ? `Planned with the fuel aboard as it leaves: ${h.rangeLy.toFixed(1)} ly × ${factor} = ${Math.round(h.rangeLy * factor)} ly reach${fullReach ? ` (a full tank: ${Math.round(fullReach)} ly)` : ""}.`
      : "";
  const pastFull = route
    ? route.hops.filter((h) => h.boosted && h.jumps === 1 && fullReach && h.distanceLy > fullReach + 0.5).length
    : 0;

  const download = () => void fetch("/api/neutron/download", { method: "POST" }).then(load);
  const rel = status?.release;

  return (
    <aside className="g3d-drawer g3d-menu g3d-plan" aria-label="Neutron route" data-testid="g3d-neutron">
      <MenuHead title="Neutron route" help={G3D_HELP.neutron} />
      {!status?.present ? (
        <div className="g3d-menu__section g3d-menu__section--first">
          <p className="g3d-panel__note">
            The planner needs the neutron stars:{" "}
            {rel ? `${rel.neutrons.toLocaleString("en-US")} of them, ` : ""}one download
            {rel ? ` of ${Math.round(rel.bytes / 1e6)} MB` : ""} beside the galaxy index. Routes are planned
            on this machine.
          </p>
          <button
            type="button"
            className="btn-top-toggle"
            onClick={download}
            disabled={!!status?.downloading}
          >
            {status?.downloading
              ? `Downloading… ${status.downloading.total ? Math.round((status.downloading.done / status.downloading.total) * 100) : 0} %`
              : "Download neutron stars"}
          </button>
          {status?.error ? <p className="g3d-panel__note">Download failed: {status.error}</p> : null}
        </div>
      ) : (
        <>
          {live?.active && live.view ? (
            <div className="g3d-menu__section g3d-menu__section--first">
              <p className="g3d-panel__note">
                Flying a route to <strong>{live.view.destination}</strong>: stop {live.view.at} of{" "}
                {live.view.total}
                {live.view.next ? (
                  <>
                    , next <strong>{live.view.next}</strong> (on the clipboard: target it in the galaxy map, don't plot to it; F6
                    copies it again)
                  </>
                ) : null}
                .
              </p>
              {live.view.replanning ? (
                <p className="g3d-panel__note">Off the route: re-plotting from where you are…</p>
              ) : null}
              <button
                type="button"
                className="btn-top-toggle g3d-neutron-stop"
                title="Ends the route: the HUD, the clipboard line and the line on the map clear"
                onClick={() => void stopFlying()}
              >
                ■ Stop flying this route
              </button>
            </div>
          ) : null}
          <div className={`g3d-menu__section${live?.active ? "" : " g3d-menu__section--first"}`}>
            <p className="g3d-menu__sub">From</p>
            <p className="g3d-panel__note">
              {from ? (
                <>
                  Your ship · <strong>{from.name}</strong> (follows you as you jump)
                </>
              ) : (
                "Your position is not known yet (no jump in the journals): the first stop is the start."
              )}
            </p>
            <p className="g3d-menu__sub">{from ? "To, in order" : "Stops, in order"}</p>
            <ol className="g3d-neutron-stops">
              {stops.map((s, i) => (
                <li key={`${s.name}-${i}`}>
                  <button type="button" className="g3d-linkbtn" onClick={() => onFocus(s)}>
                    {s.name}
                  </button>
                  <span className="g3d-neutron-stops__btns">
                    <button type="button" aria-label="Earlier" onClick={() => move(i, -1)} disabled={i === 0}>
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Later"
                      onClick={() => move(i, 1)}
                      disabled={i === stops.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() => setStops((p) => p.filter((_s, k) => k !== i))}
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ol>
            <PickList
              label="Add"
              hint="A system by name (the galaxy map's, a station's, or any Spansh knows): it goes at the end of the stops"
              value=""
              valueLabel="Add a system"
              options={options}
              onQuery={setQuery}
              onChange={(name) => {
                const s = found.find((x) => x.name === name);
                if (s) setStops((p) => [...p, { name: s.name, x: s.x, y: s.y, z: s.z, ...(s.address ? { address: s.address } : {}) }]);
              }}
              placeholder="Search a system"
            />
          </div>
          <div className="g3d-menu__section">
            <MenuRow
              label="Jump range"
              hint={`Laden, unboosted, with a full tank, as your jumps show it (change it for another ship); a supercharge reaches ${(boost ?? ship?.boostFactor) === 6 ? "six times this (the Mk II SCO drive)" : "four times this"}, and further on a part tank`}
            >
              <input
                className="g3d-input g3d-row__val"
                inputMode="decimal"
                value={range}
                onChange={(e) => setRange(e.target.value)}
                aria-label="Jump range (ly)"
              />
            </MenuRow>
            <MenuRow
              label="Supercharge"
              hint={
                ship?.shipKnown === false
                  ? "Neither your ship's drive nor its type is one the app knows yet (a game update?): ×4 unless you pick ×6, and your pick is remembered"
                  : "From your ship's frame shift drive, as the game writes it at login: ×6 with the Mk II SCO drive (the Caspian Explorer's), ×4 with any other. Pick another for a range typed in for another ship"
              }
            >
              <select
                className="g3d-select g3d-row__val"
                value={String(boost ?? ship?.boostFactor ?? 4)}
                onChange={(e) => setBoost(Number(e.target.value))}
                aria-label="Supercharge"
              >
                <option value="4">×4</option>
                <option value="6">×6 (Mk II SCO drive)</option>
              </select>
            </MenuRow>
            <MenuRow
              label="Jumps a tank"
              hint="Full-range jumps a full tank does, from your drive's fuel per jump and the tank (Loadout)"
            >
              <input
                className="g3d-input g3d-row__val"
                inputMode="numeric"
                value={tank}
                onChange={(e) => setTank(e.target.value)}
                aria-label="Jumps per tank"
              />
            </MenuRow>
            <MenuRow
              label="Fuel now"
              hint="The main tank the plan starts from: live while the game runs, else the last your journals said (a jump, a scoop, a refuel); a full tank only when nothing is known"
            >
              <span className="g3d-row__val">
                {ship?.fuelNowT != null
                  ? `${ship.fuelNowT.toFixed(1)} t${ship.fuelNowFrom === "last" ? ` · last known${ship.fuelNowAt ? ` ${new Date(ship.fuelNowAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}` : ""}`
                  : "Full tank (unknown)"}
              </span>
            </MenuRow>
            <MenuRow
              label="FSD health"
              hint="The last Loadout's, less the supercharges since; under 80 % the plan says to repair"
            >
              <span className="g3d-row__val">{pct(ship?.fsdHealth ?? null)}</span>
            </MenuRow>
            {/* The wear on its own line: in the value box it pushed the label out of the row (owner, 2026-10-13). */}
            {ship ? (
              <p className="g3d-panel__note">
                {(ship.wearPerBoost * 100).toFixed(2)} % wear a supercharge
                {ship.wearFrom === "ship"
                  ? " (this ship's, from its Loadouts)"
                  : ship.wearFrom === "drive"
                    ? " (from other ships with this drive, until this one has three supercharges between two Loadouts)"
                    : " (estimate, until this ship has three supercharges between two Loadouts)"}{" "}
                · this ship supercharges ×{ship.boostFactor}
              </p>
            ) : null}
            <MenuCheck
              label="Optimise the order"
              hint="The stops in the shortest order; the first and the last stay where they are"
              on={optimise}
              set={setOptimise}
            />
            <MenuCheck
              label="Scoop to half a tank where it saves jumps"
              hint="A lighter ship jumps further: refuel stops may scoop to half a tank where the next supercharges then reach further (Spansh's way). A jump or two fewer on a long trip at most, for more scoop stops, and often none with a small tank; the plan says “scoop to half” where it counts on it, and a full tank there falls short."
              on={halfTank}
              set={setHalfTank}
              disabled={busy}
              note={route && halfTank ? `(${route.hops.filter((h) => h.refuelHalf).length} of ${route.refuels} stops)` : undefined}
            />
            <MenuCheck
              label="Use Jumponium"
              hint="Plan with FSD injections: on every hop where one takes a jump off its normal jumps (it never adds to a supercharged jump), the cheapest by material, one per jump. The HUD says which to synthesise on the way."
              on={useJump}
              set={setUseJump}
              disabled={busy}
              note={
                route?.jumponium && !route.jumponium.on && route.jumponium.possible
                  ? `(−${route.jumponium.possible} jump${route.jumponium.possible === 1 ? "" : "s"} on this route)`
                  : undefined
              }
            />
            <button
              type="button"
              className="btn-top-toggle"
              onClick={() => void plan()}
              disabled={busy || waypoints.length < 2}
            >
              {busy ? "Planning…" : "Plan the route"}
            </button>
            {error ? <p className="g3d-panel__note">{error}</p> : null}
          </div>
          {route ? (
            <div className="g3d-menu__section">
              <p className="g3d-panel__note">
                <strong>{route.jumps}</strong> jumps ({route.boosted} supercharged) instead of{" "}
                {route.plainJumps} · {fmtLy(route.distanceLy)} · {route.refuels} refuel stop
                {route.refuels === 1 ? "" : "s"} · {route.ms} ms
              </p>
              <button
                type="button"
                className="btn-top-toggle"
                title="From where you are now: after each jump onto a stop the next stop goes to the clipboard (target it in the game's galaxy map, don't plot a route to it: the game can refuse to plot a full-range jump on a part tank; F6 copies it again), and the HUD's Next jump says where to scoop and supercharge. Off the route, it is plotted again from where you are. Ends at the last stop, with Stop, or with a boxel run."
                disabled={busy}
                onClick={() => void fly()}
              >
                {live?.active ? "Fly this route instead" : "Fly this route"}
              </button>
              {route.repairBefore != null ? (
                <p className="g3d-panel__note g3d-panel__note--warn">
                  The FSD is expected under 80 % after stop {route.repairBefore} (
                  {route.hops[route.repairBefore]?.name}): repair before going on (Carriers → Stations →
                  Repair finds the nearest)
                  {route.jumponium?.afmu
                    ? `, or with your AFMU in flight (refills you can make: ${route.jumponium.afmu.map((t) => `${t.count} ${t.name}`).join(", ")})`
                    : ""}
                  .
                </p>
              ) : null}
              {route.jumponium?.on && route.jumponium.plan ? (
                <p className="g3d-panel__note">
                  {route.jumponium.plan.saved ? (
                    <>
                      <FlaskConical className="g3d-neutron-ico" aria-hidden="true" /> FSD injections take{" "}
                      {route.jumponium.plan.saved} jump
                      {route.jumponium.plan.saved === 1 ? "" : "s"} off (hops marked with the flask):{" "}
                      {Object.entries(route.jumponium.plan.used)
                        .filter(([, n]) => n)
                        .map(([t, n]) => `${n} ${TIER_NAME[t]}`)
                        .join(", ")}
                      , needing{" "}
                      {Object.entries(route.jumponium.plan.needs)
                        .map(([k, n]) => {
                          const held = route.jumponium?.held?.[k];
                          return `${SYMBOL[k] ?? k} ${n}${held != null ? ` (${held} aboard)` : ""}`;
                        })
                        .join(", ")}
                      .{" "}
                      {route.jumponium.short
                        ? `${route.jumponium.short} more hop${route.jumponium.short === 1 ? "" : "s"} would get shorter with more materials. `
                        : ""}
                      Galaxy map → Jumponium for where to find more.
                    </>
                  ) : route.jumponium.short ? (
                    `The materials aboard make no injection this route can use; ${route.jumponium.short} hop${route.jumponium.short === 1 ? "" : "s"} would get shorter with more. Galaxy map → Jumponium for where to find them.`
                  ) : (
                    "No hop on this route gets shorter with an FSD injection."
                  )}
                </p>
              ) : null}
              {pastFull ? (
                <p className="g3d-panel__note">
                  {pastFull} supercharged hop{pastFull === 1 ? " goes" : "s go"} past {Math.round(fullReach)} ly (
                  {fmtLy(Number(range) || ship?.rangeLy || 0)} × {factor}, a full tank): the tank is part empty there, and
                  a lighter ship jumps further. Hover a hop's lightning for its range.
                </p>
              ) : null}
              {route.unsafeLegs.length ? (
                <p className="g3d-panel__note g3d-panel__note--warn">
                  No fuel-safe neutron way on leg {route.unsafeLegs.join(", ")}: the game's own plot is used
                  there.
                </p>
              ) : null}
              {valued.length ? (
                <p className="g3d-panel__note" title="From Spansh (others' scans, at 1×): every body scanned, the worthwhile planets mapped, the expected exobiology">
                  {hopsRead < valued.length ? `Reading the stops… ${hopsRead} of ${valued.length}. ` : ""}
                  {hopTotals.known
                    ? `${hopTotals.known} discovered: scan ${fmtCrShort(hopTotals.fss)} · map ${fmtCrShort(hopTotals.dss)} · bio ${fmtCrShort(hopTotals.bio)}${hopTotals.missing ? ` · ${hopTotals.missing} bodies missing` : ""}`
                    : hopsRead
                      ? "None of the stops is on Spansh yet."
                      : ""}
                </p>
              ) : null}
              <table className="fdb-table g3d-neutron-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>System</th>
                    <th>Jumps</th>
                    <th>Fuel</th>
                    <th>FSD</th>
                  </tr>
                </thead>
                <tbody>
                  {route.hops.map((h, i) => (
                    <tr key={`${h.name}-${i}`} className={h.kind === "waypoint" ? "is-waypoint" : undefined}>
                      <td>{i}</td>
                      <td>
                        <button type="button" className="g3d-linkbtn" onClick={() => onFocus(h)}>
                          {h.name}
                        </button>{" "}
                        <CopySystemButton system={h.name} />
                        {h.address != null && routeValueLine(hopValues.get(h.address)) ? (
                          <small className="g3d-neutron-worth">{routeValueLine(hopValues.get(h.address))}</small>
                        ) : null}
                        {h.refuel ? (
                          <span
                            className="g3d-neutron-fuel"
                            title={
                              h.refuelHalf
                                ? "Scoop the system's own star to half a tank before supercharging: the lighter ship reaches the next stops, a full tank would not"
                                : "Scoop the system's own star before supercharging"
                            }
                          >
                            {" "}
                            <Fuel className="g3d-neutron-ico" aria-hidden="true" /> {h.refuelHalf ? "scoop to half" : "scoop"}
                            {h.scoopLs != null ? ` (${h.scoopLs.toLocaleString("en-US")} ls)` : ""}
                          </span>
                        ) : null}
                        {h.scoopOnWay ? (
                          <span
                            className="g3d-neutron-fuel"
                            title="More normal jumps than the tank holds: scoop a K G B F O A M star on the way"
                          >
                            {" "}
                            <Fuel className="g3d-neutron-ico" aria-hidden="true" /> on the way
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {/* Past a supercharge's reach: the supercharged jump, then the game's own plot (a tester
                            read "905 ly" as one jump, 2026-10-28). */}
                        {h.boosted && h.jumps > 1 ? (
                          <span
                            title={`One supercharged jump, then ${h.jumps - 1} normal jump${h.jumps === 2 ? "" : "s"}: plot the system in the game's galaxy map after supercharging. ${reachNote(h)}`}
                          >
                            <Zap className="g3d-neutron-ico" aria-label="Supercharged" /> + {h.jumps - 1}
                          </span>
                        ) : h.boosted ? (
                          <span title={`One supercharged jump. ${reachNote(h)}`}>
                            <Zap className="g3d-neutron-ico" aria-label="Supercharged" />
                          </span>
                        ) : h.jumps ? (
                          String(h.jumps)
                        ) : (
                          ""
                        )}
                        {h.inject ? (
                          <span
                            className="g3d-neutron-inject"
                            title={`${h.inject.count} ${TIER_NAME[h.inject.tier]} FSD injection${h.inject.count > 1 ? "s" : ""}, one per normal jump: one jump fewer`}
                          >
                            {" "}
                            <FlaskConical className="g3d-neutron-ico" aria-hidden="true" /> {h.inject.count}{" "}
                            {TIER_NAME[h.inject.tier]}
                          </span>
                        ) : null}{" "}
                        <span className="dim">{h.distanceLy ? fmtLy(h.distanceLy) : ""}</span>
                      </td>
                      <td>{h.jumpsLeft}</td>
                      <td
                        className={
                          h.fsdHealth != null && h.fsdHealth < (ship?.fsdWarn ?? 0.8) ? "is-warn" : undefined
                        }
                      >
                        {pct(h.fsdHealth)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}
