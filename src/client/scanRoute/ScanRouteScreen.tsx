/**
 * The scan route tab (plan 1.3.3 R-4, owner 2026-10-30): one system of the plotted route at a time, seen from above
 * with its bodies where their orbits put them, every body valued, and the shortest way from the arrival star through
 * the planets worth mapping (mapped value at least the commander's minimum) and the bodies with biology left. The
 * current system first, < and > through the route ahead (NavRoute). The current system follows the journals: a body
 * FSSed joins at once; the bodies the honk counted and nobody scanned stand on an outer ring as "?".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ScanRouteDTO } from "@shared/dto/routeSystem.js";
import type { GalaxyRouteDTO } from "@shared/dto/galaxy.js";
import { fmtCrExact, fmtCrShort } from "@shared/format";
import { createScanRouteScene, type ScanRouteScene } from "./scanRouteScene";
import "../styles/scan-route.css";

const MIN_KEY = "edexo.scanRoute.minDssCr";
const DEFAULT_MIN = 500_000;
/** How often the route and the current system's scans are looked at (ms). */
const POLL_MS = 4000;

function readMin(): number {
  try {
    const v = Number(localStorage.getItem(MIN_KEY));
    return Number.isFinite(v) && v >= 0 && localStorage.getItem(MIN_KEY) != null ? v : DEFAULT_MIN;
  } catch {
    return DEFAULT_MIN;
  }
}

const fmtLs = (ls: number) => (ls >= 10_000 ? `${Math.round(ls).toLocaleString()} ls` : `${ls.toFixed(ls < 10 ? 1 : 0)} ls`);

type Stop = { addr: number | null; name: string };

