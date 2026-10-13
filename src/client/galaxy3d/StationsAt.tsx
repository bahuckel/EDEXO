/**
 * The stations of a system on the galaxy map's Stations layer (owner, 2026-10-13: "add station names to galaxy map
 * dots, even when there are more than one in the same system"). The layer has one point per system, so the names
 * are asked for when a dot is pointed at or picked (`/api/stations/at`), kept for the session.
 */
import { useEffect, useState } from "react";
import { CopySystemButton } from "../CopySystemButton";

export interface StationAtRow {
  name: string;
  system: string;
  type: string;
  pad: "L" | "M" | "S" | "";
  distanceLs: number;
  services: string[];
  updated: string | null;
}

const cache = new Map<string, StationAtRow[]>();

function useStationsAt(p: { x: number; y: number; z: number }): StationAtRow[] | null {
  const key = `${p.x},${p.y},${p.z}`;
  const [rows, setRows] = useState<StationAtRow[] | null>(cache.get(key) ?? null);
  useEffect(() => {
    const hit = cache.get(key);
    if (hit) return void setRows(hit);
    setRows(null);
    const ac = new AbortController();
    // A short wait: sweeping the mouse over many dots asks only for the one it stops on.
    const t = window.setTimeout(() => {
      void fetch(`/api/stations/at?x=${p.x}&y=${p.y}&z=${p.z}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { stations?: StationAtRow[] } | null) => {
          const list = j?.stations ?? [];
          cache.set(key, list);
          if (!ac.signal.aborted) setRows(list);
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [key, p.x, p.y, p.z]);
  return rows;
}

const pad = (r: StationAtRow) => (r.pad ? ` · ${r.pad}` : "");

/** The hover card's lines: the first few names. */
export function StationNames({ x, y, z }: { x: number; y: number; z: number }) {
  const rows = useStationsAt({ x, y, z });
  if (!rows?.length) return null;
  const shown = rows.slice(0, 6);
  return (
    <span className="g3d-stations-at">
      {shown.map((r) => `${r.name}${pad(r)}`).join(", ")}
      {rows.length > shown.length ? ` +${rows.length - shown.length} more` : ""}
    </span>
  );
}

/** The side card: every station of the system, with its type, pad, distance and services. */
export function StationsList({ x, y, z }: { x: number; y: number; z: number }) {
  const rows = useStationsAt({ x, y, z });
  if (!rows) return <p className="g3d-panel__note">Reading the stations…</p>;
  if (!rows.length) return null;
  return (
    <ul className="g3d-stations-list">
      {rows.map((r, i) => (
        <li key={`${r.name}-${i}`} title={r.services.join(", ")}>
          <strong>{r.name}</strong>
          <span className="dim">
            {" "}
            {r.type}
            {pad(r)}
            {r.distanceLs ? ` · ${r.distanceLs.toLocaleString("en-US")} ls` : ""}
            {r.services.length ? ` · ${r.services.length} services` : ""}
          </span>
        </li>
      ))}
      <li className="dim">
        {rows[0]!.system} <CopySystemButton system={rows[0]!.system} />
      </li>
    </ul>
  );
}
