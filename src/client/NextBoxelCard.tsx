/**
 * "Next boxel" in the header row (plan 2.7, 2026-10-11): the best boxel within 500 ly of the ship by
 * first-footfall credits per jump, from the expedition planner. Asked again on every jump; `light=1`, so it
 * uses the galaxy index only when the map has it in memory already, and never loads it for a header line.
 * Click: the galaxy map opens on it, Expedition drawer open.
 */
import { useEffect, useState } from "react";
import type { ExpeditionBoxelDTO, ExpeditionFieldDTO } from "@shared/dto/expedition";
import { fmtLy } from "@shared/format";
import { tabStore } from "./tabs/tabStore";
import { Tooltip } from "./ui/Tooltip";
import { crShort, requestExpeditionFocus } from "./ExpeditionDrawer";
import { useNextBoxelInHeader } from "./nextBoxelSetting";

export const NEXT_BOXEL_RADIUS_LY = 500;

export function NextBoxelCard({ systemAddress }: { systemAddress: number | null }) {
  // Switched on or off in the Boxels screen; off asks the server nothing.
  const [on] = useNextBoxelInHeader();
  const [b, setB] = useState<ExpeditionBoxelDTO | null>(null);
  useEffect(() => {
    if (systemAddress == null || !on) return;
    const ac = new AbortController();
    void fetch(`/api/expedition/field?radius=${NEXT_BOXEL_RADIUS_LY}&limit=1&light=1`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ExpeditionFieldDTO | null) => {
        if (!ac.signal.aborted) setB(j?.boxels[0] ?? null);
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, [systemAddress, on]);
  if (!b || !on) return null;
  const name = b.name ?? `${b.code} boxel`;
  return (
    <Tooltip
      text={`The boxel within ${NEXT_BOXEL_RADIUS_LY} ly likely to pay most in first footfalls per jump: ${crShort(b.ev)} CR expected over about ${b.systems} systems, ${b.jumps} jumps to fly it. Click to see it on the galaxy map.`}
    >
      <button
        type="button"
        className="d-scan-card d-scan-card--header-row header-route-mini header-next-boxel"
        data-testid="header-next-boxel"
        onClick={() => {
          requestExpeditionFocus(b);
          tabStore.open("galaxy");
        }}
      >
        <span className="header-route-line header-route-line--compact">
          <span className="header-metric-card-label">Next boxel:</span>{" "}
          <span className="header-metric-card-value">
            {name} <span className="dim">· {fmtLy(b.distanceLy)} · {crShort(b.evPerJump)}/jump</span>
          </span>
        </span>
      </button>
    </Tooltip>
  );
}
