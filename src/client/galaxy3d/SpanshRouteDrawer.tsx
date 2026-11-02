/**
 * The galaxy map's Spansh drawer (plan 1.3.6 S-1, owner 2026-11-02: "Import spansh routes - yes, we can also compare
 * EDEXO to Spansh with this to optimize route"). Paste a Spansh results link: the route is read once from Spansh
 * (server/spanshRoute.ts), drawn on the map, and compared with EDEXO's own figures:
 *
 * - exobiology and road-to-riches routes: each stop's value from Spansh beside EDEXO's (the route values the NavRoute
 *   finder and the neutron drawer show, `/api/route/system-values`), the stops EDEXO values under a floor can be
 *   dropped before flying;
 * - neutron and galaxy plotter routes: EDEXO's neutron planner on the same two ends with the same range, the jumps
 *   side by side.
 *
 * "Fly this route" flies the stops kept the way the neutron route is flown (neutronLive.ts): the next stop on the
 * clipboard after each jump onto one, the HUD's Next jump line. Stop ends it here or in the Neutron drawer.
 */
import { useEffect, useMemo, useState } from "react";
import type { SpanshRouteAnswer, SpanshRouteDTO, SpanshRouteStopDTO } from "@shared/dto/spanshRoute";
import type { RouteSystemValuesDTO } from "@shared/dto/routeSystem";
import { fmtCrShort } from "@shared/format";
import { CopySystemButton } from "../CopySystemButton";
import { useRouteValues } from "../routeValues";
import { G3D_HELP, MenuHead, MenuRow } from "./G3dMenu";
import { keepNeutronMarks, type NeutronMark } from "./neutronMarks";

const KIND_NAME: Record<SpanshRouteDTO["kind"], string> = {
  exobiology: "Exobiology",
  riches: "Road to riches",
  neutron: "Neutron plotter",
  plotter: "Galaxy plotter",
  carrier: "Fleet carrier",
};

/** Kept across openings of the drawer (it unmounts when another opens). */
const kept: { text: string; route: SpanshRouteDTO | null; dropped: number[]; floor: string } = { text: "", route: null, dropped: [], floor: "" };

/** EDEXO's value of a stop for this kind of route: the biology for exobiology, the scan and map for riches. */
function edexoValue(kind: SpanshRouteDTO["kind"], v: RouteSystemValuesDTO | undefined): number | null {
  if (!v) return null;
  if (v.state === "none") return 0;
  if (v.state !== "ok") return null;
  return kind === "exobiology" ? v.bioCr : v.totalCr;
}

const marksOf = (stops: SpanshRouteStopDTO[]): NeutronMark[] =>
  stops.map((s, i) => ({
    name: s.name,
    x: s.x,
    y: s.y,
    z: s.z,
    kind: i === 0 ? "start" : s.neutron ? "neutron" : "waypoint",
    jumps: s.jumps,
    boosted: i > 0 && stops[i - 1]!.neutron ? 1 : 0,
    refuel: s.refuel,
  }));

interface Compare {
  jumps: number;
  refuels: number;
  error?: string;
}

