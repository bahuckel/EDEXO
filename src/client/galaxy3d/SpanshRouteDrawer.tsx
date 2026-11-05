/**
 * The galaxy map's Spansh drawer (plan 1.3.6 S-1, owner 2026-11-02: "Import spansh routes - yes, we can also compare
 * EDEXO to Spansh with this to optimize route"). Paste a Spansh results link: the route is read once from Spansh
 * (server/spanshRoute.ts), drawn on the map, and compared with EDEXO's own figures:
 *
 * - exobiology and road-to-riches routes: each stop's value from Spansh beside EDEXO's (the route values the NavRoute
 *   finder and the neutron drawer show, `/api/route/system-values`), the stops EDEXO values under a floor can be
 *   dropped before flying;
 * - neutron and galaxy plotter routes: EDEXO's neutron planner on the same two ends, at Spansh's range or the ship's:
 *   jumps, supercharges and refuel stops side by side, and EDEXO's line on the map in place of Spansh's on request.
 *
 * A route saved from Spansh can be imported from its file too (JSON or CSV, server/spanshRouteImport.ts, owner
 * 2026-11-04): for a result Spansh has deleted, or one planned on another PC.
 *
 * Every route read is kept on disk (server/spanshRouteFile.ts, owner 2026-11-03): Spansh deletes results within hours,
 * the "Kept routes" list opens one again after that.
 *
 * "Fly this route" flies the stops kept the way the neutron route is flown (neutronLive.ts): the next stop on the
 * clipboard after each jump onto one, the HUD's Next jump line. A fleet carrier route follows his carrier instead
 * (server/carrierRouteFollow.ts): the next stop is copied when the carrier arrives at one. Stop ends either.
 */
import { useEffect, useMemo, useState } from "react";
import type { SavedSpanshRouteDTO, SpanshRouteAnswer, SpanshRouteDTO, SpanshRouteStopDTO } from "@shared/dto/spanshRoute";
import type { RouteSystemValuesDTO } from "@shared/dto/routeSystem";
import { fmtCrShort } from "@shared/format";
import { CopySystemButton } from "../CopySystemButton";
import { useRouteValues } from "../routeValues";
import { G3D_HELP, MenuHead, MenuRow } from "./G3dMenu";
import { keepNeutronMarks, type NeutronMark } from "./neutronMarks";
import { handToNeutron } from "../NeutronDrawer";
import { LiveRouteBanner, useLiveRoute } from "./LiveRouteBanner";

const KIND_NAME: Record<SpanshRouteDTO["kind"], string> = {
  exobiology: "Exobiology",
  riches: "Road to riches",
  neutron: "Neutron plotter",
  plotter: "Galaxy plotter",
  carrier: "Fleet carrier",
};

/** Kept across openings of the drawer (it unmounts when another opens). */
const kept: { text: string; route: SpanshRouteDTO | null; dropped: number[]; floor: string } = { text: "", route: null, dropped: [], floor: "" };

/** A stop's bodies and their species, two lines at most; the whole list on hover. */
function SpeciesLine({ stop }: { stop: SpanshRouteStopDTO }) {
  const text = stop.bodies
    .map((b) => `${b.name.startsWith(stop.name) ? b.name.slice(stop.name.length).trim() : b.name}${b.species.length ? `: ${b.species.map((x) => x.name).join(", ")}` : ""}`)
    .join(" · ");
  return (
    <small className="g3d-neutron-worth g3d-spansh-species" title={text}>
      {text}
    </small>
  );
}

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
  boosted: number;
  refuels: number;
  /** The range EDEXO planned with. */
  rangeLy: number | null;
  marks: NeutronMark[];
  error?: string;
}

/**
 * Spansh's side of the comparison: its jumps, supercharges (stops on a neutron star) and refuel stops; null where its
 * planner does not say (the neutron plotter plans no fuel).
 */
function spanshCounts(route: SpanshRouteDTO): Record<"jumps" | "boosted" | "refuels", number | null> {
  const last = route.stops.length - 1;
  return {
    jumps: route.totalJumps,
    boosted: route.stops.filter((s, i) => s.neutron && i < last).length,
    refuels: route.kind === "neutron" ? null : route.stops.filter((s) => s.refuel).length,
  };
}

type RangeFrom = "spansh" | "ship";
const noCompare = (error: string): Compare => ({ jumps: 0, boosted: 0, refuels: 0, rangeLy: null, marks: [], error });
const NOT_DRAWN = "Not drawn on the map: the route you are flying keeps the line. Stop it, or Fly this one, to see it.";

