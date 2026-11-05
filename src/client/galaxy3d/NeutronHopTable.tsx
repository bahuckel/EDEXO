/**
 * The Neutron drawer's one table of hops (review P8, owner 2026-11-05: one table for a plan and for the route being
 * flown, where there were two that had drifted apart). A plan made in the drawer lists every hop, the next one marked
 * once it is flown; a route started elsewhere (the Spansh drawer, a restart, a re-plot in flight) lists the stops ahead
 * (owner, 2026-11-05: a guild mate's route was on the map and the clipboard, and the drawer listed none of its jumps),
 * with the fuel and the FSD's health the plan expects where it has them (EDEXO's plans; Spansh's routes have neither).
 */
import type { ReactNode } from "react";
import { FlaskConical, Fuel, Zap } from "lucide-react";
import { fmtLy } from "@shared/format";
import { CopySystemButton } from "../CopySystemButton";
import type { NeutronMark } from "./neutronMarks";

/** A hop of a plan or of the live route (server/neutronLive.ts LiveHop). */
export type LiveStop = NeutronMark & {
  scoopLs?: number | null;
  scoopOnWay?: boolean;
  inject?: { tier: "basic" | "standard" | "premium"; count: number } | null;
  jumpsLeft?: number;
  fsdHealth?: number | null;
  /** A plan's: the light years from the hop before (else worked out from the positions). */
  distanceLy?: number;
  address?: number;
};

type Pt = { x: number; y: number; z: number };

const TIER: Record<string, string> = { basic: "Basic", standard: "Standard", premium: "Premium" };

export function NeutronHopTable<H extends LiveStop>({
  hops,
  from = 0,
  next = null,
  onFocus,
  fsdWarn = 0.8,
  worth,
  reach,
}: {
  hops: H[];
  /** The first hop listed: 0 for a whole plan, the one after the stop reached for the stops ahead. */
  from?: number;
  /** The hop flown to next, marked; null when nothing is flown. */
  next?: number | null;
  onFocus: (p: Pt) => void;
  fsdWarn?: number;
  /** A line under the system: what the stop is worth (a plan's, from Spansh). */
  worth?: (h: H) => ReactNode;
  /** More for a supercharged jump's title: how far the ship reaches there. */
  reach?: (h: H) => string;
}) {
  const rows = hops.slice(from);
  const fuel = rows.some((h) => h.jumpsLeft != null);
  const fsd = rows.some((h) => h.fsdHealth != null);
  return (
    <table className="fdb-table g3d-neutron-table">
      <thead>
        <tr>
          <th>#</th>
          <th>System</th>
          <th>Jumps</th>
          {fuel ? <th title="Jumps of fuel the plan expects on arrival">Fuel</th> : null}
          {fsd ? <th>FSD</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((h, k) => {
          const i = from + k;
          const prev = hops[i - 1];
          const ly = h.distanceLy ?? (prev ? Math.hypot(h.x - prev.x, h.y - prev.y, h.z - prev.z) : 0);
          const isNext = i === next;
          const cls = [h.kind === "waypoint" ? "is-waypoint" : "", isNext ? "is-next" : ""].filter(Boolean).join(" ");
          const more = reach ? ` ${reach(h)}` : "";
          const w = worth?.(h);
          return (
            <tr key={`${h.name}-${i}`} className={cls || undefined}>
              <td>{i}</td>
              <td>
                <button type="button" className="g3d-linkbtn" onClick={() => onFocus(h)}>
                  {h.name}
                </button>{" "}
                <CopySystemButton system={h.name} />
                {isNext ? <span className="dim"> · next</span> : null}
                {w ? <small className="g3d-neutron-worth">{w}</small> : null}
                {h.refuel ? (
                  <span
                    className="g3d-neutron-fuel"
                    title={
                      h.refuelHalf
                        ? "Scoop the system's own star to half a tank before supercharging: the lighter ship reaches the next stops, a full tank would not"
                        : "Scoop the system's own star before supercharging"
                    }
                  >
                    {" "}
                    <Fuel className="g3d-neutron-ico" aria-hidden="true" /> {h.refuelHalf ? "scoop to half" : "scoop"}
                    {h.scoopLs != null ? ` (${h.scoopLs.toLocaleString("en-US")} ls)` : ""}
                  </span>
                ) : null}
                {h.scoopOnWay ? (
                  <span className="g3d-neutron-fuel" title="More normal jumps than the tank holds: scoop a K G B F O A M star on the way">
                    {" "}
                    <Fuel className="g3d-neutron-ico" aria-hidden="true" /> on the way
                  </span>
                ) : null}
              </td>
              <td>
                {/* Past a supercharge's reach: the supercharged jump, then the game's own plot (a tester read "905 ly"
                    as one jump, 2026-10-28). */}
                {h.boosted ? (
                  <span
                    title={
                      h.jumps > 1
                        ? `One supercharged jump, then ${h.jumps - 1} normal jump${h.jumps === 2 ? "" : "s"}: plot the system in the game's galaxy map after supercharging.${more}`
                        : `One supercharged jump.${more}`
                    }
                  >
                    <Zap className="g3d-neutron-ico" aria-label="Supercharged" />
                    {h.jumps > 1 ? ` + ${h.jumps - 1}` : ""}
                  </span>
                ) : h.jumps ? (
                  String(h.jumps)
                ) : (
                  ""
                )}
                {h.inject ? (
                  <span
                    className="g3d-neutron-inject"
                    title={`${h.inject.count} ${TIER[h.inject.tier]} FSD injection${h.inject.count > 1 ? "s" : ""}, one per normal jump: one jump fewer`}
                  >
                    {" "}
                    <FlaskConical className="g3d-neutron-ico" aria-hidden="true" /> {h.inject.count} {TIER[h.inject.tier]}
                  </span>
                ) : null}{" "}
                <span className="dim">{ly ? fmtLy(ly) : ""}</span>
              </td>
              {fuel ? <td>{h.jumpsLeft ?? ""}</td> : null}
              {fsd ? (
                <td className={h.fsdHealth != null && h.fsdHealth < fsdWarn ? "is-warn" : undefined}>
                  {h.fsdHealth != null ? `${Math.round(h.fsdHealth * 100)} %` : ""}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The stops ahead on the route being flown, when it is not the plan in the drawer's table. */
export function NeutronLiveStops({ hops, at, onFocus, fsdWarn }: { hops: LiveStop[]; at: number; onFocus: (p: Pt) => void; fsdWarn?: number }) {
  const ahead = hops.length - 1 - at;
  if (ahead <= 0) return null;
  return (
    <div className="g3d-menu__section" data-testid="g3d-neutron-live">
      <p className="g3d-panel__note">
        <strong>{ahead}</strong> stop{ahead === 1 ? "" : "s"} ahead of {hops.length - 1} on the route being flown
      </p>
      <NeutronHopTable hops={hops} from={at + 1} next={at + 1} onFocus={onFocus} fsdWarn={fsdWarn} />
    </div>
  );
}
