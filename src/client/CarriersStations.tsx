/**
 * Carriers & Stations (R4, owner 2026-10-23): three tabs - Carriers (EDAstro), Stations (the station index) and Find
 * Tritium - used by the screen of that name (CarriersModal) and the galaxy map's drawer (`compact`, a picked point
 * and fly-to). The chosen tab is remembered; switching cross-fades (motion.ts).
 */
import { CarriersPanel } from "./CarriersPanel";
import { StationsPanel } from "./StationsPanel";
import { TritiumPanel } from "./TritiumPanel";
import { withTransition } from "./motion";
import { tabListKeyDown } from "./ui/Tabs";
import {
  CARRIERS_STATIONS_TABS as TABS,
  CARRIERS_STATIONS_TITLE,
  type CarriersStationsPick,
  type CarriersStationsTab,
} from "./carriersStationsTab";

type Point = { x: number; y: number; z: number };

export {
  CARRIERS_STATIONS_TITLE,
  useCarriersStationsTab,
  type CarriersStationsPick,
  type CarriersStationsTab,
} from "./carriersStationsTab";

export function CarriersStationsTabs({
  tab,
  setTab,
}: {
  tab: CarriersStationsTab;
  setTab: (t: CarriersStationsTab) => void;
}) {
  return (
    /* The app's keyboard for an option strip (ui/Tabs.tsx, audit 2026-10-22): one Tab stop, arrows choose. */
    <div
      className="fdb-filters"
      role="tablist"
      aria-label={CARRIERS_STATIONS_TITLE}
      onKeyDown={(ev) => tabListKeyDown(ev, { follow: true })}
    >
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={tab === t.key}
          tabIndex={tab === t.key ? 0 : -1}
          className={`fdb-chip${tab === t.key ? " fdb-chip--on" : ""}`}
          onClick={() => withTransition(() => setTab(t.key))}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function CarriersStationsBody({
  tab,
  compact = false,
  from = null,
  onPick,
}: {
  tab: CarriersStationsTab;
  compact?: boolean;
  from?: Point | null;
  onPick?: (p: CarriersStationsPick) => void;
}) {
  if (tab === "stations")
    return (
      <StationsPanel
        compact={compact}
        from={from}
        onPick={
          onPick
            ? (r) => {
                if (r.x != null && r.y != null && r.z != null)
                  onPick({ at: { x: r.x, y: r.y, z: r.z }, kind: "station", stationSys: r.sys });
              }
            : undefined
        }
      />
    );
  if (tab === "tritium")
    return <TritiumPanel compact={compact} from={from} onPick={onPick ? (at) => onPick({ at, kind: "tritium" }) : undefined} />;
  return (
    <CarriersPanel
      compact={compact}
      from={from}
      onPick={
        onPick
          ? (r) => {
              if (r.x != null && r.y != null && r.z != null) onPick({ at: { x: r.x, y: r.y, z: r.z }, kind: "carrier" });
            }
          : undefined
      }
    />
  );
}
