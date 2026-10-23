/**
 * The status bar under the map: what is loaded, how far away, and the legend. Moved out of GalaxyMap3D.tsx
 * (audit 2026-10-22).
 */
import { fmtLy } from "@shared/format";
import type { GalaxySearchApplied } from "../GalaxySearchPanel";
import type { Graphics } from "./capabilities";
import type { EngineStats } from "./engineTypes";
import type { Colour } from "./mapConstants";

export function StatusBar({
  graphics,
  stats,
  legendOn,
  setLegendOn,
  codexOn,
  colour,
  layers,
  mine,
  gggOn,
  heliumOn,
  search,
  elite,
}: {
  graphics: Graphics;
  stats: EngineStats | null;
  legendOn: boolean;
  setLegendOn: (v: boolean) => void;
  codexOn: boolean;
  colour: Colour;
  layers: { you: boolean };
  mine: { size: number };
  gggOn: boolean;
  heliumOn: boolean;
  search: GalaxySearchApplied | null;
  elite: boolean;
}) {
  const loading = !stats || stats.phase === "loading";
  return (
    <footer className="g3d-status" data-testid="g3d-status">
      {graphics.tier === "light" ? (
        <span className="g3d-badge" title={graphics.renderer}>
          Light mode — no graphics acceleration, every {stats?.stride ?? 16}th system shown from afar
        </span>
      ) : null}
      {stats?.phase === "failed" ? (
        <span className="g3d-error">
          {/HTTP 404/.test(stats.error ?? "")
            ? "No galaxy index on this PC yet — download it above."
            : `Could not load the galaxy: ${stats.error}`}
        </span>
      ) : loading ? (
        <span>Loading 5.3 million systems…</span>
      ) : (
        <span>
          {stats.overviewPoints.toLocaleString()} systems
          {stats.tilesLoaded
            ? ` · close-up: ${stats.tilesLoaded} sectors, ${stats.tilePoints.toLocaleString()} systems`
            : ""}
          {stats.level ? ` · groups of ${stats.level.toLocaleString()} ly` : ""}
          {" · "}
          {fmtLy(stats.distanceLy)} away · tilt {stats.tiltDeg}°
        </span>
      )}
      <button
        type="button"
        className="g3d-legend-toggle"
        aria-expanded={legendOn}
        onClick={() => setLegendOn(!legendOn)}
        title={legendOn ? "Hide the legend" : "Show what the colours mean"}
      >
        {legendOn ? "▾" : "▸"} Legend
      </button>
      {!legendOn ? null : codexOn ? (
        <span className="g3d-legend">
          <i className="g3d-dot g3d-dot--todo" /> nothing logged <i className="g3d-dot g3d-dot--partial" />{" "}
          some <i className="g3d-dot g3d-dot--done" /> all
        </span>
      ) : colour === 0 ? (
        <span className="g3d-legend">
          <i className="g3d-dot g3d-dot--dss" /> mapped (DSS) <i className="g3d-dot g3d-dot--codex" /> codex
          logged <i className="g3d-dot g3d-dot--signal" /> signals only
        </span>
      ) : colour === 2 ? (
        <span className="g3d-legend">
          <i className="g3d-ramp" /> recorded value, 100k → 1bn CR
        </span>
      ) : (
        <span className="g3d-legend">
          <i className="g3d-ramp g3d-ramp--species" /> 1 → 8+ species
        </span>
      )}
      {legendOn && layers.you && mine.size ? (
        <span className="g3d-legend">
          You: <i className="g3d-dot g3d-dot--waiting" /> waiting <i className="g3d-dot g3d-dot--done" />{" "}
          done <i className="g3d-dot g3d-dot--visited" /> visited
        </span>
      ) : null}
      {legendOn && gggOn ? (
        <span className="g3d-legend">
          <i className="g3d-dot g3d-dot--ggg" /> green gas giant{" "}
          <i className="g3d-dot g3d-dot--unconfirmed" /> candidate, unconfirmed
        </span>
      ) : null}
      {legendOn && heliumOn ? (
        <span className="g3d-legend">
          <i className="g3d-dot g3d-dot--helium" /> helium gas giant system
        </span>
      ) : null}
      {legendOn && search ? (
        <span className="g3d-legend">
          <i className="g3d-dot g3d-dot--search" /> {search.label}
        </span>
      ) : null}
      <span className="g3d-hint">
        {elite
          ? "W A S D move · Q E turn · R F up / down · left drag turn / tilt · right drag turn / raise · wheel zoom"
          : "Left drag pan · right drag tilt / turn · wheel zoom · click a ring or a system"}
      </span>
    </footer>
  );
}
