import type { HudSnapshot } from "../types";
import { Head, type HudSection } from "../parts";

/* ============================================================== Discovery scan (FSS honk) ==== */
function complete(d: HudSnapshot): boolean {
  const s = d.dScanBodies;
  if (!s || s.total == null) return false;
  // No honk: the total is only what was scanned by hand, so found = total proves nothing.
  const honked = s.honked !== false;
  return !!(s.complete || (honked && s.found >= s.total));
}

function Fss({ d }: { d: HudSnapshot }) {
  const dscan = d.dScanBodies;
  if (!dscan || dscan.total == null) {
    return (
      <>
        <Head title="Discovery scan" status="Standby" />
        <div className="fss-line" data-f="dline">
          <span className="sys">—</span>
          <span className="nums">
            — / —<small>bodies</small>
          </span>
        </div>
        <Bar width="0%" />
        <Explain />
      </>
    );
  }
  const honked = dscan.honked !== false;
  const done = complete(d);
  const sys = dscan.systemName || "—";
  const pct = dscan.total > 0 ? Math.max(0, Math.min(100, (dscan.found / dscan.total) * 100)) : 0;
  return (
    <>
      <Head title="Discovery scan" status={done ? "Complete" : "Scanning " + Math.round(pct) + "%"} />
      <div className="fss-line" data-f="dline">
        <span className="sys" title={sys}>
          {sys}
        </span>
        <span className="nums">
          {`${dscan.found} / ${dscan.total}`}
          <small>bodies</small>
        </span>
        <span className={"honk" + (honked ? "" : " honk--no")}>Honk: {honked ? "Yes" : "No"}</span>
      </div>
      <Bar width={pct.toFixed(1) + "%"} />
      <Explain />
    </>
  );
}

function Bar({ width }: { width?: string }) {
  return (
    <div className="hud-bar" aria-hidden="true">
      <div className="hud-bar__fill" data-f="bar" style={width ? { width } : undefined} />
      <div className="hud-bar__ticks" />
    </div>
  );
}

function Explain() {
  return (
    <div className="hud-note hud-explain">Honk progress against bodies found, same as the main D-Scan readout.</div>
  );
}

// Before the first snapshot: no width on the bar, as the page's markup had (its first frame grows it from there).
function Waiting() {
  return (
    <>
      <Head title="Discovery scan" status="Standby" />
      <div className="fss-line" data-f="dline">
        <span className="sys">—</span>
        <span className="nums">
          — / —<small>bodies</small>
        </span>
      </div>
      <Bar />
      <Explain />
    </>
  );
}

export const fss: HudSection = {
  initial: () => <Waiting />,
  /* "Only when relevant": the system still has bodies to find. */
  relevant: (d) => {
    const s = d.dScanBodies;
    if (!s || s.total == null) return false;
    return !complete(d);
  },
  title: "Discovery scan",
  state: (d) => (complete(d) ? "ok" : null),
  render: (d) => <Fss d={d} />,
};
