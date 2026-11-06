/**
 * The screen marker (owner, 2026-11-04): a dot in a circle on the screen where each composition-scanned plant is, from
 * the nose; pointing at one opens it into a hexagon with its name. A full-screen, click-through window over the game
 * (electron/aimWindow.cjs), fed by the HUD's own socket: the radar's frame (exoMinimap) at the Status.json rate.
 * The maths is project.ts. Later (owner): the hexagon holds a per-genus outline, animated open. With the launcher's
 * pitch reader on, this page also reads the HUD's pitch off the screen while there are plants to point at
 * (pitchCapture.ts): local only. With the launcher's distance reader on, it reads the target's distance in supercruise
 * for the Scan route (useDistanceReader.ts); opened for that alone (`?marks=0`, aimWindow.cjs), it draws nothing.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ExoMinimapDTO } from "@shared/types";
import { glidedMap, nextGlide, type GlideState } from "./glide";
import { openMark, projectMarks, viewOf, type ScreenMark, type View } from "./project";
import { startPitchCapture, type PitchCapture, type PitchRead } from "./pitchCapture";
import { useDistanceReader } from "./useDistanceReader";
import { setHudRecolour } from "./gameScreen";
import { invertHudMatrix, recolourRgba, type HudColourMatrix, type HudColourSupport } from "@shared/hudColourMatrix";
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

/** Opened for the distance reader only (the screen marker off): no marks, no pitch reader. */
const MARKS = new URLSearchParams(location.search).get("marks") !== "0";

function useMinimap(): {
  glide: GlideState | null;
  reader: boolean;
  distance: boolean;
  readDistance: boolean;
  look: "default" | "xml";
} {
  const [glide, setGlide] = useState<GlideState | null>(null);
  const [reader, setReader] = useState(false);
  const [distance, setDistance] = useState(false);
  const [readDistance, setReadDistance] = useState(false);
  // The launcher's HUD colours choice for the pitch reader (default, or the XML's matrix).
  const [look, setLook] = useState<"default" | "xml">("default");
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
          const msg = JSON.parse(String(ev.data)) as {
            type?: string;
            payload?: {
              exoMinimap?: MiniMap;
              journalBoot?: boolean;
              hudPrefs?: { pitchReader?: unknown; distanceReader?: unknown; hudColour?: unknown } | null;
              hudReadDistance?: boolean;
            };
          };
          if ((msg.type === "state" || msg.type === "exoLive") && msg.payload && "exoMinimap" in msg.payload)
          {
            const next = msg.payload.journalBoot ? null : (msg.payload.exoMinimap ?? null);
            setGlide((prev) => (next ? nextGlide(prev, next, Date.now()) : null));
          }
          if (msg.type === "state" && msg.payload && "hudPrefs" in msg.payload) {
            setReader(msg.payload.hudPrefs?.pitchReader === true);
            setDistance(msg.payload.hudPrefs?.distanceReader === true);
            setLook(msg.payload.hudPrefs?.hudColour === "xml" ? "xml" : "default");
          }
          if (msg.type === "state" && msg.payload && "hudReadDistance" in msg.payload) setReadDistance(msg.payload.hudReadDistance === true);
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
  return { glide, reader, distance, readDistance, look };
}

/** Re-render four times a second while the marks glide between Status.json writes (glide.ts). */
function useGlideTick(g: GlideState | null): void {
  const [, setTick] = useState(0);
  const moving = !!g && (g.vE !== 0 || g.vN !== 0 || g.vUp !== 0);
  useEffect(() => {
    if (!moving) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [moving, g]);
}

/**
 * The pitch reader running while it is wanted: switched on in the launcher and a composition-scanned plant on the
 * planet underfoot or flown over. Stops 10 s after it is no longer wanted, so a moment without a frame does not
 * restart the capture.
 */
/** What the pitch reader is doing, for its status line: a number read, not read, or no capture. */
/** A reading this old is held: its pitch stays, the heading is Status.json's again, the marks are drawn dashed. */
const HOLD_FRESH_MS = 3000;

type ReaderState =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "failed"; error: string }
  | { kind: "read"; pitchDeg: number | null; headingDeg: number | null; last: (PitchRead & { atMs: number }) | null; heldMs: number };

