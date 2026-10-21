/**
 * Docked: at a seller, what to load here now (capped by the free hold); at one of your sites, what you carry that
 * it still needs. Each leads the plan while you are docked, because it is the one thing you can act on without
 * moving the ship.
 */
import { commodityMergeBucket } from "../../../shared/colonize/commodityKey";
import { depotDisplayLabel } from "../../../shared/colonize/depotLabel";
import { looksLikeConstructionDepotStation } from "../../../shared/colonize/constructionDepot";
import type { LogisticsPlan } from "../../../shared/colonize/logisticsPlanner";
import type { DepotSnapshot } from "../../../shared/colonize/types";
import type { ColonizeModel } from "../useColonize";

const t = (n: number) => `${Math.round(n).toLocaleString("en-US")} t`;

export function BuyHerePanel({ m, plan }: { m: ColonizeModel; plan: LogisticsPlan }) {
  const docked = m.snap?.liveDocked;
  if (!docked?.stationName || looksLikeConstructionDepotStation(docked.stationName)) return null;
  const free = m.freeTons;
  return (
    <section className="cz-panel cz-panel--info cz-stack" aria-labelledby="cz-buyhere-h" style={{ gap: 12 }}>
      <div className="cz-row">
        <div>
          <h3 id="cz-buyhere-h" className="cz-eyebrow">
            Buy here now
          </h3>
          <div className="cz-big">{docked.stationName}</div>
        </div>
        <span style={{ color: "var(--text-dim)" }}>
          {free == null ? "Hold size not known: set it in the header" : free > 0 ? `${t(free)} of room left` : "Your hold is full"}
        </span>
      </div>
      {free != null && free <= 0 ? (
        <p style={{ margin: 0 }}>Deliver to a site before buying more.</p>
      ) : plan.dockBuys.length ? (
        <div className="cz-table-wrap">
          <table className="cz-table" style={{ fontSize: 17 }}>
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
                    <td className="r" style={{ fontWeight: 700, color: done ? undefined : "var(--hud-hi)" }}>
                      {t(b.buyTons)}
                    </td>
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
    </section>
  );
}

export function DeliverHerePanel({ m, site }: { m: Pick<ColonizeModel, "shipCargoByKey">; site: DepotSnapshot }) {
  const rows = site.resources
    .map((r) => {
      const need = Math.max(0, r.required - r.provided);
      const key = commodityMergeBucket(r.name) || commodityMergeBucket(r.nameLocalised);
      const aboard = key ? (m.shipCargoByKey.get(key) ?? 0) : 0;
      return { label: r.nameLocalised || r.name, need, aboard, give: Math.min(need, aboard) };
    })
    .filter((r) => r.give > 0);
  return (
    <section className="cz-panel cz-panel--info cz-stack" aria-labelledby="cz-deliver-h" style={{ gap: 12 }}>
      <div>
        <h3 id="cz-deliver-h" className="cz-eyebrow">
          Docked at your site
        </h3>
        <div className="cz-big">{depotDisplayLabel(site)}</div>
      </div>
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
    </section>
  );
}
