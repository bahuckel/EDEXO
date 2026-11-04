/**
 * Heading to a scan (owner, 2026-11-04: "digital HUD markings on planet where something was scanned … pointing
 * directly at it shows you genus, species and color"). Under the radar: a heading tape with a tick per mark at its
 * bearing, and a line that names the mark the nose points at (within {@link POINT_DEG}), or else says which way to
 * turn for the next plant to sample. Bearings from the radar's own offsets (ExoMinimapDTO), heading from Status.json;
 * the screen marker (a later step) uses the same pick.
 */
import type { ReactNode } from "react";
import { bearingDeg, relativeDeg } from "@shared/scanLocate";
import type { ExoMinimapDTO } from "@shared/types";

type Mark = ExoMinimapDTO["marks"][number];

/** Within this many degrees of the nose a mark counts as pointed at. */
export const POINT_DEG = 4;
/** Half the tape's width, degrees. */
const TAPE_HALF_DEG = 60;

export interface Aimed {
  mark: Mark;
  /** Degrees to turn, negative left. */
  turnDeg: number;
  /** Degrees below the nose when flying (altitude and distance), null on foot or unknown. */
  downDeg: number | null;
}

/** The marks the guide speaks of: plants, the scans and the next target; not your own ship or SRV. */
const guided = (m: Mark) => m.kind === "codex" || m.kind === "sample";

function aim(map: ExoMinimapDTO, m: Mark, heading: number): Aimed {
  const turnDeg = relativeDeg(bearingDeg(m.eastM, m.northM), heading);
  const alt = map.altitudeM != null && map.altitudeM > 0 ? map.altitudeM + (map.eyeAboveM ?? 0) : null;
  const downDeg = alt != null && m.distanceM > 0 ? (Math.atan2(alt, m.distanceM) * 180) / Math.PI : null;
  return { mark: m, turnDeg, downDeg };
}

/** The mark the nose points at (the nearest in the cone), or null; null without a heading. */
export function pointedMark(map: ExoMinimapDTO | null | undefined): Aimed | null {
  if (!map || map.headingDeg == null) return null;
  let best: Aimed | null = null;
  for (const m of map.marks) {
    if (!guided(m)) continue;
    const a = aim(map, m, map.headingDeg);
    if (Math.abs(a.turnDeg) > POINT_DEG) continue;
    if (!best || m.distanceM < best.mark.distanceM) best = a;
  }
  return best;
}

/** The next plant to sample, aimed. */
export function targetMark(map: ExoMinimapDTO | null | undefined): Aimed | null {
  const m = map?.marks.find((x) => x.target);
  return m && map!.headingDeg != null ? aim(map!, m, map!.headingDeg) : null;
}

const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const HOW: Record<NonNullable<Mark["located"]>, string> = {
  crossing: "located from 2 scans",
  ahead: "ahead of its scan",
  "scanned-from": "scanned from here",
};

export function Guide({ map }: { map: ExoMinimapDTO | null | undefined }) {
  if (!map || map.headingDeg == null) return null;
  const heading = map.headingDeg;
  const marks = map.marks.filter(guided).map((m) => aim(map, m, heading));
  if (!marks.some((a) => a.mark.kind === "codex" || a.mark.target)) return null;
  const pointed = pointedMark(map);
  const target = targetMark(map);
  const x = (deg: number) => 50 + (deg / TAPE_HALF_DEG) * 50;

  let line: ReactNode;
  if (pointed) {
    const m = pointed.mark;
    line = (
      <span className="guide__name">
        <b>{m.name ?? m.label}</b> {fmtM(m.distanceM)}
        {pointed.downDeg != null ? ` · ${Math.round(pointed.downDeg)}° below` : ""}
        {m.kind === "codex" && m.located ? <span className="guide__how"> · {HOW[m.located]}</span> : null}
      </span>
    );
  } else if (target) {
    const t = Math.round(target.turnDeg);
    line = (
      <span className="guide__turn">
        Next: <b>{target.mark.name ?? target.mark.label}</b> {fmtM(target.mark.distanceM)} · turn {t < 0 ? "left" : "right"} {Math.abs(t)}°
      </span>
    );
  } else line = <span className="guide__hint">Point the nose at a mark to name it</span>;

  return (
    <div className={"guide" + (pointed ? " guide--on" : "")} data-f="guide">
      <svg className="guide__tape" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
        <line className="guide__centre" x1="50" y1="0" x2="50" y2="10" />
        {marks
          .filter((a) => Math.abs(a.turnDeg) <= TAPE_HALF_DEG)
          .map((a, i) => (
            <line
              key={i}
              className={
                "guide__tick guide__tick--" + a.mark.kind + (a.mark.target ? " is-target" : "") + (pointed?.mark === a.mark ? " is-on" : "")
              }
              x1={x(a.turnDeg)}
              y1={a.mark.target ? 0 : 3}
              x2={x(a.turnDeg)}
              y2="10"
            />
          ))}
        {target && Math.abs(target.turnDeg) > TAPE_HALF_DEG ? (
          <polygon className="guide__off" points={target.turnDeg < 0 ? "0,5 4,2 4,8" : "100,5 96,2 96,8"} />
        ) : null}
      </svg>
      <div className="guide__line">{line}</div>
    </div>
  );
}