export function SpanshRouteDrawer({
  onRoute,
  onFocus,
}: {
  onRoute: (marks: NeutronMark[]) => void;
  onFocus: (p: { x: number; y: number; z: number }) => void;
}) {
  const [text, setText] = useState(kept.text);
  const [route, setRoute] = useState<SpanshRouteDTO | null>(kept.route);
  const [dropped, setDropped] = useState<Set<number>>(() => new Set(kept.dropped));
  const [floor, setFloor] = useState(kept.floor);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<Compare | null>(null);

  useEffect(() => {
    kept.text = text;
    kept.route = route;
    kept.dropped = [...dropped];
    kept.floor = floor;
  }, [text, route, dropped, floor]);

  const read = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    setCompare(null);
    try {
      const r = await fetch(`/api/spansh-route?q=${encodeURIComponent(text.trim())}`);
      const a = (await r.json()) as SpanshRouteAnswer;
      if (a.state === "ok") {
        setRoute(a.route);
        setDropped(new Set());
        const marks = marksOf(a.route.stops);
        keepNeutronMarks(marks);
        onRoute(marks);
        onFocus(a.route.stops[0]!);
      } else if (a.state === "pending") setNote("Spansh is still planning this route: read it again in a moment.");
      else setError(a.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const valued = route?.kind === "exobiology" || route?.kind === "riches";
  const systems = useMemo(
    () =>
      valued && route
        ? route.stops.filter((s) => s.id64 && Number.isSafeInteger(Number(s.id64))).map((s) => ({ addr: Number(s.id64), name: s.name }))
        : [],
    [route, valued],
  );
  const { values, read: valuesRead } = useRouteValues(systems, valued);
  const edexoOf = (s: SpanshRouteStopDTO) => (route && s.id64 ? edexoValue(route.kind, values.get(Number(s.id64))) : null);

  const keptStops = route ? route.stops.filter((_, i) => i === 0 || !dropped.has(i)) : [];
  const totals = useMemo(() => {
    let spansh = 0;
    let edexo = 0;
    let jumps = 0;
    if (!route) return { spansh, edexo, jumps };
    route.stops.forEach((s, i) => {
      jumps += s.jumps;
      if (i > 0 && dropped.has(i)) return;
      spansh += s.valueCr;
      edexo += edexoOf(s) ?? 0;
    });
    return { spansh, edexo, jumps };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, dropped, values]);

  const dropUnder = () => {
    const min = Number(floor.replace(/[^\d.]/g, "")) * (/m/i.test(floor) ? 1e6 : /k/i.test(floor) ? 1e3 : 1);
    if (!route || !(min > 0)) return;
    const next = new Set<number>();
    route.stops.forEach((s, i) => {
      const v = edexoOf(s);
      if (i > 0 && v != null && v < min) next.add(i);
    });
    setDropped(next);
  };

  const compareWithEdexo = async () => {
    if (!route) return;
    setBusy(true);
    setCompare(null);
    try {
      const a = route.stops[0]!;
      const b = route.stops[route.stops.length - 1]!;
      const r = await fetch("/api/neutron/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waypoints: [
            { name: a.name, x: a.x, y: a.y, z: a.z },
            { name: b.name, x: b.x, y: b.y, z: b.z },
          ],
          rangeLy: route.rangeLy ?? undefined,
        }),
      });
      const j = (await r.json()) as { jumps?: number; refuels?: number; error?: string };
      setCompare(r.ok ? { jumps: j.jumps ?? 0, refuels: j.refuels ?? 0 } : { jumps: 0, refuels: 0, error: j.error ?? `Plan failed (${r.status})` });
    } catch (e) {
      setCompare({ jumps: 0, refuels: 0, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const fly = async () => {
    if (!route) return;
    setBusy(true);
    setError(null);
    try {
      const keep = route.stops.map((_, i) => i).filter((i) => i > 0 && !dropped.has(i));
      const r = await fetch("/api/spansh-route/fly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: route.job, keep }),
      });
      const j = (await r.json()) as { next?: string | null; stops?: number; error?: string };
      if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
      const marks = marksOf(keptStops);
      keepNeutronMarks(marks);
      onRoute(marks);
      setNote(`Flying ${j.stops} stop${j.stops === 1 ? "" : "s"}${j.next ? `: ${j.next} is on the clipboard` : ""}. F6 copies the next stop again.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stopFlying = async () => {
    await fetch("/api/neutron/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stop: true }) }).catch(() => null);
    setNote("Stopped.");
  };

  const toggle = (i: number) =>
    setDropped((cur) => {
      const n = new Set(cur);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <aside className="g3d-drawer g3d-menu g3d-plan" aria-label="Spansh route" data-testid="g3d-spansh">
      <MenuHead title="Spansh route" help={G3D_HELP.spansh} />
      <div className="g3d-menu__section g3d-menu__section--first">
        <MenuRow label="Spansh link" hint="The address of a Spansh results page (exobiology, road to riches, neutron, galaxy plotter or fleet carrier), or its job id">
          <input
            className="g3d-input g3d-row__val"
            value={text}
            placeholder="https://spansh.co.uk/…/results/…"
            aria-label="Spansh link"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) void read();
            }}
          />
        </MenuRow>
        <button type="button" className="btn-top-toggle" disabled={busy || !text.trim()} onClick={() => void read()}>
          Read from Spansh
        </button>
        {error ? <p className="g3d-panel__note g3d-panel__note--warn">{error}</p> : null}
        {note ? <p className="g3d-panel__note">{note}</p> : null}
      </div>

      {route ? (
        <div className="g3d-menu__section">
          <p className="g3d-panel__note">
            <b>{KIND_NAME[route.kind]}</b>
            {route.from ? ` from ${route.from}` : ""}
            {route.to ? ` to ${route.to}` : ""}: {route.stops.length - 1} stop{route.stops.length === 2 ? "" : "s"},{" "}
            {route.totalJumps.toLocaleString("en-US")} jump{route.totalJumps === 1 ? "" : "s"}
            {route.rangeLy ? ` at ${route.rangeLy} ly` : ""}.{" "}
            <a href={route.url} target="_blank" rel="noopener noreferrer">
              Open on Spansh
            </a>
          </p>

          {valued ? (
            <>
              <p className="g3d-panel__note" data-testid="spansh-compare">
                Kept stops: Spansh {fmtCrShort(totals.spansh)} CR · EDEXO {fmtCrShort(totals.edexo)} CR
                {valuesRead < systems.length ? ` (EDEXO has read ${valuesRead} of ${systems.length} systems)` : ""}.{" "}
                {route.kind === "exobiology"
                  ? "Spansh adds up the species recorded on each body at full price; EDEXO's is its expected value: each species' chance there times its price."
                  : "Spansh's mapping and scan estimates beside EDEXO's FSS of the whole system plus its worthwhile planets mapped."}
              </p>
              <MenuRow label="Drop stops EDEXO values under" hint="Unticks every stop EDEXO values under this (5m, 500k, or credits); tick them again by hand">
                <input
                  className="g3d-input g3d-row__val"
                  inputMode="decimal"
                  value={floor}
                  placeholder="e.g. 5m"
                  aria-label="Drop stops EDEXO values under"
                  onChange={(e) => setFloor(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") dropUnder();
                  }}
                />
              </MenuRow>
              <button type="button" className="btn-top-toggle" disabled={!floor.trim()} onClick={dropUnder}>
                Drop them
              </button>
            </>
          ) : route.kind !== "carrier" ? (
            <>
              <button type="button" className="btn-top-toggle" disabled={busy} onClick={() => void compareWithEdexo()}>
                Plan it with EDEXO too
              </button>
              {compare ? (
                <p className={`g3d-panel__note${compare.error ? " g3d-panel__note--warn" : ""}`} data-testid="spansh-compare">
                  {compare.error
                    ? `EDEXO could not plan it: ${compare.error}`
                    : `Spansh ${route.totalJumps} jumps · EDEXO ${compare.jumps} jumps${compare.refuels ? ` (${compare.refuels} refuel stop${compare.refuels === 1 ? "" : "s"})` : ""}, with your ship${route.rangeLy ? ` at ${route.rangeLy} ly` : ""}. The Neutron tab plans EDEXO's in full.`}
                </p>
              ) : null}
            </>
          ) : (
            <p className="g3d-panel__note">A fleet carrier route is shown, not flown: plot each jump in the carrier's own map.</p>
          )}

          {route.kind !== "carrier" ? (
            <button type="button" className="btn-top-toggle" disabled={busy || keptStops.length < 2} onClick={() => void fly()}>
              Fly this route{dropped.size ? ` (${keptStops.length - 1} stops)` : ""}
            </button>
          ) : null}
          <button type="button" className="btn-top-toggle" onClick={() => void stopFlying()} title="Ends the route being flown (this one or the Neutron tab's)">
            Stop
          </button>

          <table className="fdb-table g3d-neutron-table">
            <thead>
              <tr>
                <th>{route.kind !== "carrier" ? "Fly" : "#"}</th>
                <th>System</th>
                <th>Jumps</th>
                {valued ? (
                  <>
                    <th title="Spansh's value of the stop">Spansh</th>
                    <th title="EDEXO's value of the stop">EDEXO</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {route.stops.map((s, i) => {
                const ev = edexoOf(s);
                const off = i > 0 && dropped.has(i);
                const lower = valued && ev != null && s.valueCr > 0 && ev < s.valueCr * 0.5;
                return (
                  <tr key={`${s.name}-${i}`} className={off ? "is-dropped" : undefined}>
                    <td>
                      {route.kind !== "carrier" && i > 0 ? (
                        <input type="checkbox" checked={!off} aria-label={`Fly to ${s.name}`} onChange={() => toggle(i)} />
                      ) : (
                        i
                      )}
                    </td>
                    <td>
                      <button type="button" className="g3d-linkbtn" onClick={() => onFocus(s)}>
                        {s.name}
                      </button>{" "}
                      <CopySystemButton system={s.name} />
                      {s.neutron ? <small className="g3d-neutron-worth"> neutron star</small> : null}
                      {s.refuel ? <small className="g3d-neutron-worth"> {route.kind === "carrier" ? "restock tritium" : "refuel"}</small> : null}
                      {valued && s.bodies.length ? (
                        <small className="g3d-neutron-worth">
                          {s.bodies
                            .slice(0, 3)
                            .map((b) => `${b.name.startsWith(s.name) ? b.name.slice(s.name.length).trim() : b.name}${b.species.length ? `: ${b.species.map((x) => x.name).join(", ")}` : ""}`)
                            .join(" · ")}
                        </small>
                      ) : null}
                    </td>
                    <td>{s.jumps || ""}</td>
                    {valued ? (
                      <>
                        <td>{s.valueCr ? fmtCrShort(s.valueCr) : "—"}</td>
                        <td title={lower ? "EDEXO expects under half of Spansh's value here" : undefined}>
                          {ev == null ? "…" : `${fmtCrShort(ev)}${lower ? " ▼" : ""}`}
                        </td>
                      </>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </aside>
  );
}
