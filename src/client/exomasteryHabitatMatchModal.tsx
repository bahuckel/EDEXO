import type { ExomasteryDetailDTO, ExomasteryVarietyItemDTO } from "@shared/types";

import { useState } from "react";
import { createPortal } from "react-dom";

import { ExomasteryHabitatDetailInner } from "./exomasteryHabitatDetailInner";
import { useToast } from "./ui/feedback";
import { ModalHead } from "./ui/ModalHead";
import { useModal } from "./ui/useModal";

export function ExomasteryHabitatMatchModal({
  detail,
  varietyHints,
  exportBasename,
  genusDataDir = "",
  comparisonBodySummary,
  onClose,
  title,
  variant = "profile",
}: {
  detail: ExomasteryDetailDTO;
  varietyHints: ExomasteryVarietyItemDTO[] | null | undefined;
  exportBasename: string | null | undefined;
  genusDataDir?: string;
  comparisonBodySummary: string;
  onClose: () => void;
  title: string;
  variant?: "profile" | "journal";
}) {
  const toast = useToast();
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const [forceBusy, setForceBusy] = useState(false);

  const forceReloadExomastery = async () => {
    setForceBusy(true);
    try {
      const r = await fetch("/api/exomastery/reload", { method: "POST" });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(j?.error || r.statusText);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reload exomastery data.");
    } finally {
      setForceBusy(false);
    }
  };

  const exportHref =
    variant === "profile" && exportBasename && genusDataDir
      ? `/api/exomastery-feeder-json/${encodeURIComponent(genusDataDir)}/${encodeURIComponent(exportBasename)}`
      : null;

  return createPortal(
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel exomastery-detail-modal exomastery-habitat-match-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exomastery-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHead
          title={title}
          titleId="exomastery-detail-title"
          onClose={onClose}
          helpTitle={variant === "journal" ? "What this scan detail shows" : "What the habitat match shows"}
          help={<HabitatMatchHelp variant={variant} />}
        />

        <div className="exomastery-habitat-body encyclopedia-exomastery-body">
          <ExomasteryHabitatDetailInner
            detail={detail}
            variant={variant}
            comparisonBodySummary={comparisonBodySummary}
            showComparisonBodyLine={variant !== "journal"}
          />

          {variant === "profile" && varietyHints && varietyHints.length > 0 ? (
            <section className="encyclopedia-exomastery-section exomastery-variety-section habitat-variety-in-modal">
              <h5 className="encyclopedia-exomastery-section-title">Spawn consistency in profile</h5>
              <div className="exo-variety-list">
                {varietyHints.map((h) => (
                  <div key={h.id} className="exo-variety-row">
                    <div className="exo-variety-label">{h.label}</div>
                    <div className="exo-variety-bar-track">
                      <div
                        className="exo-variety-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(0, h.concentrationPercent))}%`,
                        }}
                      />
                    </div>
                    <div className="exo-variety-pct">{h.concentrationPercent}%</div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="exomastery-detail-footer">
            {exportHref ? (
              <a className="exomastery-download-link" href={exportHref} download>
                Download exomastery JSON (feeder profile)
              </a>
            ) : null}
            <div>
              <button
                type="button"
                className="exomastery-force-recompare-btn"
                disabled={forceBusy}
                onClick={() => void forceReloadExomastery()}
                title="Re-read feeder JSON from disk and rebuild merged journal comparison (same as server exomastery reload)."
              >
                {forceBusy ? "Re-comparing…" : "Force re-compare (reload profiles + journal merge)"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Behind the "?" beside the × (owner, 2026-10-23). */
function HabitatMatchHelp({ variant }: { variant: "profile" | "journal" }) {
  const reload = (
    <p>
      <strong>Force re-compare</strong> re-reads the feeder profiles from disk and rebuilds the merge with your
      journal, for when the data changed while the app was open.
    </p>
  );
  if (variant === "journal") {
    return (
      <>
        <p>
          The fields of this body's scan as merged from your journal (FSS and DSS): climate, atmosphere gases,
          crust, the body itself, its surface and its orbit. Nothing is compared here; it is the body's own data,
          with no species profile beside it.
        </p>
        <p>A field showing — was not in the scans your journal holds for this body.</p>
        {reload}
      </>
    );
  }
  return (
    <>
      <p>
        How this body sits against the species' exomastery profile, field by field. Each tile shows the profile's
        most common value (the mode) above this body's own value from your journal scans; the colour says how far
        apart they are.
      </p>
      <p>
        The profile is built by the data feeder from EDSM sample data: the bodies the species has been found on.
        Click a typical value to see its spread (min to max, with the peak; dashed is this body when it is in
        range). Spawn consistency, where shown, is how tightly the profile's bodies cluster on one value, field by
        field.
      </p>
      <p>
        <strong>Download exomastery JSON</strong> saves the species' feeder profile file.
      </p>
      {reload}
    </>
  );
}