export function SpanshRouteDrawer({
  onRoute,
  onFocus,
  onOpenNeutron,
}: {
  onRoute: (marks: NeutronMark[]) => void;
  onFocus: (p: { x: number; y: number; z: number }) => void;
  /** Switches to the Neutron drawer, its ends handed over (review P12). */
  onOpenNeutron?: () => void;
}) {
  const [text, setText] = useState(kept.text);
  const [route, setRoute] = useState<SpanshRouteDTO | null>(kept.route);
  const [dropped, setDropped] = useState<Set<number>>(() => new Set(kept.dropped));
  const [floor, setFloor] = useState(kept.floor);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<Compare | null>(null);
  const [rangeFrom, setRangeFrom] = useState<RangeFrom>("spansh");
  const [edexoOnMap, setEdexoOnMap] = useState(false);
  const [savedRoutes, setSavedRoutes] = useState<SavedSpanshRouteDTO[]>([]);
  const [fromCopy, setFromCopy] = useState(false);
  // The route being flown, this one or the Neutron tab's: its banner and the one Stop (review P10).
  const { view: live, refresh: refreshLive } = useLiveRoute();

  const loadSaved = () =>
    void fetch("/api/spansh-route/saved")
      .then(async (r) => (r.ok ? ((await r.json()) as { routes: SavedSpanshRouteDTO[] }).routes : []))
      .then(setSavedRoutes)
      .catch(() => setSavedRoutes([]));
  useEffect(loadSaved, []);

  const forget = async (job: string) => {
    const r = await fetch(`/api/spansh-route/saved?job=${encodeURIComponent(job)}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) setSavedRoutes(((await r.json()) as { routes: SavedSpanshRouteDTO[] }).routes);
  };

  useEffect(() => {
    kept.text = text;
    kept.route = route;
    kept.dropped = [...dropped];
    kept.floor = floor;
  }, [text, route, dropped, floor]);

  /**
   * The map's line: a route being flown keeps it (owner, 2026-11-05, review Q2: no second line, and a route only being
   * read no longer replaces the flown one). False, with a note, when it was not drawn.
   */
  const drawUnlessFlying = async (marks: NeutronMark[]): Promise<boolean> => {
    const live = await fetch("/api/neutron/live")
      .then((r) => (r.ok ? (r.json() as Promise<{ active?: boolean }>) : null))
      .catch(() => null);
    if (live?.active) {
      setNote(NOT_DRAWN);
      return false;
    }
    keepNeutronMarks(marks);
    onRoute(marks);
    return true;
  };

  /** Asks for a route (a link read from Spansh, or a file) and shows the answer. */
  const answer = async (ask: () => Promise<Response>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    setCompare(null);
    try {
      const r = await ask();
      const a = (await r.json()) as SpanshRouteAnswer;
      if (a.state === "ok") {
        if (a.note) setNote(a.note);
        setRoute(a.route);
        setEdexoOnMap(false);
        setFromCopy(a.saved === true);
        loadSaved();
        setDropped(new Set());
        if (await drawUnlessFlying(marksOf(a.route.stops))) onFocus(a.route.stops[0]!);
        else if (a.note) setNote(`${a.note} ${NOT_DRAWN}`);
      } else if (a.state === "pending") setNote("Spansh is still planning this route: read it again in a moment.");
      else setError(a.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const read = (q = text) => answer(() => fetch(`/api/spansh-route?q=${encodeURIComponent(q.trim())}`));
  // A route saved from Spansh (owner, 2026-11-04): its JSON or its "Download as CSV" (server/spanshRouteImport.ts).
  const importFile = async (f: File) => {
    const content = await f.text();
    await answer(() =>
      fetch("/api/spansh-route/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: f.name, text: content }),
      }),
    );
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

  /** The map shows Spansh's route, or EDEXO's plan of the same ends. */
  const showOnMap = async (edexo: boolean, c: Compare | null = compare) => {
    if (!route) return;
    const marks = edexo && c?.marks.length ? c.marks : marksOf(route.stops);
    if (await drawUnlessFlying(marks)) setEdexoOnMap(edexo && !!c?.marks.length);
  };

  const compareWithEdexo = async () => {
    if (!route) return;
    setBusy(true);
    setCompare(null);
    if (edexoOnMap) void showOnMap(false, null);
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
          // Without a range the planner takes the ship's.
          rangeLy: rangeFrom === "spansh" ? (route.rangeLy ?? undefined) : undefined,
        }),
      });
      const j = (await r.json()) as {
        jumps?: number;
        boosted?: number;
        refuels?: number;
        hops?: NeutronMark[];
        ship?: { rangeLy?: number };
        error?: string;
      };
      setCompare(
        r.ok
          ? {
              jumps: j.jumps ?? 0,
              boosted: j.boosted ?? 0,
              refuels: j.refuels ?? 0,
              rangeLy: j.ship?.rangeLy ?? null,
              marks: (j.hops ?? []).map((h) => ({
                name: h.name,
                x: h.x,
                y: h.y,
                z: h.z,
                kind: h.kind,
                jumps: h.jumps,
                boosted: h.boosted,
                refuel: h.refuel,
                refuelHalf: h.refuelHalf,
              })),
            }
          : noCompare(j.error ?? `Plan failed (${r.status})`),
      );
    } catch (e) {
      setCompare(noCompare(e instanceof Error ? e.message : String(e)));
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
        // The stops too (review P13): a route forgotten from the kept list, or pushed out of it, still flies.
        body: JSON.stringify({
          job: route.job,
          keep,
          kind: route.kind,
          stops: route.stops.map(({ name, x, y, z, jumps, neutron, refuel, inject }) => ({ name, x, y, z, jumps, neutron, refuel, inject })),
        }),
      });
      const j = (await r.json()) as { next?: string | null; stops?: number; error?: string };
      if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
      const marks = marksOf(keptStops);
      keepNeutronMarks(marks);
      onRoute(marks);
      setEdexoOnMap(false);
      refreshLive();
      setNote(
        `${route.kind === "carrier" ? "Following" : "Flying"} ${j.stops} stop${j.stops === 1 ? "" : "s"}${j.next ? `: ${j.next} is on the clipboard` : ""}. F6 copies the next stop again.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stopFlying = async () => {
    const r = await fetch("/api/neutron/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stop: true }) }).catch(() => null);
    // Said only when it did (review 2026-11-05: "Stopped." showed after a failed request too).
    if (!r?.ok) return setError("Could not stop the route: is EDEXO's server running?");
    refreshLive();
    // Nothing flown now: the route read here gets the map's line, else the line goes.
    if (route) {
      keepNeutronMarks(marksOf(route.stops));
      onRoute(marksOf(route.stops));
    } else {
      keepNeutronMarks([]);
      onRoute([]);
    }
    setNote("Stopped: no stop is copied after a jump any more.");
  };

  const toggle = (i: number) =>
    setDropped((cur) => {
      const n = new Set(cur);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <aside className="g3d-drawer g3d-menu g3d-plan g3d-spansh-drawer" aria-label="Spansh route" data-testid="g3d-spansh">
      <MenuHead title="Spansh route" help={G3D_HELP.spansh} />
      {live ? <LiveRouteBanner view={live} onStop={() => void stopFlying()} /> : null}
      <div className={`g3d-menu__section${live ? "" : " g3d-menu__section--first"}`}>
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
        <div className="g3d-spansh-read">
          <button type="button" className="btn-top-toggle" disabled={busy || !text.trim()} onClick={() => void read()}>
            Read from Spansh
          </button>
          <label
            className={`btn-top-toggle g3d-spansh-file${busy ? " is-disabled" : ""}`}
            title="A route saved from Spansh: its JSON, or the CSV of its Download as CSV button. Kept with the other routes."
          >
            Import a file…
            <input
              type="file"
              accept=".json,.csv,application/json,text/csv"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importFile(f);
              }}
            />
          </label>
        </div>
        {error ? <p className="g3d-panel__note g3d-panel__note--warn">{error}</p> : null}
        {note ? <p className="g3d-panel__note">{note}</p> : null}
        {savedRoutes.length ? (
          <details className="g3d-spansh-saved" open={!route}>
            <summary title="Every route read is kept here: Spansh deletes its results within hours">
              Kept routes ({savedRoutes.length})
            </summary>
            <ul>
              {savedRoutes.map((s) => (
                <li key={s.job} className={route?.job === s.job ? "is-on" : undefined}>
                  <button
                    type="button"
                    className="g3d-linkbtn"
                    disabled={busy}
                    title={`Read ${new Date(s.readAt).toLocaleString()}`}
                    onClick={() => {
                      setText(s.job);
                      void read(s.job);
                    }}
                  >
                    {KIND_NAME[s.kind]}
                    {s.from ? ` from ${s.from}` : ""}
                    {s.to ? ` to ${s.to}` : ""}
                  </button>{" "}
                  <small className="dim">
                    {s.stops} stop{s.stops === 1 ? "" : "s"}
                    {s.totalValueCr ? ` · ${fmtCrShort(s.totalValueCr)} CR` : ""} · {new Date(s.readAt).toLocaleDateString()}
                  </small>{" "}
                  <button type="button" className="g3d-linkbtn" aria-label={`Forget the route from ${s.from ?? "Spansh"}`} title="Forget it" onClick={() => void forget(s.job)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {route ? (
        <div className="g3d-menu__section">
          <p className="g3d-panel__note">
            <b>{KIND_NAME[route.kind]}</b>
            {route.from ? ` from ${route.from}` : ""}
            {route.to ? ` to ${route.to}` : ""}: {route.stops.length - 1} stop{route.stops.length === 2 ? "" : "s"},{" "}
            {route.totalJumps.toLocaleString("en-US")} jump{route.totalJumps === 1 ? "" : "s"}
            {route.rangeLy ? ` at ${route.rangeLy} ly` : ""}.{" "}
            {route.url ? (
              <a href={route.url} target="_blank" rel="noopener noreferrer">
                Open on Spansh
              </a>
            ) : (
              <span className="dim">Imported from a file.</span>
            )}
            {fromCopy && route.url ? <span className="dim"> (EDEXO&apos;s kept copy: Spansh may have deleted it since)</span> : null}
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
              <MenuRow label="Plan EDEXO's at" hint="The jump range EDEXO plans the same two ends with: the one Spansh was given, or your ship's now">
                <span className="g3d-row__val">
                  {(
                    [
                      ["spansh", route.rangeLy ? `Spansh's ${route.rangeLy} ly` : "Spansh's range"],
                      ["ship", "My ship's range"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`fdb-chip${rangeFrom === k ? " fdb-chip--on" : ""}`}
                      aria-pressed={rangeFrom === k}
                      onClick={() => {
                        setRangeFrom(k);
                        setCompare(null);
                        if (edexoOnMap) void showOnMap(false, null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              </MenuRow>
              <button type="button" className="btn-top-toggle" disabled={busy} onClick={() => void compareWithEdexo()}>
                Plan it with EDEXO too
              </button>
              {onOpenNeutron ? (
                <button
                  type="button"
                  className="btn-top-toggle"
                  title="The Neutron tab with this route's start and end filled in, to plan it there with every option"
                  onClick={() => {
                    const ends = [route.stops[0]!, route.stops[route.stops.length - 1]!].map((s) => ({
                      name: s.name,
                      x: s.x,
                      y: s.y,
                      z: s.z,
                      ...(s.id64 && Number.isSafeInteger(Number(s.id64)) ? { address: Number(s.id64) } : {}),
                    }));
                    handToNeutron(ends);
                    onOpenNeutron();
                  }}
                >
                  Open in Neutron tab
                </button>
              ) : null}
              {compare?.error ? (
                <p className="g3d-panel__note g3d-panel__note--warn" data-testid="spansh-compare">
                  EDEXO could not plan it: {compare.error}
                </p>
              ) : compare ? (
                <>
                  <table className="fdb-table g3d-neutron-table g3d-spansh-vs" data-testid="spansh-compare">
                    <thead>
                      <tr>
                        <th />
                        <th>Spansh</th>
                        <th>EDEXO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ["Jumps", "jumps"],
                          ["Supercharged", "boosted"],
                          ["Refuel stops", "refuels"],
                        ] as const
                      ).map(([label, k]) => (
                        <tr key={k}>
                          <td>{label}</td>
                          <td title={spanshCounts(route)[k] == null ? "Spansh's neutron plotter plans no fuel stops" : undefined}>
                            {spanshCounts(route)[k]?.toLocaleString("en-US") ?? "—"}
                          </td>
                          <td>{compare[k].toLocaleString("en-US")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="g3d-panel__note">
                    EDEXO at {compare.rangeLy ? `${compare.rangeLy.toFixed(1)} ly` : "your ship's range"} with your ship&apos;s tank
                    {route.rangeLy ? `; Spansh at ${route.rangeLy} ly` : ""}. The Neutron tab plans and flies EDEXO&apos;s in full.
                  </p>
                  {compare.marks.length ? (
                    <button type="button" className="btn-top-toggle" onClick={() => void showOnMap(!edexoOnMap)}>
                      {edexoOnMap ? "Show Spansh's route on the map" : "Show EDEXO's route on the map"}
                    </button>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <p className="g3d-panel__note">
              Follow with my carrier: when your carrier arrives at a stop, the next one goes to the clipboard to paste in the
              carrier&apos;s galaxy map. Restock tritium where the list says.
            </p>
          )}

          <button type="button" className="btn-top-toggle" disabled={busy || keptStops.length < 2} onClick={() => void fly()}>
            {route.kind === "carrier" ? "Follow with my carrier" : "Fly this route"}
            {dropped.size ? ` (${keptStops.length - 1} stops)` : ""}
          </button>

          <table className="fdb-table g3d-neutron-table">
            <thead>
              <tr>
                <th>Fly</th>
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
                      {i > 0 ? (
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
                        <SpeciesLine stop={s} />
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
