/**
 * The hover card over the map: what the pointer is on, one marker layer at a time. Moved out of
 * GalaxyMap3D.tsx (audit 2026-10-22) as a plain function rather than a component, so the element tree is
 * the one the map drew before.
 */
import { fmtLy } from "@shared/format";
import { expeditionTip, targetLabelOf } from "../ExpeditionDrawer";
import { formatCount, formatValue } from "./clusters";
import type { HoverInfo } from "./engineTypes";
import { jumpLine } from "./jumpRow";
import { MINE_IMPORTED, mineStatus } from "./mapConstants";
import { extraPoint, navPoint, type MapLookups } from "./pointLookup";
import { StationNames } from "./StationsAt";

export function hoverTip(
  hover: HoverInfo | null,
  {
    extraData,
    route,
    navShown,
    mine,
    planStops,
    jumpById,
    expByKey,
    expField,
    spanshPicked,
    searchHits,
    codexSystems,
  }: MapLookups,
) {
  if (!hover) return null;
  if (hover.kind === "system") {
    return (
      <>
        <strong>{hover.name ?? "…"}</strong>
        <span>
          {hover.species} species · {formatValue(hover.value)}
        </span>
        <em>Click for details</em>
      </>
    );
  }
  if (hover.kind === "group") {
    return (
      <>
        <strong>{hover.name ?? `${formatCount(hover.count)} systems`}</strong>
        <span>
          {hover.name ? `${formatCount(hover.count)} systems · ` : ""}
          best {formatValue(hover.top)}
        </span>
        <em>{hover.level === 1280 ? "Click for its best systems and to zoom in" : "Click to zoom in"}</em>
      </>
    );
  }
  if (hover.layer === "you") {
    const r = mine.get(hover.id);
    return r ? (
      <>
        <strong>
          {r.name || (r.flags & MINE_IMPORTED ? "A system you visited (name not known)" : "Your system")}
        </strong>
        <span>{mineStatus(r)}</span>
        <em>
          {r.flags & MINE_IMPORTED
            ? "Placed at its boxel's centre unless the galaxy index has it"
            : "Your journals · click for details"}
        </em>
      </>
    ) : null;
  }
  if (hover.layer === "plan") {
    const p = planStops.get(hover.id);
    return p ? (
      <>
        <strong>
          {p.n}. {p.name}
        </strong>
        <span>
          {fmtLy(p.legLy)} from {p.n === 1 ? "your ship" : `stop ${p.n - 1}`} · {p.species} species ·{" "}
          {formatValue(p.valueCr / 100_000)}
        </span>
        <em>Plan stop · click for details</em>
      </>
    ) : null;
  }
  if (hover.layer === "jumponium") {
    const r = jumpById.get(hover.id);
    return r ? (
      <>
        <strong>{r.body}</strong>
        <span>{jumpLine(r)}</span>
        <em>{r.own ? "You scanned it" : "From Spansh's dump"} · click for details</em>
      </>
    ) : null;
  }
  if (hover.layer === "expedition") {
    const b = expByKey.get(hover.id);
    if (!b) return null;
    const t = expeditionTip(b, !!expField?.species, targetLabelOf(expField?.target));
    return (
      <>
        <strong>{t.title}</strong>
        <span>{t.line}</span>
        <em>{t.note}</em>
      </>
    );
  }
  const xp = extraPoint(extraData, hover.layer, hover.id);
  if (xp) {
    return (
      <>
        <strong>{xp.p[3]}</strong>
        {xp.unconfirmed ? <span className="g3d-unconfirmed">Unconfirmed candidate</span> : null}
        {xp.detail ? <span>{xp.detail}</span> : null}
        {xp.meta.kind === "stations" ? <StationNames x={xp.p[0]} y={xp.p[1]} z={xp.p[2]} /> : null}
        <em>{xp.meta.label} · click for details</em>
      </>
    );
  }
  const nv = navPoint(route, navShown, hover.layer, hover.id);
  if (nv) {
    return (
      <>
        <strong>{nv.name}</strong>
        <span>
          {nv.starClass ? `${nv.starClass} star · ` : ""}
          {nv.visited ? "visited" : "not visited yet"}
        </span>
        <em>{hover.layer === "navUnvisited" ? "On your plotted route" : "NavRoute"} · click for details</em>
      </>
    );
  }
  if (hover.layer === "spansh") {
    const h = spanshPicked.get(hover.id);
    return h ? (
      <>
        <strong>{h.starSystem}</strong>
        <em>From Spansh · click for details</em>
      </>
    ) : null;
  }
  if (hover.layer === "search") {
    const h = searchHits.get(hover.id);
    return h ? (
      <>
        <strong>{h.starSystem}</strong>
        <span>{h.note}</span>
        <em>Search result · click for details</em>
      </>
    ) : null;
  }
  const c = codexSystems.get(hover.id);
  return c ? (
    <>
      <strong>{c.name}</strong>
      <span>
        {c.entries.filter((x) => x.logged).length} of {c.entries.length} codex entries logged
      </span>
      <em>Click for the list</em>
    </>
  ) : null;
}
