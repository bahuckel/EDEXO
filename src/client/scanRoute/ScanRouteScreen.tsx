/**
 * The scan route tab (plan 1.3.3 R-4, owner 2026-10-30): one system of the plotted route at a time, seen from above
 * with its bodies where their orbits put them, every body valued, and the shortest way from the arrival star through
 * the planets worth mapping (mapped value at least the commander's minimum) and the bodies with biology left. The
 * current system first, < and > through the route ahead (NavRoute). The current system follows the journals: a body
 * FSSed joins at once; the bodies the honk counted and nobody scanned stand on an outer ring as "?".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ScanRouteDTO } from "@shared/dto/routeSystem.js";
import type { GalaxyFindDTO, GalaxyRouteDTO } from "@shared/dto/galaxy.js";
import { useRouteValues } from "../routeValues";
import { fmtCrExact, fmtCrShort } from "@shared/format";
import { createScanRouteScene, type ScanRouteScene, type ScanScale } from "./scanRouteScene";
import "../styles/scan-route.css";

const MIN_KEY = "edexo.scanRoute.minDssCr";
const SCALE_KEY = "edexo.scanRoute.scale";

function readScale(): ScanScale {
  try {
    return localStorage.getItem(SCALE_KEY) === "compact" ? "compact" : "true";
  } catch {
    return "true";
  }
}

/** The grid's square in the corner: "100 ls", "10,000 ls". */
const fmtSquare = (ls: number) => `${ls.toLocaleString()} ls`;
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
type Hit = { addr: number; name: string; note: string };

/**
 * Systems by name for the search (owner, 2026-10-30: "scan route needs a search"): the commander's own and the
 * plotted ones (`/api/galaxy/find`, by address), then Spansh's (`/api/system/spansh-search`). Galaxy index hits come
 * without an address and are left to Spansh's list.
 */
async function findSystems(q: string, signal: AbortSignal): Promise<Hit[]> {
  const out: Hit[] = [];
  const seen = new Set<number>();
  const add = (addr: number, name: string, note: string) => {
    if (!Number.isFinite(addr) || addr <= 0 || seen.has(addr)) return;
    seen.add(addr);
    out.push({ addr, name, note });
  };
  const [own, spansh] = await Promise.all([
    fetch(`/api/galaxy/find?q=${encodeURIComponent(q)}`, { signal })
      .then((r) => (r.ok ? (r.json() as Promise<GalaxyFindDTO>) : null))
      .catch(() => null),
    fetch(`/api/system/spansh-search?q=${encodeURIComponent(q)}`, { signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ systems?: { systemAddress: number; starSystem: string }[] }>) : null))
      .catch(() => null),
  ]);
  for (const s of own?.systems ?? []) if (s.addr) add(Number(s.addr), s.name, s.mine ? "yours" : s.plotted ? "plotted" : "");
  for (const s of spansh?.systems ?? []) add(s.systemAddress, s.starSystem, "Spansh");
  return out.slice(0, 12);
}

