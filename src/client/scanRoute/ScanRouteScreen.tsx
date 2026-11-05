/**
 * The scan route tab (plan 1.3.3 R-4, owner 2026-10-30): one system of the plotted route at a time, seen from above
 * with its bodies where their orbits put them, every body valued, and the shortest way from the arrival star through
 * the planets worth mapping (mapped value at least the commander's minimum) and the bodies with biology left. The
 * current system first, < and > through the route ahead (NavRoute). The current system follows the journals: a body
 * FSSed joins at once; the bodies the honk counted and nobody scanned stand on an outer ring as "?".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ScanRouteBodyDTO, ScanRouteDTO, ScanRouteShipDTO } from "@shared/dto/routeSystem.js";
import type { GalaxyFindDTO, GalaxyRouteDTO } from "@shared/dto/galaxy.js";
import { useRouteValues } from "../routeValues";
import { fmtCrExact, fmtCrShort } from "@shared/format";
import { createScanRouteScene, type ScanNames, type ScanRouteScene, type ScanScale } from "./scanRouteScene";
import "../styles/scan-route.css";
import { RollingNumber } from "../ui/RollingNumber";

const MIN_KEY = "edexo.scanRoute.minDssCr";
/** A bio body's expected value for a stop (0: every one), and CODEX bodies under it (owner, 2026-10-31). */
const BIO_MIN_KEY = "edexo.scanRoute.bioMinCr";
const CODEX_KEY = "edexo.scanRoute.codex";

function readNum(key: string, def: number): number {
  try {
    const raw = localStorage.getItem(key);
    const v = Number(raw);
    return raw != null && Number.isFinite(v) && v >= 0 ? v : def;
  } catch {
    return def;
  }
}
function keep(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* this session only */
  }
}
const SCALE_KEY = "edexo.scanRoute.scale";
/** Which names show and whether the view follows the next stop (owner, 2026-11-05); kept on this PC. */
const NAMES_KEY = "edexo.scanRoute.names";
const ZOOM_NEXT_KEY = "edexo.scanRoute.zoomNext";

function readNames(): ScanNames {
  try {
    const v = localStorage.getItem(NAMES_KEY);
    return v === "route" || v === "next" ? v : "all";
  } catch {
    return "all";
  }
}

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

/** How often the ship's place in the current system is asked for (ms): the netlog's fixes come about a second apart. */
const SHIP_POLL_MS = 1500;
/**
 * In supercruise with a body of the system targeted, as often as the HUD's distance is read (four times a second; owner
 * 2026-11-05: at every 1.5 s "I basically pass almost the entire system before it updates").
 */
const SHIP_POLL_FAST_MS = 250;
const FLIGHT: Record<ScanRouteShipDTO["flight"], string> = {
  supercruise: "In supercruise",
  normal: "In normal space",
  landed: "Landed",
  docked: "Docked",
  unknown: "",
};
/** What the netlog switch is doing, under it. */
const NETLOG_NOTE: Record<ScanRouteShipDTO["netlog"]["state"], string> = {
  off: "Off: the ship shows at the body you were last at. On: the game's network log adds where you are between them.",
  reading: "Reading the game's network log.",
  waiting: "On. The game reads this setting when it starts: restart the game if it is running.",
  "no-game": "No game folder found (Steam, Epic or Frontier's launcher).",
  failed: "The game's settings file could not be written; the folder may need administrator rights.",
};

