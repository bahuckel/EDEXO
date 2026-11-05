/**
 * The route being flown, at the top of the Neutron and the Spansh drawers alike (review P10, owner 2026-11-05): where
 * it goes, how far along, the next stop, and one Stop. The Spansh drawer's bare "Stop" was always there and could end
 * a Neutron route without saying which.
 */
import { useCallback, useEffect, useState } from "react";
import type { RouteProgressDTO } from "@shared/dto/neutron";
import { liveProgressText } from "@shared/routeProgress";
import { onServerChange } from "../serverChanges";

export interface LiveRouteView {
  at: number;
  total: number;
  next: string | null;
  destination: string;
  replanning: boolean;
  /** Why the re-plot, when it is the fuel aboard and not the ship leaving the route. */
  replanWhy?: string;
  /** A Spansh fleet carrier route: the carrier's jumps move it on, and the stop is pasted in the carrier's route. */
  carrier?: boolean;
  progress?: RouteProgressDTO;
}

export function LiveRouteBanner({ view, onStop }: { view: LiveRouteView; onStop: () => void }) {
  return (
    <div className="g3d-menu__section g3d-menu__section--first" data-testid="g3d-live-route">
      <p className="g3d-panel__note">
        {view.carrier ? "Following your carrier" : "Flying a route"} to <strong>{view.destination}</strong>: {liveProgressText(view)}
        {view.next ? (
          <>
            , next <strong>{view.next}</strong>{" "}
            {view.carrier
              ? "(on the clipboard when your carrier arrives: paste it in the carrier's galaxy map; F6 copies it again)"
              : "(on the clipboard: target it in the galaxy map, don't plot to it; F6 copies it again)"}
          </>
        ) : null}
        .
      </p>
      {view.replanning ? (
        <p className="g3d-panel__note">
          {view.replanWhy ? `${view.replanWhy[0]!.toUpperCase()}${view.replanWhy.slice(1)}` : "Off the route"}: re-plotting from where
          you are…
        </p>
      ) : null}
      <button
        type="button"
        className="btn-top-toggle g3d-neutron-stop"
        title="Ends the route: the HUD, the clipboard line and the line on the map clear"
        onClick={onStop}
      >
        ■ Stop flying this route
      </button>
    </div>
  );
}

/** The route being flown, read on open and whenever the server says it changed; `refresh` after flying or stopping. */
export function useLiveRoute(): { view: LiveRouteView | null; refresh: () => void } {
  const [view, setView] = useState<LiveRouteView | null>(null);
  const refresh = useCallback(() => {
    void fetch("/api/neutron/live")
      .then((r) => (r.ok ? (r.json() as Promise<{ active?: boolean; view?: LiveRouteView | null }>) : null))
      .then((j) => j && setView(j.active && j.view ? j.view : null))
      .catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => onServerChange("neutron-live", refresh), [refresh]);
  return { view, refresh };
}