export function ScanRouteScreen({ onClose }: { onClose?: () => void }) {
  const [min, setMin] = useState(readMin);
  // True light-seconds under a grid, or every orbit on a log scale (scanRouteScene.ts); kept on this PC.
  const [scale, setScaleState] = useState<ScanScale>(readScale);
  const setScale = (v: ScanScale) => {
    setScaleState(v);
    try {
      localStorage.setItem(SCALE_KEY, v);
    } catch {
      /* this session only */
    }
  };
  const [gridLs, setGridLs] = useState<number | null>(null);
  // What the box says, and the minimum asked for 400 ms after the last key (each one re-plans the route).
  const [minText, setMinText] = useState(String(readMin()));
  const [route, setRoute] = useState<GalaxyRouteDTO | null>(null);
  // The system shown, by address (null: the current system): a jump moves the route on, not the view.
  const [sel, setSel] = useState<number | null>(null);
  // A system found by name, shown instead of the route's until < or > goes back to the route.
  const [searched, setSearched] = useState<Stop | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
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
  const stop = searched ?? stops[at]!;
  const go = (i: number) => {
    setSearched(null);
    setSel(stops[Math.max(0, Math.min(stops.length - 1, i))]!.addr);
  };

  // The route ahead read for what is known of it (routeValues.ts: the journals, else Spansh), for "Next known".
  const ahead = useMemo(
    () =>
      stops
        .slice(1)
        .filter((s): s is { addr: number; name: string } => s.addr != null)
        .map((s) => ({ addr: s.addr, name: s.name })),
    [stops],
  );
  const { values: aheadValues, read: aheadRead } = useRouteValues(ahead, ahead.length > 0);
  const knownAt = (i: number) => {
    const a = stops[i]?.addr;
    const v = a != null ? aheadValues.get(a) : undefined;
    return !!v && v.state === "ok" && v.bodyCount > 0;
  };
  let nextKnown = -1;
  for (let i = (searched ? 0 : at) + 1; i < stops.length; i++)
    if (knownAt(i)) {
      nextKnown = i;
      break;
    }

  // The search: a moment after the typing stops.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setHits(null);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      void findSystems(q, ac.signal).then((h) => {
        if (!ac.signal.aborted) setHits(h);
      });
    }, 400);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query]);
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
    const s = createScanRouteScene(host.current, setPicked, setGridLs);
    scene.current = s;
    return () => {
      s.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    if (typeof view === "object") scene.current?.show(view, scale);
    else scene.current?.clear();
  }, [view, scale]);

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
        <button type="button" onClick={() => go(searched ? at : at - 1)} disabled={!searched && at <= 0} aria-label="Previous system">
          ◀
        </button>
        <div className="scan-route__name">
          <strong>{stop.addr == null ? d?.name || stop.name : stop.name}</strong>
          <span>{searched ? "Searched · < or > back to the route" : at === 0 ? "Current system" : `Route ${at} of ${stops.length - 1}`}</span>
        </div>
        <button type="button" onClick={() => go(searched ? at : at + 1)} disabled={!searched && at >= stops.length - 1} aria-label="Next system">
          ▶
        </button>
        <button
          type="button"
          onClick={() => nextKnown >= 0 && go(nextKnown)}
          disabled={nextKnown < 0}
          title={
            nextKnown >= 0
              ? `${stops[nextKnown]!.name}: the next system ahead with its bodies known (your scans, EDSM or Spansh)`
              : aheadRead < ahead.length
                ? `Reading the route ahead… ${aheadRead} of ${ahead.length}`
                : "No system ahead has its bodies known"
          }
        >
          Next known ▶▶{nextKnown < 0 && aheadRead < ahead.length ? ` (${aheadRead}/${ahead.length})` : ""}
        </button>
        <div className="scan-route__search">
          <input
            type="search"
            placeholder="Find a system"
            aria-label="Find a system for the scan route"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
          {hits ? (
            <ul className="scan-route__hits" role="listbox">
              {hits.length ? (
                hits.map((h) => (
                  <li key={h.addr}>
                    <button
                      type="button"
                      onClick={() => {
                        setSearched({ addr: h.addr, name: h.name });
                        setQuery("");
                      }}
                    >
                      {h.name}
                      {h.note ? <em>{h.note}</em> : null}
                    </button>
                  </li>
                ))
              ) : (
                <li className="scan-route__note">Nothing found.</li>
              )}
            </ul>
          ) : null}
        </div>
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
        <button
          type="button"
          onClick={() => setScale(scale === "true" ? "compact" : "true")}
          title={scale === "true" ? "Every orbit on a log scale: the whole system at once" : "Light-seconds as they are, under a grid"}
        >
          {scale === "true" ? "Compact" : "True scale"}
        </button>
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
        <div className="scan-route__view" ref={host}>
          {scale === "true" && gridLs ? (
            <span className="scan-route__grid" title="One square of the grid; the wheel zooms to the mouse">
              □ {fmtSquare(gridLs)}
            </span>
          ) : null}
        </div>
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
                  <li key={b.id} className={`scan-route__stop scan-route__stop--${b.target}${picked === b.id ? " is-picked" : ""}`} onClick={() => {
                      setPicked(b.id);
                      scene.current?.focus(b.id);
                    }}>
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
