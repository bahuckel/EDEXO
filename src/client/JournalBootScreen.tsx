import { useEffect, useState } from "react";
import type { JournalBootProgressDTO } from "@shared/types";
import { fxOn, withTransition } from "./motion";

/** M6: the circle (280 ms), then the tick (190 ms). */
const TICK_MS = 470;
/** The tick stays this long once drawn, then the app fades in. */
const TICK_HOLD_MS = 380;

/**
 * M6 Success tick (owner 2026-11-05): when the journal has loaded, the boot screen stays a moment longer and draws a
 * circle, then a tick, before the app fades in (Options › Look › Motion › Loaded tick, level Full). Returns the boot
 * screen to show: still loading, just loaded (`done`), or none.
 */
export function useBootTick(boot: JournalBootProgressDTO | null | undefined): { boot: JournalBootProgressDTO; done: boolean } | null {
  const [last, setLast] = useState(boot ?? null);
  const [booting, setBooting] = useState(!!boot);
  const [held, setHeld] = useState<JournalBootProgressDTO | null>(null);
  if (boot && boot !== last) setLast(boot);
  if (!!boot !== booting) {
    setBooting(!!boot);
    if (!boot && last && fxOn("tick")) setHeld(last);
  }
  useEffect(() => {
    if (!held) return;
    const t = window.setTimeout(() => withTransition(() => setHeld(null)), TICK_MS + TICK_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [held]);
  if (boot) return { boot, done: false };
  return held ? { boot: held, done: true } : null;
}

export function JournalBootScreen({
  boot,
  connected,
  done = false,
}: {
  boot: JournalBootProgressDTO;
  connected: boolean;
  /** Loaded: the orb becomes the circle and the tick (useBootTick). */
  done?: boolean;
}) {
  const pct = done ? 100 : Math.max(0, Math.min(100, boot.percent));
  const detail = boot.filesTotal > 0 ? `${done ? boot.filesTotal : boot.filesDone} / ${boot.filesTotal} journal logs` : null;

  return (
    <div className="journal-boot">
      <div className="journal-boot__glow" aria-hidden />
      <div className="journal-boot__panel">
        <div className="journal-boot__header">
          {done ? (
            <svg className="journal-boot__tick" viewBox="0 0 56 56" aria-hidden>
              <circle className="journal-boot__tick-circle" cx="28" cy="28" r="25" pathLength={1} />
              <path className="journal-boot__tick-mark" d="M17 29.5 L24.5 37 L39.5 20.5" pathLength={1} />
            </svg>
          ) : (
            <div className="journal-boot__orb" aria-hidden>
              <span className="journal-boot__orb-ring" />
              <span className="journal-boot__orb-core" />
            </div>
          )}
          <h1 className="journal-boot__title">EDEXO</h1>
          <p className="journal-boot__subtitle" role={done ? "status" : undefined}>
            {done ? "Journal data loaded" : "Loading journal data"}
          </p>
        </div>

        <div
          className="journal-boot__meter"
          // A progress bar needs a name to be read out (axe aria-progressbar-name, audit 2026-10-22).
          aria-label="Loading journal data"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          role="progressbar"
        >
          <div className="journal-boot__meter-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="journal-boot__pct-row">
          <span className="journal-boot__pct">{pct}%</span>
          <span className={`journal-boot__link ${connected ? "journal-boot__link--live" : ""}`}>
            {connected ? "Live updates" : "Connecting…"}
          </span>
        </div>

        <p className="journal-boot__message">{done ? "Opening EDEXO…" : boot.message}</p>
        {detail ? <p className="journal-boot__detail">{detail}</p> : null}
      </div>
    </div>
  );
}
