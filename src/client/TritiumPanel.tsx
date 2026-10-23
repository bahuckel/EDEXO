/**
 * Find Tritium (R4, owner 2026-10-23): the nearest rings with Tritium hotspots and the nearest stations and carriers
 * selling it, ten of each. The third tab of Carriers & Stations and of the galaxy map's drawer. Asked on a press, two
 * small Spansh searches (server/tritiumSearch.ts), from the map's picked system or else the ship.
 */
import { useState } from "react";
import { CopySystemButton } from "./CopySystemButton";
import { LoadingNote } from "./ui/Loading";
import { fmtLyAway } from "@shared/format";

type Point = { x: number; y: number; z: number };

interface Ring {
  system: string;
  body: string;
  ring: string;
  ringType: string;
  hotspots: number;
  distanceLy: number;
  distanceLs: number | null;
  x: number | null;
  y: number | null;
  z: number | null;
}

interface Seller {
  system: string;
  station: string;
  type: string;
  carrier: boolean;
  pad: "L" | "M" | "S" | "";
  distanceLy: number;
  distanceLs: number | null;
  supply: number;
  price: number;
  updatedAt: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
}

interface Result {
  rings: Ring[];
  sellers: Seller[];
  errors: string[];
}

const ls = (n: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString("en-US")} ls`);

function age(iso: string | null): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(d)) return "—";
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

/** The ring's own part of its name: "Barnard's Star 6 B Ring" under body "Barnard's Star 6" is "B Ring". */
function ringLabel(r: Ring): string {
  return r.ring.startsWith(`${r.body} `) ? r.ring.slice(r.body.length + 1) : r.ring;
}

export function TritiumPanel({
  compact = false,
  from = null,
  onPick,
}: {
  compact?: boolean;
  from?: Point | null;
  onPick?: (at: Point) => void;
} = {}) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where the lists were measured from, so a later pick on the map says they are from elsewhere.
  const [askedFrom, setAskedFrom] = useState<Point | null>(null);

  const find = async () => {
    setBusy(true);
    setError(null);
    const q = from ? `?x=${from.x}&y=${from.y}&z=${from.z}` : "";
    try {
      const r = await fetch(`/api/tritium${q}`);
      const j = (await r.json()) as Result & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Search failed (${r.status})`);
      setResult(j);
      setAskedFrom(from);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const at = (p: { x: number | null; y: number | null; z: number | null }): Point | null =>
    p.x != null && p.y != null && p.z != null ? { x: p.x, y: p.y, z: p.z } : null;
  const rowProps = (p: { x: number | null; y: number | null; z: number | null }) => {
    const point = onPick ? at(p) : null;
    return point
      ? { className: "is-pickable", title: "Click to show it on the map", onClick: () => onPick!(point) }
      : {};
  };
  const moved =
    result &&
    (from?.x !== askedFrom?.x || from?.y !== askedFrom?.y || from?.z !== askedFrom?.z);

  return (
    <>
      <div className="carriers-fetch">
        <button type="button" className="fdb-chip fdb-chip--on" onClick={() => void find()} disabled={busy}>
          {busy ? "Searching…" : result ? "Search again" : "Find Tritium"}
        </button>
        <span className="dim">
          {moved
            ? `These are from ${askedFrom ? "the system picked before" : "your ship"}: search again for ${from ? "the picked system" : "your ship"}.`
            : `The nearest rings with Tritium hotspots and the nearest stations and carriers selling it, ${
                from ? "from the system picked on the map" : "from your ship"
              }. Two searches at Spansh; markets seen in the last 30 days.`}
        </span>
      </div>
      {error ? <p className="fdb-empty">{error}</p> : null}
      {busy && !result ? <LoadingNote className="fdb-empty" label="Asking Spansh…" /> : null}
      {result ? (
        <div className="fdb-scroll tritium-lists">
          {result.errors.length ? <p className="fdb-empty">{result.errors.join(" · ")}</p> : null}
          <h3 className="tritium-lists__head">Rings with hotspots</h3>
          {result.rings.length ? (
            <table className="fdb-table carriers-table">
              <thead>
                <tr>
                  <th>Distance</th>
                  <th>System</th>
                  <th>Ring</th>
                  <th>Hotspots</th>
                  {compact ? null : <th>From arrival</th>}
                </tr>
              </thead>
              <tbody>
                {result.rings.map((r) => (
                  <tr key={r.ring} {...rowProps(r)}>
                    <td>{fmtLyAway(r.distanceLy)}</td>
                    <td>
                      {r.system} <CopySystemButton system={r.system} />
                    </td>
                    <td>
                      {r.body.startsWith(r.system) ? r.body.slice(r.system.length).trim() || r.body : r.body}{" "}
                      {ringLabel(r)}
                      {compact ? null : <span className="dim"> · {r.ringType}</span>}
                    </td>
                    <td>{r.hotspots}</td>
                    {compact ? null : <td>{ls(r.distanceLs)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="fdb-empty">No ring with a Tritium hotspot is known near there.</p>
          )}
          <h3 className="tritium-lists__head">Stations and carriers selling it</h3>
          {result.sellers.length ? (
            <table className="fdb-table carriers-table">
              <thead>
                <tr>
                  <th>Distance</th>
                  <th>Station</th>
                  <th>System</th>
                  <th>Pad</th>
                  <th>Stock</th>
                  <th>Price</th>
                  {compact ? null : (
                    <>
                      <th>From arrival</th>
                      <th>Market seen</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {result.sellers.map((s) => (
                  <tr key={`${s.system}|${s.station}`} {...rowProps(s)}>
                    <td>{fmtLyAway(s.distanceLy)}</td>
                    <td>
                      {s.station}
                      {s.carrier ? <span className="carriers-network-badge">Carrier</span> : null}
                    </td>
                    <td>
                      {s.system} <CopySystemButton system={s.system} />
                    </td>
                    <td>{s.pad || "—"}</td>
                    <td>{s.supply.toLocaleString("en-US")} t</td>
                    <td>{s.price.toLocaleString("en-US")} CR</td>
                    {compact ? null : (
                      <>
                        <td>{ls(s.distanceLs)}</td>
                        <td className="dim">{age(s.updatedAt)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="fdb-empty">Nobody near there has sold Tritium in the last 30 days.</p>
          )}
        </div>
      ) : null}
    </>
  );
}
