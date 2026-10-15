import type { HudSnapshot } from "../types";
import { fmtCr } from "../core";
import { Head, type HudSection } from "../parts";

/* ============================================================== Data value ================== */
function DataValue({ d }: { d: HudSnapshot }) {
  const org = d.organicDataValueCredits != null ? d.organicDataValueCredits : 0;
  const scanOn = d.includeExplorationScanDataInDataValue === true;
  const scanCr = d.explorationScanDataValueCredits != null ? d.explorationScanDataValueCredits : 0;
  const pend = (d.organicPendingSampleCount ?? 0) > 0 ? d.organicPendingSampleCount! : 0;
  return (
    <>
      <Head title="Data value" status={pend ? pend + " pending sample" + (pend === 1 ? "" : "s") : "Unsold"} />
      <div className="row">
        <span className="k">Organic</span>
        <span className="v" data-f="org">
          {fmtCr(org)}
        </span>
      </div>
      <div className="row">
        <span className="k">Exploration scans</span>
        <span className={"v" + (scanOn ? "" : " off")} data-f="scan">
          {scanOn ? fmtCr(scanCr) : "off"}
        </span>
      </div>
      <div className="row row--rule row--total">
        <span className="k">Total</span>
        <span className="v" data-f="tot">
          {fmtCr(org + (scanOn ? scanCr : 0))}
        </span>
      </div>
      <p className="hud-note hud-explain" data-f="hint">
        {scanOn
          ? "Total = organic + merged FSS/DSS scan estimate (same ⊕ toggle as the main UI)."
          : "Total = organic only. Enable ⊕ scan data in the main UI to add exploration CR."}
      </p>
    </>
  );
}

export const datavalue: HudSection = {
  title: "Data value",
  initial: () => (
    <>
      <Head title="Data value" status="Unsold" />
      <div className="row">
        <span className="k">Organic</span>
        <span className="v" data-f="org">
          —
        </span>
      </div>
      <div className="row">
        <span className="k">Exploration scans</span>
        <span className="v" data-f="scan">
          —
        </span>
      </div>
      <div className="row row--rule row--total">
        <span className="k">Total</span>
        <span className="v" data-f="tot">
          —
        </span>
      </div>
      <p className="hud-note hud-explain" data-f="hint">
        Loading…
      </p>
    </>
  ),
  render: (d) => <DataValue d={d} />,
};
