/**
 * Stations — the nearest station with the services you need (plan 7, owner 2026-10-13: "same as the carrier thing").
 * The Carriers window's second tab. Like the carriers list it is empty until asked: the first thing it shows is a
 * download button saying what it fetches (Spansh's station dump, boiled down to one file beside the galaxy index),
 * and every search after that runs on this machine.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isBool, isNum, isStr, isStrArr, usePersistedState } from "./usePersistedState";
import { CopySystemButton } from "./CopySystemButton";
import { LoadingNote } from "./ui/Loading";
import { fmtLyAway } from "@shared/format";

interface StationRow {
  name: string;
  system: string;
  type: string;
  pad: "L" | "M" | "S" | "";
  distanceLs: number;
  services: string[];
  updated: string | null;
  distanceLy: number;
  x?: number;
  y?: number;
  z?: number;
  /** Its point on the galaxy map's Stations layer. */
  sys?: number;
  /** In a system the commander claimed: his own. */
  own?: boolean;
}

export type { StationRow as StationPick };

interface StationsStatus {
  present: boolean;
  stations: number | null;
  dump: string | null;
  bytes: number | null;
  downloading: { done: number; total: number | null } | null;
  error: string | null;
  release: { stations: number; dump: string | null; bytes: number } | null;
}

/** The services worth a chip, shortest label first; the file holds a few more (missions, shop …). */
const SERVICE_CHIPS: { key: string; label: string }[] = [
  { key: "Refuel", label: "Refuel" },
  { key: "Repair", label: "Repair" },
  { key: "Restock", label: "Rearm" },
  { key: "Universal Cartographics", label: "Cartographics" },
  { key: "Vista Genomics", label: "Vista Genomics" },
  { key: "Interstellar Factors Contact", label: "Interstellar Factors" },
  { key: "Material Trader", label: "Material Trader" },
  { key: "Technology Broker", label: "Tech Broker" },
  { key: "Shipyard", label: "Shipyard" },
  { key: "Outfitting", label: "Outfitting" },
  { key: "Market", label: "Market" },
  { key: "Black Market", label: "Black Market" },
  { key: "Search and Rescue", label: "Search and Rescue" },
  { key: "Pioneer Supplies", label: "Pioneer Supplies" },
];
const PADS: { key: string; label: string }[] = [
  { key: "", label: "Any pad" },
  { key: "M", label: "M pad+" },
  { key: "L", label: "L pad" },
];
const MAX_LS = [0, 1000, 5000, 20000];
const mb = (b: number | null) => (b == null ? "" : `${Math.round(b / 1e6)} MB`);
const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

/**
 * `compact`: the galaxy map's side drawer (owner, 2026-10-13: nearest with a service on the map too) — fewer
 * columns; `onPick`: a row clicked (the map flies there and picks the station's system).
 */
