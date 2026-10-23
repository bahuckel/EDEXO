/**
 * The side panel's record of what is selected, one marker layer at a time. Moved out of GalaxyMap3D.tsx
 * (audit 2026-10-22) as a plain function rather than a component, so the element tree is the one the map
 * drew before.
 */
import type { Dispatch, SetStateAction } from "react";
import { fmtLy } from "@shared/format";
import type { CodexMapRegionSummaryDTO } from "@shared/dto/codexMap.js";
import type { FinderHit } from "@shared/finder";
import { SystemBookmarkButton } from "../BookmarkButton";
import { CopySystemButton } from "../CopySystemButton";
import { ExpeditionBoxelCard, targetLabelOf } from "../ExpeditionDrawer";
import type { Selection } from "./engineTypes";
import { FinderHitCard } from "./FinderHitCard";
import { CodexRecord, IndexRecord, MySystemRecord, SectorRecord } from "./GalaxyPanels";
import { jumpLine, type JumpRow } from "./jumpRow";
import { dist } from "./mapConstants";
import { extraPoint, navPoint, type MapLookups } from "./pointLookup";
import { whyLit, type WhyLitContext } from "./whyLit";

export interface SelectionPanelContext extends MapLookups, WhyLitContext {
  go: (g: { x: number; y: number; z: number }, distance: number, sel?: Selection) => void;
  jumpPicked: JumpRow | null;
  finderHitFor: (id: string) => FinderHit | null;
  expPlanKeys: string[];
  setExpPlanKeys: Dispatch<SetStateAction<string[]>>;
  codexSummary: CodexMapRegionSummaryDTO | undefined;
  codexRegion: string | null;
}

