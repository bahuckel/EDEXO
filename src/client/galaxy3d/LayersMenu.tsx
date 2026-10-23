/**
 * The Layers drawer: the map's own layers, the extra ones, the plotted route's unvisited systems and the
 * Waiting floor. Moved out of GalaxyMap3D.tsx (audit 2026-10-22).
 */
import { GALAXY_LAYERS, type GalaxyLayerDTO, type GalaxyLayerKind } from "@shared/galaxyLayers.js";
import { G3D_HELP, MenuHead, MenuRow, MenuToggle } from "./G3dMenu";
import { WAIT_MAX_M } from "./mapConstants";

type MapLayerKey = "you" | "photo" | "borders" | "groups" | "labels";

export function LayersMenu({
  layers,
  toggle,
  extraData,
  extraOn,
  extraSet,
  navUnvisitedOn,
  setNavUnvisitedOn,
  waitMinM,
  setWaitMinM,
}: {
  layers: Record<MapLayerKey, boolean>;
  toggle: (k: MapLayerKey) => void;
  extraData: Partial<Record<GalaxyLayerKind, GalaxyLayerDTO>>;
  extraOn: Record<GalaxyLayerKind, boolean>;
  extraSet: Record<GalaxyLayerKind, (v: boolean) => void>;
  navUnvisitedOn: boolean;
  setNavUnvisitedOn: (v: boolean) => void;
  waitMinM: number;
  setWaitMinM: (v: number) => void;
}) {
  return (
    <aside className="g3d-drawer g3d-menu" aria-label="Layers" data-testid="g3d-layers">
      <MenuHead title="Layers" help={G3D_HELP.layers} />
      <div className="g3d-menu__rows" role="group" aria-label="Layers">
        {(["you", "photo", "borders", "groups", "labels"] as const).map((k) => (
          <label key={k} className="g3d-row g3d-row--check">
            <input
              type="checkbox"
              className="g3d-row__box"
              checked={layers[k]}
              onChange={() => toggle(k)}
            />
            <span className="g3d-row__label">
              {
                {
                  you: "Your systems",
                  photo: "Milky Way",
                  borders: "Region borders",
                  groups: "Groups",
                  labels: "Names",
                }[k]
              }
            </span>
            <span className="g3d-row__val">{layers[k] ? "On" : "Off"}</span>
          </label>
        ))}
        {GALAXY_LAYERS.map((l) => {
          const d = extraData[l.kind];
          const missing = d != null && !d.available;
          return (
            <label key={l.kind} className="g3d-row g3d-row--check" title={missing ? l.needs : undefined}>
              <input
                type="checkbox"
                className="g3d-row__box"
                checked={extraOn[l.kind]}
                onChange={() => extraSet[l.kind](!extraOn[l.kind])}
              />
              <span
                className="g3d-swatch"
                style={{ background: `rgb(${l.colour.map((c) => Math.round(c * 255)).join(",")})` }}
              />
              <span className="g3d-row__label">
                {l.label}
                {extraOn[l.kind] && d ? (
                  <span className="dim">
                    {" "}
                    {missing ? `— ${l.needs.toLowerCase()}` : `(${d.points.length.toLocaleString()})`}
                  </span>
                ) : null}
              </span>
              <span className="g3d-row__val">{extraOn[l.kind] ? (d ? "On" : "Loading…") : "Off"}</span>
            </label>
          );
        })}
      </div>
      <MenuToggle
        label="NavRoute – unvisited"
        hint="The systems on the route you plotted in the game that you have not been to, placed from NavRoute.json"
        on={navUnvisitedOn}
        set={setNavUnvisitedOn}
      />
      {layers.you ? (
        <MenuRow
          label="Waiting worth ≥"
          hint="Your systems still waiting (signals not yet sampled), worth at least this much"
        >
          <input
            type="range"
            className="g3d-row__range"
            min={0}
            max={WAIT_MAX_M}
            step={1}
            value={waitMinM}
            aria-label="Waiting worth at least (million CR)"
            onChange={(ev) => setWaitMinM(Number(ev.target.value))}
          />
          <span className="g3d-slider-val g3d-slider-val--short">
            {waitMinM ? `${waitMinM}M` : "any"}
          </span>
        </MenuRow>
      ) : null}
    </aside>
  );
}