export function ScanRouteScreen({ onClose }: { onClose?: () => void }) {
  const [min, setMin] = useState(readMin);
  // What the box says, and the minimum asked for 400 ms after the last key (each one re-plans the route).
  const [minText, setMinText] = useState(String(readMin()));
  const [route, setRoute] = useState<GalaxyRouteDTO | null>(null);
  // The system shown, by address (null: the current system): a jump moves the route on, not the view.
  const [sel, setSel] = useState<number | null>(null);
  const [view, setView] = useState<ScanRouteDTO | "loading" | "error">("loading");
  const [picked, setPicked] = useState<number | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const shownKey = useRef("");
  const scene = useRef<ScanRouteScene | null>(null);

  // The route and the commander's scans: looked at every few seconds while the tab is open.
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/galaxy/route")
        .then((r) => (r.ok ? (r.json() as Promise<GalaxyRouteDTO>) : null))
        .then((d) => live && d && setRoute(d))
        .catch(() => undefined);
    void load();
    // Not while the tab sits behind another (its view has no size then) or the window is hidden.
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && host.current?.offsetParent) void load();
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  // The current system, then the route's systems after it.
  const stops = useMemo<Stop[]>(() => {
    const here: Stop = { addr: null, name: route?.system ?? "Current system" };
    const nav = route?.navRoute ?? [];
    const i = nav.findIndex((s) => s.name === route?.system);
    const ahead = (i >= 0 ? nav.slice(i + 1) : nav.filter((s) => !s.visited)).map((s) => ({ addr: s.address, name: s.name }));
    return [here, ...ahead];
  }, [route?.system, route?.navRoute]);
  const found = sel == null ? 0 : stops.findIndex((s) => s.addr === sel);
  // A system no longer ahead (flown to, or another route plotted): back to the current one.
  const at = found < 0 ? 0 : found;
  const stop = stops[at]!;
  const go = (i: number) => setSel(stops[Math.max(0, Math.min(stops.length - 1, i))]!.addr);
  // The current system's view is read again when the commander's systems move (a jump, a scan).
  const rev = stop.addr == null ? `${route?.system ?? ""}|${route?.mineRev ?? ""}` : "";

  useEffect(() => {
    let live = true;
    // Another system: its own view, not the last one's, while it loads (a route system waits for Spansh).
    const key = `${stop.addr ?? "here"}|${stop.name}`;
    if (key !== shownKey.current) {
      shownKey.current = key;
      setView("loading");
    }
    const q = new URLSearchParams({ min: String(min) });
    if (stop.addr != null) {
      q.set("addr", String(stop.addr));
      q.set("name", stop.name);
    }
    fetch(`/api/scan-route?${q}`)
      .then((r) => (r.ok ? (r.json() as Promise<ScanRouteDTO>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setView(d))
      .catch(() => live && setView("error"));
    return () => {
      live = false;
    };
  }, [stop.addr, stop.name, min, rev]);

  useEffect(() => {
    if (!host.current) return;
    const s = createScanRouteScene(host.current, setPicked);
    scene.current = s;
    return () => {
      s.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    if (typeof view === "object") scene.current?.show(view);
    else scene.current?.clear();
  }, [view]);

  useEffect(() => {
    const t = setTimeout(() => {
      const v = Math.max(0, Number(minText) || 0);
      setMin(v);
      try {
        localStorage.setItem(MIN_KEY, String(v));
      } catch {
        /* kept for this session only */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [minText]);

  const d = typeof view === "object" ? view : null;
  const byId = new Map(d?.bodies.map((b) => [b.id, b]) ?? []);
  const start = d?.startId != null ? byId.get(d.startId) : undefined;
  let prev = start?.pos ?? null;
  const legs = (d?.route.order ?? []).map((id) => {
    const b = byId.get(id)!;
    const leg = prev ? Math.hypot(b.pos.x - prev.x, b.pos.y - prev.y, b.pos.z - prev.z) : 0;
    prev = b.pos;
    return { b, leg };
  });

  return (
    <div className="scan-route">
      <header className="scan-route__bar">
        <button type="button" onClick={() => go(at - 1)} disabled={at <= 0} aria-label="Previous system">
          ◀
        </button>
        <div className="scan-route__name">
          <strong>{stop.addr == null ? d?.name || stop.name : stop.name}</strong>
          <span>{at === 0 ? "Current system" : `Route ${at} of ${stops.length - 1}`}</span>
        </div>
        <button type="button" onClick={() => go(at + 1)} disabled={at >= stops.length - 1} aria-label="Next system">
          ▶
        </button>
        <label className="scan-route__min" title="A planet joins the route when its mapped (DSS) value is at least this">
          Map planets worth at least
          <input
            type="number"
            min={0}
            step={50_000}
            value={minText}
            onChange={(e) => setMinText(e.target.value)}
          />
          cr
        </label>
        <button type="button" onClick={() => scene.current?.fit()}>
          Fit
        </button>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close the scan route">
            ×
          </button>
        ) : null}
      </header>
      <div className="scan-route__body">
        <div className="scan-route__view" ref={host} />
        <aside className="scan-route__side">
          {view === "loading" ? <p className="scan-route__note">Loading…</p> : null}
          {view === "error" ? <p className="scan-route__note">Could not load this system.</p> : null}
          {d && d.state !== "ok" ? <p className="scan-route__note">{d.state === "none" ? "Spansh has no bodies for it: nobody has reported them." : `Spansh: ${d.error}`}</p> : null}
          {d && d.state === "ok" ? (
            <>
              <p className="scan-route__src">
                {d.source === "journal" ? "Your scans" : "From Spansh (others' scans, base rate)"} · {d.bodyCount.known} bodies
                {d.bodyCount.total != null ? ` of ${d.bodyCount.total}` : ""}
              </p>
              {d.bodyCount.missing > 0 ? (
                <p className="scan-route__missing">
                  {d.bodyCount.missing} {d.bodyCount.missing === 1 ? "body is" : "bodies are"} missing: the honk counted them, nobody has scanned them.
                </p>
              ) : null}
              <table className="scan-route__sum">
                <tbody>
                  <tr>
                    <td>Route</td>
                    <td>{legs.length ? `${legs.length} stops · ${fmtLs(d.route.totalLs)}` : "nothing to fly to"}</td>
                  </tr>
                  <tr>
                    <td>Mapping</td>
                    <td>{fmtCrExact(d.routeDssCr)}</td>
                  </tr>
                  <tr>
                    <td>Exobiology, expected</td>
                    <td>{fmtCrExact(d.routeBioCr)}</td>
                  </tr>
                </tbody>
              </table>
              {start ? <p className="scan-route__start">◎ Arrival star{start.short !== d.name ? ` · ${start.short}` : ""}</p> : null}
              <ol className="scan-route__list">
                {legs.map(({ b, leg }) => (
                  <li key={b.id} className={`scan-route__stop scan-route__stop--${b.target}${picked === b.id ? " is-picked" : ""}`} onClick={() => setPicked(b.id)}>
                    <div className="scan-route__head">
                      <strong>{b.short}</strong>
                      <span>{fmtLs(leg)}</span>
                    </div>
                    <div className="scan-route__why">
                      {b.target !== "bio" && b.dssCr != null ? <span>{b.tag ?? b.cls} · map {fmtCrShort(b.dssCr)}</span> : null}
                      {b.target !== "dss" && b.bioSignals ? (
                        <span>
                          {b.bioSignals} bio{b.bioCr != null ? ` · ${fmtCrShort(b.bioCr)}` : ""}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
              {picked != null && byId.get(picked) && !byId.get(picked)!.target ? (
                <p className="scan-route__note">
                  {byId.get(picked)!.short}: {byId.get(picked)!.cls} · scan {fmtCrShort(byId.get(picked)!.fssCr)}
                  {byId.get(picked)!.dssCr != null ? ` · map ${fmtCrShort(byId.get(picked)!.dssCr)}` : ""}
                  {byId.get(picked)!.mapped ? " · mapped" : ""}
                </p>
              ) : null}
              <p className="scan-route__legend">
                <i className="k-dss" /> worth mapping <i className="k-bio" /> biology <i className="k-both" /> both · ? not scanned yet
              </p>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