export function StationsPanel({
  compact = false,
  onPick,
}: { compact?: boolean; onPick?: (r: StationRow) => void } = {}) {
  const [status, setStatus] = useState<StationsStatus | null>(null);
  const [rows, setRows] = useState<StationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);
  const [services, setServices] = usePersistedState<string[]>("stations.services", [], isStrArr);
  const [mode, setMode] = usePersistedState<string>("stations.mode", "all", isStr);
  const [pad, setPad] = usePersistedState<string>("stations.pad", "", isStr);
  const [maxLs, setMaxLs] = usePersistedState<number>("stations.maxLs", 0, isNum);
  const [settlements, setSettlements] = usePersistedState("stations.settlements", false, isBool);
  const [construction, setConstruction] = usePersistedState("stations.construction", false, isBool);
  const seq = useRef(0);
  /*
    By name (owner, 2026-10-13: "search a station by name"): the station's name, or its name and system together;
    while there is text here the table shows those, nearest first, instead of the nearest with the services.
  */
  const [name, setName] = useState("");
  const [named, setNamed] = useState<StationRow[] | null>(null);
  useEffect(() => {
    const q = name.trim();
    if (q.length < 3) return setNamed(null);
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      void fetch(`/api/stations/search?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { stations?: StationRow[] } | null) => {
          if (!ac.signal.aborted) setNamed(j?.stations ?? []);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [name]);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/stations/status");
      setStatus((await r.json()) as StationsStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);
  // While a download runs, its progress every second.
  useEffect(() => {
    if (!status?.downloading) return;
    const t = setTimeout(() => void loadStatus(), 1000);
    return () => clearTimeout(t);
  }, [status, loadStatus]);

  const search = useCallback(async () => {
    if (!status?.present) return;
    const p = new URLSearchParams();
    if (services.length) p.set("services", services.join("|"));
    p.set("mode", mode === "any" ? "any" : "all");
    if (pad) p.set("pad", pad);
    if (maxLs) p.set("maxLs", String(maxLs));
    if (settlements) p.set("settlements", "1");
    if (construction) p.set("construction", "1");
    p.set("limit", "50");
    const n = (seq.current += 1);
    setQuerying(true);
    try {
      const r = await fetch(`/api/stations/nearest?${p.toString()}`);
      const j = (await r.json()) as { stations?: StationRow[]; error?: string };
      if (n !== seq.current) return;
      if (!r.ok) throw new Error(j.error ?? `Search failed (${r.status})`);
      setRows(j.stations ?? []);
      setError(null);
    } catch (e) {
      if (n !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (n === seq.current) setQuerying(false);
    }
  }, [status?.present, services, mode, pad, maxLs, settlements, construction]);
  useEffect(() => {
    void search();
  }, [search]);

  const download = async () => {
    setError(null);
    try {
      await fetch("/api/stations/download", { method: "POST" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    void loadStatus();
  };

  const toggle = (k: string) =>
    setServices((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  const dl = status?.downloading;
  const rel = status?.release;
  const newer = status?.present && rel && status.stations != null && rel.stations !== status.stations;

  return (
    <>
      <div className="carriers-fetch">
        {!status?.present || newer ? (
          <button
            type="button"
            className="fdb-chip fdb-chip--on"
            onClick={() => void download()}
            disabled={!!dl}
          >
            {dl
              ? `Downloading… ${dl.total ? Math.round((dl.done / dl.total) * 100) : 0} %`
              : status?.present
                ? `Update${rel ? ` · ${rel.stations - (status.stations ?? 0) >= 0 ? "+" : ""}${short(rel.stations - (status.stations ?? 0))} stations` : ""}`
                : `Download stations${rel ? ` (${mb(rel.bytes)})` : ""}`}
          </button>
        ) : null}
        <span className="dim">
          {status?.present
            ? `${(status.stations ?? 0).toLocaleString("en-US")} stations, settlements and colony sites · data of ${status.dump ?? "an unknown date"} · from Spansh`
            : `Every station, settlement and colony site with its services and pads, from Spansh's station dump${
                rel ? ` (${rel.stations.toLocaleString("en-US")} of them, data of ${rel.dump ?? "?"})` : ""
              }. Downloads one file to this machine; searches never leave it.`}
        </span>
      </div>
      {status?.error ? <p className="fdb-empty">Download failed: {status.error}</p> : null}
      {error ? <p className="fdb-empty">{error}</p> : null}
      {status?.present ? (
        <>
          <input
            className="stations-find"
            type="search"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Find a station by name (or name and system)"
            aria-label="Find a station by name"
            spellCheck={false}
          />
          {/* Grouped (owner, 2026-10-13: "services, pad size, other"), and set aside while a name is searched. */}
          <div className={`stations-filters${named ? " is-idle" : ""}`}>
            <div className="stations-filters__group">
              <span className="stations-filters__label">Services</span>
              {SERVICE_CHIPS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`fdb-chip${services.includes(s.key) ? " fdb-chip--on" : ""}`}
                  onClick={() => toggle(s.key)}
                  aria-pressed={services.includes(s.key)}
                >
                  {s.label}
                </button>
              ))}
              <button
                type="button"
                className="fdb-chip stations-filters__mode"
                onClick={() => setMode(mode === "any" ? "all" : "any")}
                title="All of the chosen services at one station, or any one of them"
              >
                {mode === "any" ? "Any of them" : "All of them"}
              </button>
            </div>
            <div className="stations-filters__group">
              <span className="stations-filters__label">Pad size</span>
              {PADS.map((p) => (
                <button
                  key={p.key || "any"}
                  type="button"
                  className={`fdb-chip${pad === p.key ? " fdb-chip--on" : ""}`}
                  onClick={() => setPad(p.key)}
                  aria-pressed={pad === p.key}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="stations-filters__group">
              <span className="stations-filters__label">From the arrival star</span>
              {MAX_LS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`fdb-chip${maxLs === n ? " fdb-chip--on" : ""}`}
                  onClick={() => setMaxLs(n)}
                  aria-pressed={maxLs === n}
                >
                  {n === 0 ? "Any distance" : `≤ ${short(n)} ls`}
                </button>
              ))}
            </div>
            <div className="stations-filters__group">
              <span className="stations-filters__label">Other</span>
              <button
                type="button"
                className={`fdb-chip${settlements ? " fdb-chip--on" : ""}`}
                onClick={() => setSettlements((v) => !v)}
                aria-pressed={settlements}
              >
                Settlements
              </button>
              <button
                type="button"
                className={`fdb-chip${construction ? " fdb-chip--on" : ""}`}
                onClick={() => setConstruction((v) => !v)}
                aria-pressed={construction}
              >
                Colony construction
              </button>
            </div>
          </div>
          {named ? (
            <p className="fdb-empty">
              {named.length
                ? `Stations named like "${name.trim()}", nearest first`
                : `No station is named like "${name.trim()}".`}
            </p>
          ) : null}
          {!named && rows == null && querying ? (
            <LoadingNote className="fdb-empty" label="Searching the stations…" />
          ) : null}
          {!named && rows && rows.length === 0 ? (
            <p className="fdb-empty">No station near you has all of that.</p>
          ) : null}
          {(named ?? rows)?.length ? (
            <div className="fdb-scroll">
              <table
                className="fdb-table carriers-table"
                style={querying && !named ? { opacity: 0.6 } : undefined}
              >
                <thead>
                  <tr>
                    <th>Station</th>
                    <th>System</th>
                    <th>Distance</th>
                    <th>Pad</th>
                    {compact ? null : (
                      <>
                        <th>From arrival</th>
                        <th>Type</th>
                        <th>Updated</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {(named ?? rows ?? []).map((r) => (
                    <tr
                      key={`${r.system}|${r.name}`}
                      title={`${r.services.join(" · ")}${onPick ? "\n\nClick to show it on the map" : ""}`}
                      className={onPick ? "is-pickable" : undefined}
                      onClick={onPick ? () => onPick(r) : undefined}
                    >
                      <td
                        className={r.own ? "stations-own" : undefined}
                        title={r.own ? "Your station" : undefined}
                      >
                        {r.name}
                      </td>
                      <td>
                        {r.system} <CopySystemButton system={r.system} />
                      </td>
                      <td>{fmtLyAway(r.distanceLy)}</td>
                      <td>{r.pad || "—"}</td>
                      {compact ? null : (
                        <>
                          <td>{r.distanceLs.toLocaleString("en-US")} ls</td>
                          <td>{r.type || "—"}</td>
                          <td className="dim">{r.updated ?? "—"}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
