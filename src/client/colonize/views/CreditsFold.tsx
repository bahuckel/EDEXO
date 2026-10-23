/**
 * Credits per system by the game's week (discuss item 33, owner 2026-10-23), under Your sites: what the sites paid you
 * for your deliveries, what that cargo cost you (the last price you paid before delivering it), and the difference;
 * a week starts Thursday 07:00 UTC. From your own journal only (shared/colonize/creditsByWeek.ts).
 */
import type { SystemCredits, WeekCredits } from "../../../shared/colonize/creditsByWeek";
import { formatTons as tons } from "../../../shared/colonize/formatPrice";
import { weekStart } from "../../../shared/colonize/creditsByWeek";

/** Credits short: 1.25 M cr, 840 k cr, 950 cr. */
export function cr(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)} B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)} M` : a >= 1e4 ? `${Math.round(a / 1e3)} k` : Math.round(a).toLocaleString("en-US");
  return `${n < 0 ? "−" : ""}${s} cr`;
}

/** "22 Oct"; with the year when it is not this one ("18 Sept 2025"). */
const weekLabel = (iso: string) => {
  const d = new Date(iso);
  const other = d.getUTCFullYear() !== new Date().getUTCFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(other ? { year: "numeric" } : {}), timeZone: "UTC" });
};

function Row({ w, current }: { w: WeekCredits; current: boolean }) {
  const net = w.paid - w.spent;
  return (
    <li className="cz-credits__row">
      <span className="cz-credits__week">
        {current ? "This week" : `Week of ${weekLabel(w.week)}`}
        <small className="cz-dim"> · {tons(w.tons)}</small>
      </span>
      <span className="cz-num cz-ok" title="Paid to you by the sites">
        +{cr(w.paid)}
      </span>
      <span className="cz-num cz-dim" title={w.unpricedTons ? `What the cargo cost you; ${tons(w.unpricedTons)} had no price (bought before these journals, or from your carrier)` : "What the cargo cost you"}>
        −{cr(w.spent)}
        {w.unpricedTons ? "*" : ""}
      </span>
      <span className={`cz-num cz-strong${net >= 0 ? " cz-hi" : " cz-warn"}`}>{cr(net)}</span>
    </li>
  );
}

export function CreditsFold({ systems }: { systems: SystemCredits[] }) {
  if (!systems.length) return null;
  const thisWeek = new Date(weekStart(Date.now())).toISOString();
  const now = systems.reduce((a, s) => a + (s.weeks[0]?.week === thisWeek ? s.weeks[0].paid : 0), 0);
  return (
    <details className="cz-fold" data-testid="credits">
      <summary>
        Credits by week{now > 0 ? <span className="cz-ok"> · +{cr(now)} this week</span> : null}
      </summary>
      <div className="cz-stack">
        <p className="cz-lead">
          What the sites paid you for your deliveries, what that cargo cost you (the last price you paid before delivering
          it) and the difference. Weeks start Thursday 07:00 UTC.
        </p>
        {systems.map((s) => (
          <div key={s.system} className="cz-credits">
            <div className="cz-row">
              <b>{s.system}</b>
              <span className="cz-small cz-dim">
                {tons(s.total.tons)} · +{cr(s.total.paid)} · net {cr(s.total.paid - s.total.spent)}
              </span>
            </div>
            <ul className="cz-credits__list">
              {s.weeks.map((w) => (
                <Row key={w.week} w={w} current={w.week === thisWeek} />
              ))}
            </ul>
          </div>
        ))}
        {systems.some((s) => s.total.unpricedTons > 0) ? (
          <p className="cz-small cz-dim" style={{ margin: 0 }}>
            * Some cargo had no price: bought before the journals on this PC, or taken from your carrier. Its cost is not
            counted.
          </p>
        ) : null}
      </div>
    </details>
  );
}
