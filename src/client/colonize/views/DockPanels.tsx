/**
 * Docked: at a seller, what to load here now (capped by the free hold); at one of your sites, what you carry that
 * it still needs. Each leads the plan while you are docked, because it is the one thing you can act on without
 * moving the ship.
 */
import { commodityMergeBucket } from "../../../shared/colonize/commodityKey";
import { depotDisplayLabel } from "../../../shared/colonize/depotLabel";
import { formatTons as t } from "../../../shared/colonize/formatPrice";
import { siteMaterials } from "../../../shared/colonize/siteMaterials";
import { looksLikeConstructionDepotStation } from "../../../shared/colonize/constructionDepot";
import type { LogisticsPlan } from "../../../shared/colonize/logisticsPlanner";
import type { DepotSnapshot } from "../../../shared/colonize/types";
import type { ColonizeModel } from "../useColonize";
import { Panel } from "./ui";

export function BuyHerePanel({ m, plan }: { m: ColonizeModel; plan: LogisticsPlan }) {
  const docked = m.snap?.liveDocked;
  if (!docked?.stationName || looksLikeConstructionDepotStation(docked.stationName)) return null;
  const free = m.freeTons;
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
      <div className="cz-stack" style={{ gap: 12 }}>
        <div className="cz-big">{docked.stationName}</div>
        {free != null && free <= 0 ? (
          <p style={{ margin: 0 }}>Deliver to a site before buying more.</p>
        ) : plan.dockBuys.length ? (
          <div className="cz-table-wrap">
            <table className="cz-table cz-table--big">
              <thead>
                <tr>
                  <th scope="col">Commodity</th>
                  <th scope="col" className="r">
                    Buy
                  </th>
                  <th scope="col" className="r">
                    Aboard now
                  </th>
                  <th scope="col">For</th>
                </tr>
              </thead>
              <tbody>
                {plan.dockBuys.map((b) => {
                  const aboard = m.shipCargoByKey.get(commodityMergeBucket(b.commodityId) || b.commodityId) ?? 0;
                  const done = aboard >= b.buyTons && b.buyTons > 0;
                  return (
                    <tr key={b.commodityId} className={done ? "is-done" : undefined}>
                      <td>
                        {done ? (
                          <span className="cz-done-mark" aria-label="loaded">
                            ✓{" "}
                          </span>
                        ) : null}
                        {b.label}
                      </td>
                      <td className={`r cz-strong${done ? "" : " cz-hi"}`}>{t(b.buyTons)}</td>
                      <td className="r cz-dim">{t(aboard)}</td>
                      <td className="cz-small cz-dim">{b.forDepots.join(", ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ margin: 0 }} className="cz-dim">
            The plan buys nothing here. This market may still sell something your sites need: Search shows what it sells.
          </p>
        )}
        <p className="cz-small cz-dim" style={{ margin: 0 }}>
          Amounts are capped by the room in your hold; a line ticks itself once the cargo is aboard.
        </p>
      </div>
    </Panel>
  );
}

export function DeliverHerePanel({ m, site }: { m: Pick<ColonizeModel, "shipCargoByKey">; site: DepotSnapshot }) {
  // The HUD's order: what is aboard, most first; then what this site has in full, last and green (owner, 2026-10-22).
  const materials = siteMaterials(site, m.shipCargoByKey);
  const rows = materials
    .filter((r) => r.aboard > 0)
    .map((r) => ({ label: r.label, need: r.left, give: r.aboard }))
    .sort((a, b) => b.give - a.give);
  const delivered = materials.filter((r) => r.done);
  return (
    <Panel k="deliver-here" tone="info" title="Docked at your site">
      <div className="cz-stack" style={{ gap: 12 }}>
        <div className="cz-big">{depotDisplayLabel(site)}</div>
        {rows.length ? (
          <ul className="cz-list">
            {rows.map((r) => (
              <li key={r.label}>
                <span>
                  Deliver <b>{r.label}</b>
                </span>
                <span className="cz-num">
                  {t(r.give)} <span className="cz-small cz-dim">of {t(r.need)} still needed</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0 }} className="cz-dim">
            Nothing in your hold that this site still needs.
          </p>
        )}
        {delivered.length ? (
          <p style={{ margin: 0 }} className="cz-small cz-mat--done">
            {`Delivered in full: ${delivered.map((r) => r.label).join(", ")}`}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
