/**
 * The screen marker (owner, 2026-11-04): a dot in a circle on the screen where each composition-scanned plant is, from
 * the nose; pointing at one opens it into a hexagon with its name. A full-screen, click-through window over the game
 * (electron/aimWindow.cjs), fed by the HUD's own socket: the radar's frame (exoMinimap) at the Status.json rate.
 * The maths is project.ts. Later (owner): the hexagon holds a per-genus outline, animated open.
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ExoMinimapDTO } from "@shared/types";
import { openMark, projectMarks, viewOf, type ScreenMark, type View } from "./project";
import "./aim.css";

type MiniMap = ExoMinimapDTO | null;

const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const HOW = { crossing: "located from 2 scans", ahead: "ahead of its scan", "scanned-from": "scanned from here" } as const;

/** A hexagon's points, radius `r`, flat sides left and right. */
const hex = (r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
  }).join(" ");

function useMinimap(): MiniMap {
  const [map, setMap] = useState<MiniMap>(null);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 1000;
    let stopped = false;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host || "127.0.0.1:7111"}/ws?channel=hud`);
      ws.onopen = () => {
        retry = 1000;
        ws?.send(JSON.stringify({ type: "hello", channel: "hud" }));
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { type?: string; payload?: { exoMinimap?: MiniMap; journalBoot?: boolean } };
          if ((msg.type === "state" || msg.type === "exoLive") && msg.payload && "exoMinimap" in msg.payload)
            setMap(msg.payload.journalBoot ? null : (msg.payload.exoMinimap ?? null));
        } catch {
          /* a malformed frame is skipped */
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setTimeout(connect, retry);
        retry = Math.min(10_000, retry * 2);
      };
    };
    connect();
    return () => {
      stopped = true;
      ws?.close();
    };
  }, []);
  return map;
}

function useView(): View {
  const [fov, setFov] = useState<number | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    void fetch("/api/elite-view")
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { verticalFovDeg?: number | null } | null) => setFov(v?.verticalFovDeg ?? null))
      .catch(() => setFov(null));
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewOf(size.w, size.h, fov);
}

function Marker({ s, open }: { s: ScreenMark; open: boolean }) {
  const m = s.mark;
  if (s.edge) {
    // Off the side: an arrow at that edge, at the middle line, with how far to turn.
    const left = s.edge === "left";
    return (
      <g className={"aim-edge" + (m.target ? " is-target" : "")} transform={`translate(${left ? 24 : s.x - 24},${s.y})`}>
        <polygon points={left ? "-10,0 6,-10 6,10" : "10,0 -6,-10 -6,10"} />
        <text x={left ? 14 : -14} y="5" textAnchor={left ? "start" : "end"}>
          {Math.round(Math.abs(s.turnDeg))}°
        </text>
      </g>
    );
  }
  return (
    <g className={"aim-mark" + (m.target ? " is-target" : "") + (open ? " is-open" : "") + (s.pitched ? "" : " is-level")} transform={`translate(${s.x},${s.y})`}>
      {open ? (
        <>
          <polygon className="aim-hex" points={hex(34)} />
          <text className="aim-name" y="-46" textAnchor="middle">
            {m.name ?? m.label}
          </text>
          <text className="aim-sub" y="56" textAnchor="middle">
            {fmtM(m.distanceM)}
            {s.belowDeg != null ? ` · ${Math.round(Math.abs(s.belowDeg))}° ${s.belowDeg >= 0 ? "below" : "above"}` : ""}
            {m.located ? ` · ${HOW[m.located]}` : ""}
          </text>
        </>
      ) : (
        <>
          <circle className="aim-ring" r="16" />
          <circle className="aim-dot" r="3.5" />
          <text className="aim-dist" y="32" textAnchor="middle">
            {fmtM(m.distanceM)}

          </text>
        </>
      )}
    </g>
  );
}

/**
 * `?demo`: a fixed frame to see the marker without the game (owner at work): 120 m up, nose 20 deg down, one plant
 * where the nose points (open), the next to sample to the right, one scanned-from ahead-left, one behind.
 */
const DEMO: ExoMinimapDTO | null = new URLSearchParams(location.search).has("demo")
  ? {
      radiusM: 500,
      headingDeg: 0,
      minSampleDistanceM: 150,
      altitudeM: 120,
      pitchDeg: -20,
      marks: [
        { kind: "codex", eastM: 5, northM: 330, distanceM: 330, label: "", name: "Stratum Tectonicas - Green", located: "crossing" },
        { kind: "codex", eastM: 260, northM: 420, distanceM: 494, label: "", name: "Bacterium Vesicula - Lime", located: "ahead", target: true },
        { kind: "codex", eastM: -300, northM: 700, distanceM: 762, label: "", name: "Tussock Virgam - Yellow", located: "scanned-from", scanHeadingDeg: 10 },
        { kind: "codex", eastM: -200, northM: -600, distanceM: 632, label: "", name: "Osseus Discus - White", located: "scanned-from" },
      ],
    }
  : null;

function Aim() {
  const live = useMinimap();
  const map = DEMO ?? live;
  const view = useView();
  const marks = projectMarks(map, view);
  const open = openMark(marks, view);
  if (!marks.length) return null;
  return (
    <svg className="aim" width={view.width} height={view.height} aria-hidden="true">
      {marks.map((s, i) => (
        <Marker key={i} s={s} open={s === open} />
      ))}
    </svg>
  );
}

createRoot(document.getElementById("aim")!).render(<Aim />);
