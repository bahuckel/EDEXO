import type { DScanBodiesDTO } from "@shared/types";
import { CopySystemButton } from "./CopySystemButton";

const TITLE =
  "Total bodies = FSS honk BodyCount / FSSAllBodiesFound when present; otherwise from merged journal Scan rows, EDSM map data, and the drawn system map. Found = physical bodies on the system map when available, else Scan/Progress fallback.";

export function DScanBodiesBadge({
  d,
  className,
  headerMetrics,
}: {
  d: DScanBodiesDTO;
  className?: string;
  /** Compare's tray: drawn as one of its tiles (label over value). */
  headerMetrics?: boolean;
}) {
  // Without a honk the total is only what was scanned by hand, so "found = total" proves nothing.
  const honked = d.honked !== false;
  const complete = d.complete || (honked && d.found >= d.total);
  const honkTitle = honked ? "Discovery scan done in this system." : "No discovery scan (honk) in this system yet.";
  // Compare's tray (owner, 2026-10-27): a tile like its neighbours, the label over "found / total", the rest smaller.
  if (headerMetrics)
    return (
      <span
        className={`d-scan-card tray-tile${complete ? " d-scan-card--complete" : ""}${className ? ` ${className}` : ""}`}
        title={`${d.systemName} — ${TITLE}`}
      >
        <span className="tray-tile__label">D-Scan</span>
        <span className="tray-tile__value">
          {d.found} / {d.total}
          <span className="tray-tile__meta">
            bodies ·{" "}
            <span className={`d-scan-card__honk${honked ? "" : " d-scan-card__honk--no"}`} title={honkTitle}>
              Honk: {honked ? "Yes" : "No"}
            </span>
          </span>
        </span>
      </span>
    );
  return (
    <span
      className={`d-scan-card${complete ? " d-scan-card--complete" : ""}${className ? ` ${className}` : ""}`}
      title={`${d.systemName} — ${TITLE}`}
    >
      <span className="d-scan-card__label">D-Scan</span>
      <span className="d-scan-card__sys">
        {d.systemName}
        <CopySystemButton system={d.systemName} />
      </span>
      <span className="d-scan-card__sep"> - </span>
      <span className="d-scan-card__nums">
        {d.found} / {d.total}
      </span>
      <span className="d-scan-card__suffix"> bodies</span>
      <span className={`d-scan-card__honk${honked ? "" : " d-scan-card__honk--no"}`} title={honkTitle}>
        {" "}
        · Honk: {honked ? "Yes" : "No"}
      </span>
    </span>
  );
}
