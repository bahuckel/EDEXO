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
import { G3D_HELP, MenuHead, MenuRow } from "./galaxy3d/G3dMenu";
import { PickList, type PickOption } from "./galaxy3d/PickList";
import { CopySystemButton } from "./CopySystemButton";
import { isBool, usePersistedState } from "./usePersistedState";

type Pt = { x: number; y: number; z: number };
type Stop = Pt & { name: string };

interface Ship {
  rangeLy: number | null;
  jumpsPerTank: number | null;
  jumpsNow: number | null;
  fsdHealth: number | null;
  wearPerBoost: number;
  wearIsDefault: boolean;
  /** This ship's own supercharges, other ships with the same drive, or the default (shared/fsdWear.ts). */
  wearFrom: "ship" | "drive" | "default";
  /** A supercharge multiplies the range by this: 6 for the Caspian's Mk II SCO drive, else 4. */
  boostFactor: number;
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
  scoopOnWay: boolean;
  scoopLs: number | null;
  jumpsLeft: number;
  fsdHealth: number | null;
  /** "Use Jumponium": the FSD injections planned for this hop's normal jumps (one jump fewer), else null. */
  inject?: { tier: "basic" | "standard" | "premium"; count: number } | null;
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
    /** Jumps they take off (on), or would (off). */
    possible: number;
    plan: { saved: number; used: Record<string, number>; needs: Record<string, number> } | null;
    held: Record<string, number> | null;
    makes: { tier: string; name: string; count: number }[] | null;
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
  hops: (Stop & { kind: NeutronHopDTO["kind"] })[] | null;
  /** Bumped with every new route, a re-plot from where the ship went included. */
  version: number;
}

const pct = (v: number | null) => (v == null ? "?" : `${Math.round(v * 100)} %`);

