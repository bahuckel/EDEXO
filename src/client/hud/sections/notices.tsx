import type { HudSnapshot } from "../types";
import { Mail } from "lucide-react";
import { Head, type HudSection } from "../parts";
import { NoticeIcon } from "../../noticeIcons";

/* ============================================================== Notices ===================== */
/*
  "Notify me" on the HUD (owner, 2026-09-30: "the mail icon or a HUD option"). What the app's mail
  icon collects — notable finds, records, phenomena, nearby points of interest and carriers — shown
  here for twenty seconds when it arrives, then left to the app's list. No sound here: the one sound
  is the app's record chime.

  "New" is what this page has seen arrive, not the notice's journal time: a notice already in the
  list when the overlay opens is not news.
*/
const FRESH_MS = 20000;
const firstSeen: Record<string, number> = {};
let primed = false;

type Notice = NonNullable<HudSnapshot["notices"]>["items"][number];

function freshItems(d: HudSnapshot): Notice[] {
  const items = (d.notices && d.notices.items) || [];
  const now = Date.now();
  if (!primed) {
    for (const n of items) firstSeen[n.id] = 0;
    primed = true;
  }
  const out: Notice[] = [];
  for (const n of items) {
    if (!(n.id in firstSeen)) firstSeen[n.id] = now;
    if (firstSeen[n.id] && now - firstSeen[n.id]! < FRESH_MS) out.push(n);
  }
  return out;
}

export function unreadCount(d: HudSnapshot | null | undefined): number {
  const n = d && d.notices;
  if (!n) return 0;
  return typeof n.unread === "number" ? n.unread : (n.items || []).length;
}

function Notices({ d }: { d: HudSnapshot }) {
  const fresh = freshItems(d);
  const unread = unreadCount(d);
  return (
    <>
      <Head
        title="Notices"
        status={
          <>
            <Mail className="hud-mail__ico" aria-hidden="true" />
            {unread + " unread"}
          </>
        }
      />
      <ul className="hud-list notices-list" data-f="list">
        {fresh.slice(0, 3).map((n) => (
          <li key={n.id} className={"notice notice--" + n.kind}>
            <span className="notice__icon">
              <NoticeIcon kind={n.kind} />
            </span>
            <span className="notice__text">
              <b>{n.title}</b>
              <small>{n.text}</small>
            </span>
          </li>
        ))}
      </ul>
      <p className="hud-note" data-f="note">
        {fresh.length ? "" : unread ? "Nothing new — the rest wait in the app's mail icon." : "Nothing new."}
      </p>
    </>
  );
}

export const notices: HudSection = {
  title: "Notices",
  // Not through freshItems: a notice already in the first snapshot is not news, so nothing may be seen before it.
  initial: () => (
    <>
      <Head title="Notices" status="—" />
      <ul className="hud-list notices-list" data-f="list" />
      <p className="hud-note" data-f="note" />
    </>
  ),
  relevant: (d) => freshItems(d).length > 0,
  state: (d) => (freshItems(d).length ? "ok" : null),
  render: (d) => <Notices d={d} />,
  // Drawn again each second so a notice leaves when its twenty seconds are up.
  ticks: true,
};
