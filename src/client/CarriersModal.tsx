/**
 * Carriers & Stations (R4, owner 2026-10-23; "Carriers" before): fleet carriers from EDAstro, stations from the
 * station index, and Find Tritium, as three tabs (CarriersStations.tsx). The galaxy map has the same tabs as a drawer.
 * Each list is empty until asked; once fetched, the server keeps it current (dataAutoRefresh.ts).
 */
import { withTransition } from "./motion";
import { useModal } from "./ui/useModal";
import {
  CARRIERS_STATIONS_TITLE,
  CarriersStationsBody,
  CarriersStationsTabs,
  useCarriersStationsTab,
} from "./CarriersStations";

export function CarriersModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const [tab, setTab] = useCarriersStationsTab();
  return (
    <div className="modal-backdrop" role="presentation" onClick={() => withTransition(onClose)}>
      <div
        ref={dialogRef}
        className="modal-panel fdb-panel"
        role="dialog"
        aria-modal="true"
        aria-label={CARRIERS_STATIONS_TITLE}
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="fdb-head">
          <div>
            <h2 className="fdb-title">{CARRIERS_STATIONS_TITLE}</h2>
            <CarriersStationsTabs tab={tab} setTab={setTab} />
            <p className="dim fdb-sub" hidden={tab !== "carriers"}>
              Fleet carriers near you, from{" "}
              <a className="carriers-source-link" href="https://edastro.com" target="_blank" rel="noreferrer">
                EDAstro
              </a>
              . Positions are <strong>last sightings</strong>, not live — a carrier is only reported when
              someone aboard it is running a journal uploader.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={() => withTransition(onClose)} aria-label="Close">
            ×
          </button>
        </header>
        <CarriersStationsBody tab={tab} />
      </div>
    </div>
  );
}