export function selectionPanel(selection: Selection | null, ctx: SelectionPanelContext) {
  const {
    extraData,
    route,
    navShown,
    jumpById,
    expByKey,
    expField,
    spanshPicked,
    searchHits,
    codexSystems,
    go,
    jumpPicked,
    finderHitFor,
    expPlanKeys,
    setExpPlanKeys,
    codexSummary,
    codexRegion,
  } = ctx;
  if (!selection) return null;
  if (selection.kind === "index")
    return (
      <>
        <IndexRecord ordinal={selection.ordinal} heading />
        {whyLit(selection, ctx)}
      </>
    );
  if (selection.kind === "sector") {
    return (
      <SectorRecord
        key={selection.key}
        sectorKey={selection.key}
        onPick={(s) => go(s, 400, { kind: "index", ordinal: s.ordinal, x: s.x, y: s.y, z: s.z })}
      />
    );
  }
  if (selection.layer === "you") return <MySystemRecord addr={selection.id} />;
  if (selection.layer === "plan") return <IndexRecord ordinal={Number(selection.id)} heading />;
  if (selection.layer === "jumponium") {
    const r = jumpById.get(selection.id) ?? (jumpPicked?.id === selection.id ? jumpPicked : null);
    return r ? (
      <div>
        <h2 className="g3d-panel__name">{r.body}</h2>
        <p className="g3d-panel__meta">
          {r.system} <CopySystemButton system={r.system} />
        </p>
        <p>{jumpLine(r)}</p>
        <p className="dim">
          {[
            r.type,
            r.gravityG != null ? `${r.gravityG.toFixed(2)} g` : null,
            r.distLs != null ? `${Math.round(r.distLs).toLocaleString("en-US")} ls from arrival` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {route?.position ? <p className="dim">{fmtLy(dist(route.position, r))} from your ship</p> : null}
        <p className="dim">
          {r.own ? "You scanned it." : "From Spansh's dump: the top 1 % of landable bodies for an element."}
        </p>
      </div>
    ) : null;
  }
  if (selection.layer === "finder") {
    const h = finderHitFor(selection.id);
    return h ? <FinderHitCard h={h} ship={route?.position ?? null} /> : null;
  }
  if (selection.layer === "expedition") {
    const b = expByKey.get(selection.id);
    return b ? (
      <ExpeditionBoxelCard
        b={b}
        species={!!expField?.species}
        targetLabel={targetLabelOf(expField?.target)}
        ship={route?.position ?? null}
        inPlan={expPlanKeys.includes(b.key)}
        onTogglePlan={() =>
          setExpPlanKeys((k) =>
            k.includes(b.key) ? k.filter((x) => x !== b.key) : [...k, b.key].slice(0, 20),
          )
        }
      />
    ) : null;
  }
  const xs = extraPoint(extraData, selection.layer, selection.id);
  if (xs) {
    return (
      <div>
        <h2 className="g3d-panel__name">{xs.p[3]}</h2>
        <p className="g3d-panel__meta">{xs.meta.label}</p>
        {xs.unconfirmed ? (
          <p className="g3d-unconfirmed g3d-unconfirmed--block">
            Unconfirmed candidate — the model&apos;s guess from Spansh data. Nobody has reported it green in
            the game yet: go and look.
          </p>
        ) : null}
        {xs.detail ? <p className="g3d-panel__note">{xs.detail}</p> : null}
        {xs.system ? (
          <>
            <p>
              {xs.system} <CopySystemButton system={xs.system} />
            </p>
            <p className="g3d-panel__bm">
              <SystemBookmarkButton
                system={xs.system}
                systemAddress={null}
                pos={{ x: xs.p[0], y: xs.p[1], z: xs.p[2] }}
              />
            </p>
          </>
        ) : null}
        {route?.position ? (
          <p className="dim">
            {fmtLy(dist(route.position, { x: xs.p[0], y: xs.p[1], z: xs.p[2] }))} from your ship
          </p>
        ) : null}
      </div>
    );
  }
  const ns = navPoint(route, navShown, selection.layer, selection.id);
  if (ns) {
    return (
      <div>
        <h2 className="g3d-panel__name">
          {ns.name} <CopySystemButton system={ns.name} />
        </h2>
        <p className="g3d-panel__meta">
          {ns.starClass ? `${ns.starClass} star · ` : ""}
          {ns.visited ? "visited" : "on your plotted route, not visited yet"}
        </p>
        {route?.position ? <p className="dim">{fmtLy(dist(route.position, ns))} from your ship</p> : null}
        <p className="g3d-panel__bm">
          <SystemBookmarkButton
            system={ns.name}
            systemAddress={ns.address}
            pos={{ x: ns.x, y: ns.y, z: ns.z }}
          />
        </p>
        <IndexRecord addr={String(ns.address)} fallbackName={ns.name} />
      </div>
    );
  }
  if (selection.layer === "spansh") {
    const h = spanshPicked.get(selection.id);
    if (!h) return null;
    const at = { x: h.x!, y: h.y!, z: h.z! };
    return (
      <div>
        <h2 className="g3d-panel__name">
          {h.starSystem} <CopySystemButton system={h.starSystem} />
        </h2>
        <p className="g3d-panel__meta">From Spansh · not in the galaxy index (no biology recorded there)</p>
        {route?.position ? <p className="dim">{fmtLy(dist(route.position, at))} from your ship</p> : null}
        <p className="g3d-panel__bm">
          <SystemBookmarkButton system={h.starSystem} systemAddress={h.systemAddress} pos={at} />
        </p>
        <p>
          <button
            type="button"
            className="g3d-btn"
            title="Open it on the main screen: its bodies are fetched from Spansh"
            onClick={() =>
              void fetch("/api/ui/view-system", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ systemAddress: h.systemAddress, starSystem: h.starSystem }),
              })
            }
          >
            Show on the main screen
          </button>
        </p>
      </div>
    );
  }
  if (selection.layer === "search") {
    const h = searchHits.get(selection.id);
    return <IndexRecord addr={selection.id} heading fallbackName={h?.starSystem} />;
  }
  const c = codexSystems.get(selection.id);
  return c ? <CodexRecord system={c} region={codexSummary?.name ?? codexRegion ?? ""} /> : null;
}
