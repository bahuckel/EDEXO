/**
 * The galaxy map's Find box (plan 7.3, moved out of GalaxyMap3D.tsx unchanged): the field and its list of
 * regions, sectors, systems, stations, layer points and Spansh answers. The searches themselves stay in the
 * map, which owns the state; this only draws them and says where a pick goes.
 */
import type { Dispatch, SetStateAction } from "react";
import type { Selection } from "./GalaxyEngine";
import { formatCount } from "./clusters";
import type { SpanshFindHit } from "./mapConstants";
import type { RegionOutlines } from "@shared/regionBorders.js";
import type { GalaxyFindDTO } from "@shared/types";
import type { GalaxyLayerKind } from "@shared/galaxyLayers.js";

/** A layer's own point the Find text matched (a green gas giant, a POI, an NSP ...). */
export type FindLayerHit = {
  kind: GalaxyLayerKind;
  id: string;
  label: string;
  system: string;
  what: string;
  x: number;
  y: number;
  z: number;
};

type Go = (g: { x: number; y: number; z: number }, distance: number, sel?: Selection) => void;

export function FindBox(p: {
  findText: string;
  setFindText: (v: string) => void;
  findOpen: boolean;
  setFindOpen: (v: boolean) => void;
  find: GalaxyFindDTO | null;
  findRegions: RegionOutlines["anchors"];
  findLayerHits: FindLayerHit[];
  spanshFind: { hits: SpanshFindHit[]; busy: boolean };
  setSpanshPicked: Dispatch<SetStateAction<Map<string, SpanshFindHit>>>;
  extraSet: Record<GalaxyLayerKind, (v: boolean) => void>;
  go: Go;
}) {
  const { find, findRegions, findLayerHits, spanshFind, extraSet, go } = p;
  // Spansh hits the map already shows (as a system or a layer point) are not offered twice.
  const shownNames = new Set([
    ...(find?.systems ?? []).map((s) => s.name.toLowerCase()),
    ...findLayerHits.map((h) => h.system.toLowerCase()),
  ]);
  const spanshShown = spanshFind.hits.filter((h) => !shownNames.has(h.starSystem.toLowerCase())).slice(0, 6);
  const hasFind =
    p.findOpen &&
    (findRegions.length > 0 ||
      findLayerHits.length > 0 ||
      spanshShown.length > 0 ||
      spanshFind.busy ||
      (find && (find.sectors.length || find.systems.length || (find.stations?.length ?? 0) > 0)));

  return (
    <div className="g3d-find g3d-find--centre">
      <input
        type="search"
        className="g3d-find__input"
        placeholder="Find a system, sector or region"
        aria-label="Find"
        value={p.findText}
        onChange={(ev) => {
          p.setFindText(ev.target.value);
          p.setFindOpen(true);
        }}
        onFocus={() => p.setFindOpen(true)}
        onKeyDown={(ev) => ev.key === "Escape" && p.setFindOpen(false)}
      />
      {hasFind ? (
        <ul className="g3d-find__list" role="listbox" data-testid="g3d-find">
          {findRegions.map((a) => (
            <li key={`r${a.index}`}>
              <button type="button" onClick={() => go({ x: a.x, y: 0, z: a.z }, 40_000)}>
                <span>{a.name}</span>
                <em>region</em>
              </button>
            </li>
          ))}
          {find?.sectors.map((s) => (
            <li key={`s${s.name}`}>
              <button type="button" onClick={() => go(s, 12_000)}>
                <span>{s.name}</span>
                <em>sector · {formatCount(s.systems)}</em>
              </button>
            </li>
          ))}
          {find?.systems.map((s) => (
            <li key={`y${s.addr ?? s.ordinal}`}>
              <button
                type="button"
                onClick={() =>
                  go(
                    s,
                    400,
                    s.mine
                      ? { kind: "marker", layer: "you", id: s.addr!, x: s.x, y: s.y, z: s.z }
                      : s.plotted
                        ? { kind: "marker", layer: "plotted", id: s.addr!, x: s.x, y: s.y, z: s.z }
                        : { kind: "index", ordinal: s.ordinal!, x: s.x, y: s.y, z: s.z },
                  )
                }
              >
                <span>{s.name}</span>
                <em title={s.plotted}>{s.mine ? "yours" : s.plotted ? "plotted" : "system"}</em>
              </button>
            </li>
          ))}
          {find?.stations?.map((h) => (
            <li key={`st${h.layerId}-${h.label}`}>
              <button
                type="button"
                onClick={() => {
                  extraSet.stations(true);
                  go(h, 400, {
                    kind: "marker",
                    layer: "x-stations",
                    id: String(h.layerId),
                    x: h.x,
                    y: h.y,
                    z: h.z,
                  });
                }}
              >
                <span className={h.own ? "stations-own" : undefined}>{h.label}</span>
                <em>
                  {h.own ? "your station" : "station"}
                  {h.pad ? ` · ${h.pad} pad` : ""}
                  {h.label === h.name ? ` · ${h.system}` : ""}
                </em>
              </button>
            </li>
          ))}
          {findLayerHits.map((h) => (
            <li key={`l${h.kind}${h.id}`}>
              <button
                type="button"
                onClick={() => {
                  extraSet[h.kind](true);
                  go(h, 400, { kind: "marker", layer: `x-${h.kind}`, id: h.id, x: h.x, y: h.y, z: h.z });
                }}
              >
                <span>{h.label}</span>
                <em>{h.what}</em>
              </button>
            </li>
          ))}
          {spanshShown.map((h) => (
            <li key={`s${h.systemAddress}`}>
              <button
                type="button"
                onClick={() => {
                  p.setSpanshPicked((m) => new Map(m).set(String(h.systemAddress), h));
                  go({ x: h.x!, y: h.y!, z: h.z! }, 400, {
                    kind: "marker",
                    layer: "spansh",
                    id: String(h.systemAddress),
                    x: h.x!,
                    y: h.y!,
                    z: h.z!,
                  });
                }}
              >
                <span>{h.starSystem}</span>
                <em>Spansh</em>
              </button>
            </li>
          ))}
          {spanshFind.busy ? <li className="g3d-find__more">Asking Spansh…</li> : null}
          {find?.partial ? <li className="g3d-find__more">Type more of the name for the rest</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
