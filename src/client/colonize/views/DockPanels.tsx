/**
 * Docked (R5b, cards mockup P8): at a seller, what to load here now as tiles whose bars fill from the hold, a loaded
 * one moving to the end in green; at one of your sites, the whole site (15a e): what to unload now first, with what
 * this unload achieves striped on each bar, then what it still needs and what it has in full, folded. Each leads the
 * plan while you are docked, because it is the one thing you can act on without moving the ship.
 */
import { commodityMergeBucket } from "../../../shared/colonize/commodityKey";
import { useRef } from "react";
import { useFlip } from "../../ui/useFlip";
import { depotDisplayLabel } from "../../../shared/colonize/depotLabel";
import { formatTons as t } from "../../../shared/colonize/formatPrice";
import { siteMaterials, siteTotals, type SiteMaterial } from "../../../shared/colonize/siteMaterials";
import { looksLikeConstructionDepotStation } from "../../../shared/colonize/constructionDepot";
import type { LogisticsPlan } from "../../../shared/colonize/logisticsPlanner";
import type { DepotSnapshot } from "../../../shared/colonize/types";
import type { ColonizeModel } from "../useColonize";
import { MaterialTiles } from "./MaterialList";
import { Panel } from "./ui";

const pct = (n: number, of: number) => (of > 0 ? Math.max(0, Math.min(100, (n / of) * 100)) : 0);

export function BuyHerePanel({ m, plan }: { m: ColonizeModel; plan: LogisticsPlan }) {
  const docked = m.snap?.liveDocked;
  const flipRef = useRef<HTMLDivElement>(null);
  useFlip(flipRef);
  if (!docked?.stationName || looksLikeConstructionDepotStation(docked.stationName)) return null;
  const free = m.freeTons;
  // Loaded lines last (the mockup: a loaded tile moves to the end, in green), each with its bar from the hold.
  const lines = plan.dockBuys
    .map((b) => {
      const aboard = m.shipCargoByKey.get(commodityMergeBucket(b.commodityId) || b.commodityId) ?? 0;
      return { ...b, aboard, done: aboard >= b.buyTons && b.buyTons > 0 };
    })
    .sort((a, b) => Number(a.done) - Number(b.done));
  return (
    <Panel
      k="buy-here"
      tone="hot"
      title="Buy here now"
      aside={
        <span className="cz-aside-note">
          {free == null ? "Hold size not known: set it in the tray" : free > 0 ? `${t(free)} of room left` : "Your hold is full"}
        </span>
      }
    >
      <div className="cz-stack" style={{ gap: "0.75rem" }}>
        <div>
          <div className="cz-big">{docked.stationName}</div>
          {docked.starSystem ? <div className="cz-small cz-dim">{docked.starSystem}</div> : null}
        </div>
        {free != null && free <= 0 && !lines.some((l) => !l.done) ? (
          <p style={{ margin: 0 }}>Deliver to a site before buying more.</p>
        ) : lines.length ? (
          <div ref={flipRef} className="cz-mtiles cz-mtiles--buy">
            {lines.map((b) => (
              <div key={b.commodityId} data-flip-key={b.commodityId} className={`fact cz-mtile${b.done ? " fact--tone-yours" : ""}`}>
                <span className="fact-k" title={b.label}>
                  {b.done ? "✓ " : ""}
                  {b.label}
                </span>
                <span className={`fact-v${b.done ? "" : " cz-hi"}`}>
                  {b.done ? "Loaded" : "Buy"} {t(b.buyTons)}
                </span>
                <span className="cz-mtile__sub cz-soft">
                  {Math.min(b.aboard, b.buyTons).toLocaleString("en-US")} / {t(b.buyTons)} aboard
                </span>
                {b.forDepots.length ? (
                  <span className="cz-mtile__sub" title={`for ${b.forDepots.join(", ")}`}>
                    for {b.forDepots.join(", ")}
                  </span>
                ) : null}
                <span className="cz-mtile__bar" aria-hidden="true">
                  <i className="f" style={{ width: `${pct(b.aboard, b.buyTons)}%` }} />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0 }} className="cz-dim">
            The plan buys nothing here. This market may still sell something your sites need: Search shows what it sells.
          </p>
        )}
        <p className="cz-small cz-dim" style={{ margin: 0 }}>
          Amounts are capped by the room in your hold; a line is done by itself once the cargo is aboard.
        </p>
      </div>
    </Panel>
  );
}

/** "Deliver 40 t", with the bar showing what is delivered and, striped, what this unload adds. */
function UnloadTiles({ rows }: { rows: SiteMaterial[] }) {
  const flipRef = useRef<HTMLDivElement>(null);
  useFlip(flipRef);
  return (
    <div ref={flipRef} className="cz-mtiles">
      {rows.map((r) => {
        const done = pct(r.provided, r.required);
        const add = pct(r.aboard, r.required);
        return (
          <div key={r.id || r.label} data-flip-key={r.id || r.label} className="fact cz-mtile fact--tone-open">
            <span className="fact-k" title={r.label}>
              {r.label}
            </span>
            <span className="fact-v">Deliver {t(r.aboard)}</span>
            <span className="cz-mtile__sub">
              of {t(r.left)} left · {t(r.required)} needed
            </span>
            <span className="cz-mtile__bar" aria-hidden="true">
              <i className="f" style={{ width: `${done}%` }} />
              <i className="a" style={{ left: `${done}%`, width: `${Math.min(add, 100 - done)}%` }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function DeliverHerePanel({ m, site }: { m: Pick<ColonizeModel, "shipCargoByKey">; site: DepotSnapshot }) {
  // The HUD's order: what is aboard, most first; then the rest of the site, folded, delivered last (owner, 2026-10-22).
  const materials = siteMaterials(site, m.shipCargoByKey);
  const unload = materials.filter((r) => r.aboard > 0).sort((a, b) => b.aboard - a.aboard);
  const needed = materials.filter((r) => !r.done && r.aboard <= 0);
  const delivered = materials.filter((r) => r.done);
  const tot = siteTotals(site);
  const unloadTons = unload.reduce((a, r) => a + r.aboard, 0);
  const after = tot.required > 0 ? Math.min(100, tot.pct + (unloadTons / tot.required) * 100) : tot.pct;
  return (
    <Panel
      k="deliver-here"
      tone="info"
      title="Docked at your site"
      aside={
        <span className="cz-aside-note">
          {unloadTons > 0 ? `${Math.floor(tot.pct)} % → ${Math.floor(after)} % after this unload` : `${Math.floor(tot.pct)} % built`}
        </span>
      }
    >
      <div className="cz-stack" style={{ gap: "0.75rem" }}>
        <div>
          <div className="cz-big">{depotDisplayLabel(site)}</div>
          {site.starSystem ? <div className="cz-small cz-dim">{site.starSystem}</div> : null}
        </div>
        {unload.length ? (
          <>
            <div className="cz-grouplabel cz-grouplabel--ok">
              Unload now <span className="cz-soft" style={{ letterSpacing: "0.04em" }}>{t(unloadTons)}</span>
            </div>
            <UnloadTiles rows={unload} />
          </>
        ) : (
          <p style={{ margin: 0 }} className="cz-dim">
            Nothing in your hold that this site still needs.
          </p>
        )}
        <div>
          {needed.length ? (
            <details className="cz-fold">
              <summary>Still needed, not aboard ({needed.length})</summary>
              <MaterialTiles rows={needed} />
            </details>
          ) : null}
          {delivered.length ? (
            <details className="cz-fold cz-fold--done">
              <summary>Delivered ({delivered.length})</summary>
              <MaterialTiles rows={delivered} />
            </details>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
