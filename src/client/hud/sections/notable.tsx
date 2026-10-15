import type { HudSnapshot } from "../types";
import { listRowLimit } from "../core";
import { Head, type HudSection } from "../parts";
import { unreadCount } from "./notices";

/* ============================================================== Notable ===================== */
/*
  The system's notable planets on the HUD (guild tester report C9; owner, 2026-09-30: its own
  overlay). The same list as the app's Notable card — Earth-like, water and ammonia worlds,
  terraformables, Helium gas giants — orange until mapped, green once it is, and a medal on a planet
  that broke one of the commander's records. The header carries the unread count of the app's mail
  icon, so there is one place to glance at.
*/
const MEDAL = "🏅";

function Notable({ d }: { d: HudSnapshot }) {
  const list = d.notableBodies || [];
  const records: Record<number, unknown[]> = {};
  for (const m of (d.notices && d.notices.recordMarks) || []) (records[m.bodyId] = records[m.bodyId] || []).push(m);
  const unread = unreadCount(d);
  const mapped = list.filter((n) => n.dssMapped).length;
  // One row fewer than the candidates: a notable list sits under them in the merged panel.
  const limit = listRowLimit(8);
  const hidden = Math.max(0, list.length - limit);
  return (
    <>
      <Head
        title="Notable"
        status={
          <>
            {(list.length ? mapped + " / " + list.length + " mapped" : "None here") + (unread ? " " : "")}
            {unread ? (
              <>
                <span className="hud-mail" title="Unread notices in the app">
                  {`✉ ${unread}`}
                </span>
              </>
            ) : null}
          </>
        }
      />
      <ul className="hud-list notable-list" data-f="list">
        {list.length ? (
          <>
            {list.slice(0, limit).map((n, i) => (
              <li key={n.bodyId ?? i} className={"notable-row" + (n.dssMapped ? " notable-row--dss" : "")}>
                <span className="name">
                  {n.bodyLabelShort}{" "}
                  <small>
                    {n.tag}
                    {n.sold ? " · sold" : ""}
                  </small>
                </span>
                {(records[n.bodyId] || []).length ? (
                  <span className="notable-medal" title="Personal record">
                    {MEDAL}
                  </span>
                ) : null}
              </li>
            ))}
            {hidden ? <li className="more">+{hidden} more — all of them in the app</li> : null}
          </>
        ) : (
          <li className="plain">No notable planets in this system.</li>
        )}
      </ul>
    </>
  );
}

export const notable: HudSection = {
  title: "Notable",
  relevant: (d) => !!(d.notableBodies && d.notableBodies.length),
  state: (d) => {
    const list = d.notableBodies || [];
    return list.length && list.every((n) => n.dssMapped) ? "ok" : null;
  },
  render: (d) => <Notable d={d} />,
};