function usePitchReader(wanted: boolean): ReaderState {
  const cap = useRef<PitchCapture | null>(null);
  const starting = useRef(false);
  const [state, setState] = useState<ReaderState>({ kind: "off" });
  useEffect(() => {
    /*
      Steady (owner, 2026-11-04: the dot "teleports away as soon as the reader has trouble reading the numbers"): a frame
      not read keeps the last good reading; a reading that jumps more than 4 deg of pitch or 6 of heading from the last
      within a second is held until the next one agrees with it (a misread digit, 0 for 8, is one frame, a turn is not);
      a heading not read keeps the last one.
      Held (owner, 2026-11-04: "as soon as it cant read the numbers, the marker gets teleported outside of the screen"):
      the last good pitch stays until the next good one, however long; dropping it after 3 s put the marks on a level
      nose, off the bottom of the screen. Only the heading goes back to Status.json's after 3 s (main.tsx Aim).
    */
    let accepted: (PitchRead & { atMs: number }) | null = null;
    let pending: PitchRead | null = null;
    const turn = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    const jumped = (a: PitchRead, b: PitchRead) =>
      Math.abs(a.pitchDeg - b.pitchDeg) > 4 || (a.headingDeg != null && b.headingDeg != null && turn(a.headingDeg, b.headingDeg) > 6);
    const post = (raw: PitchRead | null) => {
      const now = Date.now();
      let r = raw;
      if (r && accepted && r.headingDeg == null && now - accepted.atMs < 3000) r = { ...r, headingDeg: accepted.headingDeg };
      if (r && accepted && now - accepted.atMs < 1000 && jumped(r, accepted)) {
        const confirmed = pending && !jumped(r, pending);
        pending = confirmed ? null : r;
        if (!confirmed) r = null;
      } else pending = null;
      if (r) accepted = { ...r, atMs: now };
      const heldMs = accepted ? now - accepted.atMs : 0;
      setState({ kind: "read", pitchDeg: accepted?.pitchDeg ?? null, headingDeg: accepted?.headingDeg ?? null, last: accepted, heldMs });
      if (r) {
        const body = { pitchDeg: r.pitchDeg, rollDeg: r.rollDeg };
        void fetch("/api/hud-pitch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
      }
    };
    if (wanted) {
      if (!cap.current && !starting.current) {
        starting.current = true;
        setState({ kind: "starting" });
        void startPitchCapture(post).then((c) => {
          starting.current = false;
          if ("error" in c) setState({ kind: "failed", error: c.error });
          else cap.current = c;
        });
      }
      return;
    }
    const t = setTimeout(() => {
      cap.current?.stop();
      cap.current = null;
      setState({ kind: "off" });
    }, 10_000);
    return () => clearTimeout(t);
  }, [wanted]);
  useEffect(() => () => cap.current?.stop(), []);
  return state;
}

/** The reader's one line, bottom centre: so it shows whether it reads at all (owner, 2026-11-04). */
function ReaderLine({ s, view, colour }: { s: ReaderState; view: View; colour: HudColourSupport }) {
  if (s.kind === "off") return null;
  const text =
    colour === "unsupported" && !(s.kind === "read" && s.pitchDeg != null)
      ? "Pitch reader: these HUD colours cannot be read (launcher › Radar & screen marker › HUD colours)"
      : s.kind === "starting"
      ? "Pitch reader: starting"
      : s.kind === "failed"
        ? `Pitch reader: no screen capture (${s.error})`
        : s.pitchDeg != null
          ? s.heldMs >= HOLD_FRESH_MS
            ? `HUD pitch ${s.pitchDeg.toFixed(1)}° held · not read for ${Math.round(s.heldMs / 1000)} s`
            : `HUD pitch ${s.pitchDeg.toFixed(1)}°${s.headingDeg != null ? ` · heading ${s.headingDeg.toFixed(1)}°` : ""}`
          : "Pitch reader: not read";
  return (
    <text className={"aim-reader" + (s.kind === "read" && s.pitchDeg != null ? " is-ok" : "")} x={view.width / 2} y={view.height * 0.66} textAnchor="middle">
      {text}
    </text>
  );
}

/**
 * The launcher's HUD colours choice applied to the pitch reader's crops (gameScreen setHudRecolour): "xml" undoes
 * GraphicsConfigurationOverride.xml's matrix where it can (hudColourSupport). The distance reader learns the HUD's colour
 * from the screen and needs none. Says what it could not do, for the reader's line.
 */
function useHudLook(look: "default" | "xml", matrix: HudColourMatrix | null, xmlColour: HudColourSupport): HudColourSupport {
  const inverse = look === "xml" && xmlColour === "undo" && matrix ? invertHudMatrix(matrix) : null;
  useEffect(() => {
    setHudRecolour({ pitch: inverse ? (px: Uint8ClampedArray) => recolourRgba(px, inverse) : null });
    // The inverse is rebuilt from these each render; its inputs are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look, matrix, xmlColour]);
  if (look === "xml") return xmlColour === "undo" ? "undo" : xmlColour === "default" ? "default" : "unsupported";
  return "default";
}

/** The game's view, and the XML's HUD colour matrix with whether the readers can undo it. */
function useView(): { view: View; matrix: HudColourMatrix | null; colour: HudColourSupport } {
  const [fov, setFov] = useState<number | null>(null);
  const [colour, setColour] = useState<HudColourSupport>("default");
  const [matrix, setMatrix] = useState<HudColourMatrix | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    void fetch("/api/elite-view")
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { verticalFovDeg?: number | null; hudMatrix?: HudColourMatrix | null; hudColour?: HudColourSupport } | null) => {
        setFov(v?.verticalFovDeg ?? null);
        setMatrix(v?.hudMatrix ?? null);
        setColour(v?.hudColour ?? "default");
      })
      .catch(() => setFov(null));
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return { view: viewOf(size.w, size.h, fov), matrix, colour };
}

function Marker({ s, open }: { s: ScreenMark; open: boolean }) {
  const m = s.mark;
  if (s.edge) {
    // Off the side: an arrow at that edge, at the middle line, with how far to turn.
    const left = s.edge === "left";
    return (
      <g className={"aim-edge" + (m.target ? " is-target" : "")} style={{ transform: `translate(${left ? 24 : s.x - 24}px, ${s.y}px)` }}>
        <polygon points={left ? "-10,0 6,-10 6,10" : "10,0 -6,-10 -6,10"} />
        <text x={left ? 14 : -14} y="5" textAnchor={left ? "start" : "end"}>
          {Math.round(Math.abs(s.turnDeg))}°
        </text>
      </g>
    );
  }
  return (
    <g
      className={"aim-mark" + (m.kind === "sample" ? " is-sample" : "") + (m.target ? " is-target" : "") + (open ? " is-open" : "") + (s.pitched ? "" : " is-level")}
      style={{ transform: `translate(${s.x}px, ${s.y}px)` }}
    >
      {open ? (
        <>
          <polygon className="aim-hex" points={hex(34)} />
          <text className="aim-name" y="-46" textAnchor="middle">
            {m.name ?? m.label}
          </text>
          <text className="aim-sub" y="56" textAnchor="middle">
            {fmtM(m.distanceM)}
            {s.belowDeg != null ? ` · ${Math.round(Math.abs(s.belowDeg))}° ${s.belowDeg >= 0 ? "below" : "above"}` : ""}
            {m.kind === "sample" ? " · sampled" : m.located ? ` · ${HOW[m.located]}` : ""}
          </text>
        </>
      ) : (
        <>
          {m.kind === "sample" ? (
            <polygon className="aim-ring" points="0,-13 13,0 0,13 -13,0" />
          ) : (
            <>
              <circle className="aim-ring" r="16" />
              <circle className="aim-dot" r="3.5" />
            </>
          )}
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
 * where the nose points (open), the next to sample to the right, one scanned-from ahead-left, one behind, and a sample
 * taken.
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
        { kind: "sample", eastM: -90, northM: 260, distanceM: 275, label: "", name: "Stratum Tectonicas - Green", ringM: 100, active: true },
      ],
    }
  : null;

function Aim() {
  const live = useMinimap();
  useGlideTick(live.glide);
  // The launcher's option on, and the server's trigger (the Scan route showing, supercruise, a target here).
  useDistanceReader(!DEMO && live.distance && live.readDistance);
  const map = !MARKS ? null : (DEMO ?? glidedMap(live.glide, Date.now()));
  // Near a planet in the ship (the first scan needs the pitch too, before there is any mark).
  const reader = usePitchReader(MARKS && !DEMO && live.reader && live.glide?.map.altitudeM != null);
  const { view: baseView, matrix, colour: xmlColour } = useView();
  // What the readers can do with the launcher's HUD colours choice (owner 2026-11-06: default, the XML, or EDHM).
  const colour = useHudLook(live.look, matrix, xmlColour);
  // The page's own reading (held when frames go unread) over the server's echo of it (no round trip), and the screen's measured
  // pixels per degree over the one worked out from the settings' field of view.
  const own = reader.kind === "read" && reader.last ? reader.last : null;
  const fresh = !!own && Date.now() - own.atMs < HOLD_FRESH_MS;
  const view =
    own?.pxPerDeg && own.screenH > 0
      ? viewOf(baseView.width, baseView.height, (2 * Math.atan((own.screenH / 2) / ((own.pxPerDeg * 180) / Math.PI)) * 180) / Math.PI)
      : baseView;
  // On-screen heading and pitch while fresh (owner, 2026-11-04: "use only the on-screen data … updated live"); the
  // position stays Status.json's (the screen's latitude has 4 decimals, 16 m here).
  const shown =
    own && map && map.altitudeM != null
      ? { ...map, pitchDeg: own.pitchDeg, rollDeg: own.rollDeg, pitchFromHud: true, ...(fresh && own.headingDeg != null ? { headingDeg: own.headingDeg } : {}) }
      : map;
  // Where the nose points: the HUD's centre the reader found (it sits lower than the screen's centre nose up).
  const origin = own ? { x: own.centre.fx * view.width, y: own.centre.fy * view.height } : null;
  const marks = projectMarks(shown, view, origin);
  const open = openMark(marks, view, origin);
  // The reader's line shows from the first frame near a planet, before any plant is scanned.
  if (!marks.length && reader.kind === "off") return null;
  return (
    <svg className={"aim" + (own && !fresh ? " is-held" : "")} width={view.width} height={view.height} aria-hidden="true">
      {marks.map((s, i) => (
        <Marker key={i} s={s} open={s === open} />
      ))}
      <ReaderLine s={reader} view={view} colour={colour} />
      {map?.clearArmed ? (
        <text className="aim-clear" x={view.width / 2} y={view.height * 0.66 + 24} textAnchor="middle">
          {`Press again to clear ${map.clearArmed} mark${map.clearArmed === 1 ? "" : "s"} on this planet`}
        </text>
      ) : null}
    </svg>
  );
}

createRoot(document.getElementById("aim")!).render(<Aim />);