export function NeutronDrawer({
  onRoute,
  onFocus,
}: {
  onRoute: (pts: Pt[]) => void;
  onFocus: (p: Pt) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Stop[]>([]);
  const [range, setRange] = useState("");
  const [tank, setTank] = useState("");
  const [optimise, setOptimise] = useState(false);
  const [useJump, setUseJump] = usePersistedState("galaxy.neutron.jumponium", false, isBool);
  const [route, setRoute] = useState<RouteDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveDTO | null>(null);

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
  const liveVersion = useRef(-1);
  const readLive = useCallback(() => {
    void fetch("/api/neutron/live")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: LiveDTO | null) => {
        if (!j) return;
        setLive(j);
        if (j.version === liveVersion.current) return;
        const first = liveVersion.current < 0;
        liveVersion.current = j.version;
        if (j.active && j.hops) {
          onRoute(j.hops.map((h) => ({ x: h.x, y: h.y, z: h.z })));
          // A re-plot replaced the plan in the table: the map shows the one being flown.
          if (!first) setRoute(null);
        } else {
          // Ended (arrived, stopped, a boxel run) — also while the drawer was closed: no line stays (review 1.2.16).
          if (!first) setRoute(null);
          onRoute([]);
        }
      })
      .catch(() => undefined);
  }, [onRoute]);
  useEffect(readLive, [readLive]);
  useEffect(() => {
    if (!live?.active) return;
    const t = window.setInterval(readLive, 4000);
    return () => clearInterval(t);
  }, [live?.active, readLive]);
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
      liveVersion.current = j.version;
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
      onRoute([]);
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
  useEffect(() => {
    if (!ship) return;
    if (!range && ship.rangeLy) setRange(ship.rangeLy.toFixed(1));
    if (!tank && ship.jumpsPerTank) setTank(String(ship.jumpsPerTank));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ship]);
  useEffect(() => {
    const t = window.setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  const from: Stop | null = ship?.position ? { name: ship.system ?? "Your ship", ...ship.position } : null;
  // Without a position from the journals (no jump yet), the first stop is where the route starts.
  const waypoints = from ? [from, ...stops] : stops;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setFound([]);
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      void fetch(`/api/galaxy/find?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: GalaxyFindDTO | null) => {
          if (!ac.signal.aborted)
            setFound((j?.systems ?? []).slice(0, 30).map((s) => ({ name: s.name, x: s.x, y: s.y, z: s.z })));
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [query]);
  const options: PickOption[] = useMemo(() => found.map((s) => ({ value: s.name, label: s.name })), [found]);

  const move = (i: number, d: number) =>
    setStops((prev) => {
      const j = i + d;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const plan = async (): Promise<RouteDTO | null> => {
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
          optimise,
          useJumponium: useJump,
        }),
      });
      const j = (await r.json()) as RouteDTO & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Plan failed (${r.status})`);
      setRoute(j);
      if (optimise) setStops(from ? j.waypoints.slice(1) : j.waypoints);
      onRoute(j.hops.map((h) => ({ x: h.x, y: h.y, z: h.z })));
      return j;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  // Use Jumponium flipped with a route on screen: plan it again with (or without) the injections.
  const jumpSeen = useRef(useJump);
  useEffect(() => {
    if (jumpSeen.current === useJump) return;
    jumpSeen.current = useJump;
    if (route && waypoints.length >= 2) void plan();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the toggle replans
  }, [useJump]);
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
        useJumponium: r.jumponium?.on === true,
      },
    });
  };

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
                    , next <strong>{live.view.next}</strong> (on the clipboard; F6 copies it again)
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
              hint="A system from the galaxy map's search: it goes at the end of the stops"
              value=""
              valueLabel="Add a system"
              options={options}
              onQuery={setQuery}
              onChange={(name) => {
                const s = found.find((x) => x.name === name);
                if (s) setStops((p) => [...p, s]);
              }}
              placeholder="Search a system"
            />
          </div>
          <div className="g3d-menu__section">
            <MenuRow
              label="Jump range"
              hint={`Laden, unboosted, as your jumps show it (change it for another ship); a supercharge reaches ${ship?.boostFactor === 6 ? "six times this (the Caspian's Mk II SCO drive)" : "four times this"}`}
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
                · supercharge ×{ship.boostFactor}
              </p>
            ) : null}
            <label className="g3d-row g3d-row--check">
              <input
                type="checkbox"
                className="g3d-row__box"
                checked={optimise}
                onChange={(e) => setOptimise(e.target.checked)}
              />
              <span className="g3d-row__label">Optimise the order (first and last stay)</span>
            </label>
            <label
              className="g3d-row g3d-row--check"
              title="Plan with FSD injections: on every hop where one takes a jump off its normal jumps (it never adds to a supercharged jump), the cheapest by material, one per jump. The HUD says which to synthesise on the way."
            >
              <input
                type="checkbox"
                className="g3d-row__box"
                checked={useJump}
                onChange={(e) => setUseJump(e.target.checked)}
              />
              <span className="g3d-row__label">
                Use Jumponium
                {route?.jumponium && !route.jumponium.on && route.jumponium.possible
                  ? ` (−${route.jumponium.possible} jump${route.jumponium.possible === 1 ? "" : "s"} on this route)`
                  : ""}
              </span>
            </label>
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
                title="From where you are now: after each jump onto a stop the next stop goes to the clipboard (paste it in the galaxy map; F6 copies it again), and the HUD's Next jump says where to scoop and supercharge. Off the route, it is plotted again from where you are. Ends at the last stop, with Stop, or with a boxel run."
                disabled={busy}
                onClick={() => void fly()}
              >
                {live?.active ? "Fly this route instead" : "Fly this route"}
              </button>
              {route.repairBefore != null ? (
                <p className="g3d-panel__note g3d-panel__note--warn">
                  The FSD is expected under 80 % after stop {route.repairBefore} (
                  {route.hops[route.repairBefore]?.name}): repair before going on (Carriers → Stations →
                  Repair finds the nearest).
                </p>
              ) : null}
              {route.jumponium?.on && route.jumponium.plan ? (
                <p className="g3d-panel__note">
                  {route.jumponium.plan.saved ? (
                    <>
                      ⚗ FSD injections take {route.jumponium.plan.saved} jump
                      {route.jumponium.plan.saved === 1 ? "" : "s"} off (hops marked ⚗):{" "}
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
                      . Galaxy map → Jumponium for where to find more.
                    </>
                  ) : (
                    "⚗ No hop on this route gets shorter with an FSD injection."
                  )}
                </p>
              ) : null}
              {route.unsafeLegs.length ? (
                <p className="g3d-panel__note g3d-panel__note--warn">
                  No fuel-safe neutron way on leg {route.unsafeLegs.join(", ")}: the game's own plot is used
                  there.
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
                        {h.refuel ? (
                          <span
                            className="g3d-neutron-fuel"
                            title="Scoop the system's own star before supercharging"
                          >
                            {" "}
                            ⛽ scoop{h.scoopLs != null ? ` (${h.scoopLs.toLocaleString("en-US")} ls)` : ""}
                          </span>
                        ) : null}
                        {h.scoopOnWay ? (
                          <span
                            className="g3d-neutron-fuel"
                            title="More normal jumps than the tank holds: scoop a K G B F O A M star on the way"
                          >
                            {" "}
                            ⛽ on the way
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {h.jumps ? `${h.jumps}${h.boosted ? " ⚡" : ""}` : ""}
                        {h.inject ? (
                          <span
                            className="g3d-neutron-inject"
                            title={`${h.inject.count} ${TIER_NAME[h.inject.tier]} FSD injection${h.inject.count > 1 ? "s" : ""}, one per normal jump: one jump fewer`}
                          >
                            {" "}
                            ⚗ {h.inject.count} {TIER_NAME[h.inject.tier]}
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