const fmtLs = (ls: number) =>
  ls >= 10_000 ? `${Math.round(ls).toLocaleString()} ls` : ls < 1 ? `${ls.toFixed(2)} ls` : `${ls.toFixed(ls < 10 ? 1 : 0)} ls`;

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
  const [names, setNamesState] = useState<ScanNames>(readNames);
  const setNames = (v: ScanNames) => {
    setNamesState(v);
    keep(NAMES_KEY, v);
  };
  const [zoomNext, setZoomNextState] = useState(() => readNum(ZOOM_NEXT_KEY, 0) === 1);
  const setZoomNext = (v: boolean) => {
    setZoomNextState(v);
    keep(ZOOM_NEXT_KEY, v ? "1" : "0");
  };
  const [gridLs, setGridLs] = useState<number | null>(null);
  // What the box says, and the minimum asked for 400 ms after the last key (each one re-plans the route).
  const [minText, setMinText] = useState(String(readMin()));
  const [bioMin, setBioMin] = useState(() => readNum(BIO_MIN_KEY, 0));
  const [bioMinText, setBioMinText] = useState(() => String(readNum(BIO_MIN_KEY, 0)));
  const [codexOn, setCodexOnState] = useState(() => readNum(CODEX_KEY, 0) === 1);
  const setCodexOn = (v: boolean) => {
    setCodexOnState(v);
    keep(CODEX_KEY, v ? "1" : "0");
  };
  const [route, setRoute] = useState<GalaxyRouteDTO | null>(null);
  // The system shown, by address (null: the current system): a jump moves the route on, not the view.
  const [sel, setSel] = useState<number | null>(null);
  // A system found by name, shown instead of the route's until < or > goes back to the route.
  const [searched, setSearched] = useState<Stop | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [view, setView] = useState<ScanRouteDTO | "loading" | "error">("loading");
  // Where the ship is in the current system (plan 1.3.5 R-1): the body it is at, the target, the netlog's fix.
  const [ship, setShip] = useState<ScanRouteShipDTO | null>(null);
  /*
    A body's facts (owner, 2026-10-31, plan 1.3.4 S-8): shown while it is hovered, in the list or the view, and gone
    when the pointer leaves it; a click keeps them (and turns the camera to it) until another system is shown, a jump
    included. Hovering another body while one is kept shows that one, and the kept one again on leaving.
  */
  const [picked, setPicked] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const hoverList = (id: number | null) => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (id == null) return setHovered(null);
    // A moment's rest first: moving down the list flashes no facts for the rows crossed.
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setHovered(id);
    }, 150);
  };
  useEffect(() => () => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
  }, []);
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
  /*
    The ship, every second and a half while the tab shows, every quarter second flying to a target in supercruise. The
    asking says the tab shows (`view=1`): the server's trigger for the HUD distance reader, which reads only then.
  */
  useEffect(() => {
    let live = true;
    let t: ReturnType<typeof setTimeout> | null = null;
    let fast = false;
    const shows = () => document.visibilityState === "visible" && !!host.current?.offsetParent;
    const tick = () => {
      if (!live) return;
      const next = () => {
        if (live) t = setTimeout(tick, fast ? SHIP_POLL_FAST_MS : SHIP_POLL_MS);
      };
      if (!shows()) return next();
      fetch("/api/scan-route/ship?view=1")
        .then((r) => (r.ok ? (r.json() as Promise<ScanRouteShipDTO>) : null))
        .then((s) => {
          if (!live || !s) return;
          fast = s.flight === "supercruise" && s.targetId != null;
          setShip(s);
        })
        .catch(() => undefined)
        .finally(next);
    };
    tick();
    return () => {
      live = false;
      if (t) clearTimeout(t);
    };
  }, []);
  const setNetlog = (on: boolean) =>
    void fetch("/api/scan-route/netlog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) })
      .then((r) => (r.ok ? (r.json() as Promise<ScanRouteShipDTO["netlog"]>) : null))
      .then((n) => n && setShip((s) => (s ? { ...s, netlog: n } : s)))
      .catch(() => undefined);

  // The current system's view is read again when the commander's systems move (a jump, a scan) or the ship reaches
  // another body (the route starts there).
  const rev = stop.addr == null ? `${route?.system ?? ""}|${route?.mineRev ?? ""}|${ship?.atId ?? ""}` : "";

  useEffect(() => {
    let live = true;
    // Another system: its own view, not the last one's, while it loads (a route system waits for Spansh).
    const key = `${stop.addr ?? "here"}|${stop.name}`;
    if (key !== shownKey.current) {
      shownKey.current = key;
      setView("loading");
    }
    const q = new URLSearchParams({ min: String(min), bioMin: String(bioMin), codex: codexOn ? "1" : "0" });
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
  }, [stop.addr, stop.name, min, bioMin, codexOn, rev]);

  useEffect(() => {
    if (!host.current) return;
    const s = createScanRouteScene(host.current, setPicked, setGridLs, setHovered);
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
  useEffect(() => {
    const t = setTimeout(() => {
      const v = Math.max(0, Number(bioMinText) || 0);
      setBioMin(v);
      keep(BIO_MIN_KEY, String(v));
    }, 400);
    return () => clearTimeout(t);
  }, [bioMinText]);

  const d = typeof view === "object" ? view : null;
  // Another system shown (a jump moves the view on): what was kept or hovered belonged to the one before.
  const shownAddr = d?.addr ?? null;
  useEffect(() => {
    setPicked(null);
    setHovered(null);
  }, [shownAddr]);
  const byId = new Map(d?.bodies.map((b) => [b.id, b]) ?? []);
  // The ship belongs on the view of the system it is in.
  const shipHere = d && ship && ship.addr === d.addr ? ship : null;
  useEffect(() => {
    scene.current?.setShip(
      shipHere ? { atId: shipHere.atId, atFrom: shipHere.atFrom, targetId: shipHere.targetId, fix: shipHere.fix, nextInLine: d?.route.order[0] ?? null } : null,
    );
  }, [shipHere?.atId, shipHere?.atFrom, shipHere?.targetId, shipHere?.fix?.refId, shipHere?.fix?.distLs, d?.route.order[0], view, scale]); // eslint-disable-line react-hooks/exhaustive-deps
  /*
    The next stop (owner, 2026-11-05: "zoom to next target planet", "names only for next planet in line"): the body the
    game has targeted when it is one of the route's stops, else the route's first stop (the route starts where the ship is).
  */
  const order = d?.route.order;
  const nextId = order?.length ? (shipHere?.targetId != null && order.includes(shipHere.targetId) ? shipHere.targetId : order[0]!) : null;
  useEffect(() => {
    scene.current?.setNames(names, nextId);
  }, [names, nextId, view, scale]);
  /*
    After the view is drawn (the effect above `show`s it), again whenever the stop, the target or the view changes:
    targeting the route's next stop, it is followed with the ship (owner, 2026-11-05: the zoom keeps the player on the
    screen, closing in as the ship does); any other target ("out of order"), the view frames the next stop as before and
    the ship's dotted line goes to the body targeted.
  */
  const inLine = order?.[0] ?? null;
  const followShip = shipHere?.targetId != null && shipHere.targetId === inLine;
  useEffect(() => {
    if (zoomNext && followShip) return void scene.current?.follow(inLine);
    scene.current?.follow(null);
    if (zoomNext && nextId != null) scene.current?.focus(nextId);
  }, [zoomNext, followShip, inLine, nextId, view, scale]);
  const factsId = hovered ?? picked;
  const facts = factsId != null ? byId.get(factsId) : undefined;
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
        <label className="scan-route__min" title="A body with biology joins when its expected exobiology is at least this (0: every one)">
          Bio worth at least
          <input
            type="number"
            min={0}
            step={1_000_000}
            value={bioMinText}
            onChange={(e) => setBioMinText(e.target.value)}
          />
          cr
        </label>
        <label className="scan-route__min" title="A body whose likely species include one not yet in your codex for this region joins the route, whatever its value">
          <input type="checkbox" checked={codexOn} onChange={(e) => setCodexOn(e.target.checked)} />
          Include codex bodies
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
        <label className="scan-route__min" title="Which bodies have their names on the view">
          Names
          <select value={names} onChange={(e) => setNames(e.target.value as ScanNames)}>
            <option value="all">All bodies</option>
            <option value="route">Only the route's planets</option>
            <option value="next">Only the next planet</option>
          </select>
        </label>
        <label
          className="scan-route__min"
          title="The view follows the next planet of the route: the one you target in game when it is on the route, else the route's next stop"
        >
          <input type="checkbox" checked={zoomNext} onChange={(e) => setZoomNext(e.target.checked)} />
          Zoom to the next planet
        </label>
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
          {/* Over the view, top left: in the side panel it could sit scrolled out of sight. */}
          {facts ? (
            <div className={`scan-route__facts${factsId === picked ? " is-picked" : ""}`} role="status">
              <strong>{facts.short}</strong> {facts.tag ?? facts.cls}
              <br />
              Scan {fmtCrShort(facts.fssCr)}
              {facts.dssCr != null ? ` · Mapped ${fmtCrShort(facts.dssCr)}` : ""}
              {facts.mapped ? " · mapped" : ""}
              {facts.bioSignals ? ` · ${facts.bioSignals} bio${facts.bioCr != null ? ` ${fmtCrShort(facts.bioCr)}` : ""}` : ""}
              {facts.codexNew ? ` · CODEX ×${facts.codexNew}${facts.codexFirst ? " (first)" : ""}` : ""}
              {facts.others ? " · not scanned by you" : ""}
              {factsId === picked ? <span className="scan-route__facts-kept">kept until a jump · click it again to put it away</span> : null}
            </div>
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
                  <tr title="Every star and planet scanned with the FSS, the honk included">
                    <td>System scan value</td>
                    <td>
                      <RollingNumber text={fmtCrExact(d.totals.scanCr)} />
                    </td>
                  </tr>
                  <tr title="Every planet mapped (in place of its scan), the stars scanned, the honk">
                    <td>System mapped value</td>
                    <td>
                      <RollingNumber text={fmtCrExact(d.totals.mappedCr)} />
                    </td>
                  </tr>
                  {d.totals.currentCr != null ? (
                    <tr title="What your own scans here sell for now">
                      <td>Current value</td>
                      <td>
                        <RollingNumber text={fmtCrExact(d.totals.currentCr)} />
                      </td>
                    </tr>
                  ) : null}
                  {d.totals.codexNew ? (
                    <tr title="The likeliest species of each genus on its bodies not yet in your codex for this region; first: nobody has logged it here">
                      <td>Codex</td>
                      <td className="scan-route__codex">
                        CODEX ×{d.totals.codexNew}
                        {d.totals.codexFirst ? ` · ${d.totals.codexFirst} first` : ""}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
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
              {start ? (
                <p className="scan-route__start">
                  {d.startShip ? `◎ Your ship · ${start.short}` : `◎ Arrival star${start.short !== d.name ? ` · ${start.short}` : ""}`}
                </p>
              ) : null}
              {shipHere ? <ShipLine ship={shipHere} byId={byId} /> : null}
              {d.addr === ship?.addr ? (
                <div className="scan-route__live">
                  <label title="Sets VerboseLogging in the game's AppConfigLocal.xml (switching off puts the file back) and reads the position lines of its network log, nothing else from it">
                    <input type="checkbox" checked={ship.netlog.on} onChange={(e) => setNetlog(e.target.checked)} />
                    Live position (the game's network log)
                  </label>
                  <p className="dim">{NETLOG_NOTE[ship.netlog.state]}</p>
                  {ship.fix?.from !== "hud" ? (
                    <p className="dim">
                      In supercruise, the launcher's HUD option "Read the target's distance off the HUD" moves the ship along to the target.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <ol className="scan-route__list">
                {legs.map(({ b, leg }) => (
                  <li
                    key={b.id}
                    className={`scan-route__stop scan-route__stop--${b.target}${picked === b.id ? " is-picked" : ""}${hovered === b.id ? " is-hovered" : ""}`}
                    onClick={() => {
                      hoverList(null);
                      setPicked(picked === b.id ? null : b.id);
                      if (picked !== b.id) scene.current?.focus(b.id);
                    }}
                    onMouseEnter={() => hoverList(b.id)}
                    onMouseLeave={() => hoverList(null)}
                  >
                    <div className="scan-route__head">
                      <strong>{b.short}</strong>
                      <span>{fmtLs(leg)}</span>
                    </div>
                    <div className="scan-route__why">
                      <span>
                        {b.tag ?? b.cls} · Scan {fmtCrShort(b.fssCr)}
                        {b.dssCr != null ? ` · Mapped ${fmtCrShort(b.dssCr)}` : ""}
                      </span>
                      {b.bioSignals ? (
                        <span>
                          {b.bioSignals} bio{b.bioCr != null ? ` · ${fmtCrShort(b.bioCr)}` : ""}
                        </span>
                      ) : null}
                      {b.codexNew ? (
                        <span className="scan-route__codex">
                          CODEX ×{b.codexNew}
                          {b.codexFirst ? " (first)" : ""}
                        </span>
                      ) : null}
                      {b.others ? <span className="dim">not scanned by you</span> : null}
                    </div>
                  </li>
                ))}
              </ol>
              <p className="scan-route__legend">
                <i className="k-dss" /> worth mapping <i className="k-bio" /> biology <i className="k-both" /> both{" "}
                <i className="k-codex" /> codex · ? not scanned yet
              </p>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** The ship's line under the start: its flight, the body targeted, and the netlog's or the HUD's fix with its age. */
function ShipLine({ ship, byId }: { ship: ScanRouteShipDTO; byId: Map<number, ScanRouteBodyDTO> }) {
  const target = ship.targetId != null ? byId.get(ship.targetId) : undefined;
  const ref = ship.fix ? byId.get(ship.fix.refId) : undefined;
  const age = ship.fix ? Math.round((Date.now() - ship.fix.atMs) / 1000) : 0;
  const parts = [FLIGHT[ship.flight], target ? `→ ${target.short}` : ""].filter(Boolean);
  if (!parts.length && !ref) return null;
  return (
    <p className="scan-route__ship">
      ▲ {parts.join(" ")}
      {ref ? (
        <span>
          {" "}
          · {fmtLs(ship.fix!.distLs)} {ship.fix!.from === "hud" ? `to ${ref.short} (read off the HUD)` : `from ${ref.short}`}
          {age > 5 ? ` (${age} s ago)` : ""}
        </span>
      ) : null}
    </p>
  );
}
