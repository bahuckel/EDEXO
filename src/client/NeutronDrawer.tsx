/**
 * Galaxy map → Neutron route (plan 8, owner 2026-10-13): a route through two or more systems by supercharged jumps
 * from neutron star to neutron star, with refuel stops at neutron stars that have a scoopable star of their own and
 * a warning where the FSD's health is expected under 80 %. The ship's range, tank and fuel come from the journals and
 * can be changed; the neutron stars are an optional download beside the galaxy index.
 */
import { useEffect, useMemo, useState } from "react";
import { fmtLy } from "@shared/format";
import type { GalaxyFindDTO } from "@shared/dto/galaxy";
import { G3D_HELP, MenuHead, MenuRow } from "./galaxy3d/G3dMenu";
import { PickList, type PickOption } from "./galaxy3d/PickList";
import { CopySystemButton } from "./CopySystemButton";

type Pt = { x: number; y: number; z: number };
type Stop = Pt & { name: string };

interface Ship {
  rangeLy: number | null;
  jumpsPerTank: number | null;
  jumpsNow: number | null;
  fsdHealth: number | null;
  wearPerBoost: number;
  wearIsDefault: boolean;
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
}

/** The route being flown (`/api/neutron/live`, plan 8.5). */
interface LiveDTO {
  active: boolean;
  view: { at: number; total: number; next: string | null; destination: string; done: boolean } | null;
  hops: (Stop & { kind: NeutronHopDTO["kind"] })[] | null;
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
  // A route being flown: shown, and drawn on the map until another is planned.
  useEffect(() => {
    void fetch("/api/neutron/live")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: LiveDTO | null) => {
        setLive(j);
        if (j?.hops) onRoute(j.hops.map((h) => ({ x: h.x, y: h.y, z: h.z })));
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
      setLive(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    if (!status?.downloading) return;
    const t = setTimeout(load, 1000);
    return () => clearTimeout(t);
  }, [status]);

  // The journal's ship as the first stop and the defaults, once known.
  const ship = status?.ship ?? null;
  useEffect(() => {
    if (!ship) return;
    if (!stops.length && ship.position) setStops([{ name: ship.system ?? "Your ship", ...ship.position }]);
    if (!range && ship.rangeLy) setRange(ship.rangeLy.toFixed(1));
    if (!tank && ship.jumpsPerTank) setTank(String(ship.jumpsPerTank));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ship]);

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

  const plan = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/neutron/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waypoints: stops,
          rangeLy: Number(range) || undefined,
          jumpsPerTank: Number(tank) || undefined,
          optimise,
        }),
      });
      const j = (await r.json()) as RouteDTO & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Plan failed (${r.status})`);
      setRoute(j);
      if (optimise) setStops(j.waypoints);
      onRoute(j.hops.map((h) => ({ x: h.x, y: h.y, z: h.z })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
              <button type="button" className="g3d-linkbtn" onClick={() => void setFlying({ stop: true })}>
                Stop flying it
              </button>
            </div>
          ) : null}
          <div className={`g3d-menu__section${live?.active ? "" : " g3d-menu__section--first"}`}>
            <p className="g3d-menu__sub">Stops, in order</p>
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
            {ship?.position ? (
              <button
                type="button"
                className="g3d-linkbtn"
                onClick={() =>
                  setStops((p) => [
                    { name: ship.system ?? "Your ship", ...ship.position! },
                    ...p.slice(p[0]?.name === (ship.system ?? "Your ship") ? 1 : 0),
                  ])
                }
              >
                Start from my ship
              </button>
            ) : null}
          </div>
          <div className="g3d-menu__section">
            <MenuRow
              label="Jump range"
              hint="Laden, unboosted, as your jumps show it (change it for another ship); a supercharge reaches four times this"
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
              <span className="g3d-row__val">
                {pct(ship?.fsdHealth ?? null)}
                {ship
                  ? ` · ${(ship.wearPerBoost * 100).toFixed(2)} % a supercharge${ship.wearIsDefault ? " (estimate)" : ""}`
                  : ""}
              </span>
            </MenuRow>
            <label className="g3d-row g3d-row--check">
              <input
                type="checkbox"
                className="g3d-row__box"
                checked={optimise}
                onChange={(e) => setOptimise(e.target.checked)}
              />
              <span className="g3d-row__label">Optimise the order (first and last stay)</span>
            </label>
            <button
              type="button"
              className="btn-top-toggle"
              onClick={() => void plan()}
              disabled={busy || stops.length < 2}
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
                title="After each jump onto a stop, the next stop goes to the clipboard (paste it in the galaxy map; F6 copies it again), and the HUD's Next jump says where to scoop and supercharge. Ends at the last stop, or with a boxel run."
                onClick={() => void setFlying({ hops: route.hops })}
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
                        {h.jumps ? `${h.jumps}${h.boosted ? " ⚡" : ""}` : ""}{" "}
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
