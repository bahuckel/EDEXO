/**
 * The Codex drawer: biology or bodies, the gaps in a region, and every region's logged count. Moved out
 * of GalaxyMap3D.tsx (audit 2026-10-22).
 */
import type { CodexMapKind, CodexMapRegionSummaryDTO, CodexMapRegionsDTO, CodexMapSystemDTO } from "@shared/dto/codexMap.js";
import { regionJoinKey } from "@shared/regionMap.js";
import type { GalaxyRouteDTO } from "@shared/types";
import { CodexGapsList } from "../CodexGapsList";
import type { GalaxyEngine } from "./GalaxyEngine";
import { G3D_HELP, MenuHead } from "./G3dMenu";

export function CodexMenu({
  engine,
  route,
  codexKind,
  setCodexKind,
  codexRegion,
  setCodexRegion,
  codexRegions,
  codexSummary,
  codexSystems,
}: {
  /** Read when the drawer draws, as before: where the gaps list measures from without a route. */
  engine: { current: GalaxyEngine | null };
  route: GalaxyRouteDTO | null;
  codexKind: CodexMapKind;
  setCodexKind: (k: CodexMapKind) => void;
  codexRegion: string | null;
  setCodexRegion: (name: string) => void;
  codexRegions: CodexMapRegionsDTO | null;
  codexSummary: CodexMapRegionSummaryDTO | undefined;
  codexSystems: Map<string, CodexMapSystemDTO>;
}) {
  return (
    <aside className="g3d-drawer g3d-menu g3d-codex" aria-label="Codex" data-testid="g3d-codex">
      <MenuHead title="Codex" help={G3D_HELP.codex} />
      <div className="g3d-row g3d-row--buttons" role="group" aria-label="Codex kind">
        {(["bio", "bodies"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={codexKind === k ? "g3d-btn g3d-btn--on" : "g3d-btn"}
            aria-pressed={codexKind === k}
            onClick={() => setCodexKind(k)}
          >
            {k === "bio" ? "Biology" : "Bodies"}
          </button>
        ))}
      </div>
      {codexKind === "bio" && codexRegion ? (
        <CodexGapsList
          region={codexSummary?.name ?? codexRegion}
          from={route?.position ?? engine.current?.getShip() ?? null}
          onPick={(site) => {
            // Codex mode draws its systems flat (y 0); a listed one is selected so its record opens.
            const at = { x: site.x, y: 0, z: site.z };
            engine.current?.flyTo(at, 300);
            if (codexSystems.has(site.systemAddress))
              engine.current?.select({ kind: "marker", layer: "codex", id: site.systemAddress, ...at });
          }}
        />
      ) : null}
      <p className="g3d-menu__sub">Regions — logged of known · click one here or on the map</p>
      {codexRegions ? null : <p className="g3d-panel__note">Reading your codex…</p>}
      <ul className="g3d-menu__rows g3d-codex__regions">
        {(codexRegions?.regions ?? [])
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((r) => {
            const k = r.kinds[codexKind];
            const on = codexRegion != null && r.joinKey === regionJoinKey(codexRegion);
            return (
              <li key={r.joinKey}>
                <button
                  type="button"
                  className={on ? "g3d-row g3d-row--pick g3d-row--on" : "g3d-row g3d-row--pick"}
                  aria-pressed={on}
                  onClick={() => setCodexRegion(r.name)}
                >
                  <span className="g3d-row__label">{r.name}</span>
                  <span className="g3d-row__val g3d-num">
                    {k.logged}/{k.entries}
                  </span>
                </button>
              </li>
            );
          })}
      </ul>
      {codexRegions ? <p className="g3d-panel__note">{codexRegions.source}</p> : null}
    </aside>
  );
}
