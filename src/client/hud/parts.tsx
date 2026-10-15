/*
  Pieces several HUD sections share: the section header, the counting metres readout, the OK / LOW pill, the
  fuel pump glyph.
*/
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { HudSnapshot } from "./types";
import { COUNT_MS, COUNT_SNAP_M, fmtM, type SectionState } from "./core";

/** A HUD section: its title, its content, and what the panel needs to know about it. */
export interface HudSection {
  title: string;
  /** "Only when relevant": whether it has something to say now (no rule: it always stays). */
  relevant?: (d: HudSnapshot) => boolean;
  /** The frame colour: green (ok) or amber (warn). */
  state?: (d: HudSnapshot) => SectionState;
  /** The content for a snapshot. A function, not a component, so a test can count the calls. */
  render: (d: HudSnapshot) => ReactNode;
  /** Before the first snapshot (else `render({})`): what the page shows while it waits. */
  initial?: () => ReactNode;
  /** Drawn again every second (clocks, notices leaving). */
  ticks?: boolean;
  /** Drawn again on each radar frame. */
  live?: boolean;
}

export function Head({ title, status }: { title: string; status: ReactNode }) {
  return (
    <div className="hud-head">
      <span className="hud-title">{title}</span>
      <span className="hud-status" data-f="status">
        {status}
      </span>
    </div>
  );
}

export function Pill({ ok }: { ok: boolean | null | undefined }) {
  if (ok === true)
    return (
      <>
        {" "}
        <span className="pill ok" aria-hidden="true">
          OK
        </span>
      </>
    );
  if (ok === false)
    return (
      <>
        {" "}
        <span className="pill bad" aria-hidden="true">
          LOW
        </span>
      </>
    );
  return null;
}

export function FuelPump({ level }: { level: string }) {
  return (
    <svg className={`hop__fuel hop__fuel--${level}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M4 20h12M7 7h6v4H7zM15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0v-7l-2.5-2.5" />
    </svg>
  );
}

/*
  The metres readout counts rather than steps.

  The radar itself is drawn exactly where each fix says — that is the owner's call and it is about *position*,
  where inventing a value between two real ones means drawing him somewhere he was not. A number has no such
  problem: nobody reads 312 m as a claim about a specific instant, they read it as "about three hundred and
  closing", and a figure that lurches in eight-metre jumps is harder to read than one that runs.

  Short and linear (COUNT_MS), far shorter than the gap between fixes. A big change snaps (COUNT_SNAP_M):
  switching body, or a row going from "—" to a distance, is not movement. The text is written straight to the
  element in a layout effect, as setMetres did, so the count runs between React renders and a test reading the
  element right after a render sees the figure.
*/
export function Metres({
  value,
  field,
  className,
}: {
  value: number | null | undefined;
  field: string;
  className?: string;
}) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const raf = useRef(0);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
    if (value == null || !isFinite(value)) {
      shown.current = null;
      node.textContent = "—";
      return;
    }
    const from = shown.current;
    if (from == null || Math.abs(value - from) > COUNT_SNAP_M) {
      shown.current = value;
      node.textContent = fmtM(value);
      return;
    }
    const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
    const t0 = now();
    const step = () => {
      raf.current = 0;
      if (!node.isConnected) return;
      const t = Math.min(1, (now() - t0) / COUNT_MS);
      const v = from + (value - from) * t;
      shown.current = t >= 1 ? value : v;
      node.textContent = fmtM(shown.current);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    step();
  }, [value]);
  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );
  return <span className={className} data-f={field} ref={el} />;
}
