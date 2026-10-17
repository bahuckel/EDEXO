/**
 * The notices bell in the app bar (owner, 2026-09-30: "a bell icon next to the mail, not hidden in a
 * menu"): the "Notify me" notices — notable finds, records, phenomena, points of interest, carriers,
 * green gas giants, body features. The count is the unread ones. Read ones stay, dimmed, to be read
 * again, until "Clear read"; the server keeps them, so the phone and this window agree.
 */
import { useCallback, useEffect, useState } from "react";
import { memoOnSnapSlice, type SnapSlice } from "./snapSlice";
import type { NoticeDTO } from "@shared/notices";
import { Popover } from "./ui/Popover";
import { useToast } from "./ui/feedback";
import { useRecordChime } from "./noticesClient";

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const NOTICE_ICON: Record<NoticeDTO["kind"], string> = {
  notable: "★",
  record: "🏅",
  nsp: "✦",
  poi: "◈",
  carrier: "▣",
  codex: "◆",
  achievement: "🏆",
  jumponium: "⚗",
  cg: "⚑",
};

async function post(path: string, body: unknown): Promise<boolean> {
  try {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}

const BELL_FIELDS = ["notices", "journalBoot", "currentSystemAddress"] as const;

/** Re-rendered when the notices change, not on every push (snapSlice.ts). */
export const NoticesBell = memoOnSnapSlice(BELL_FIELDS, function NoticesBell({
  snap,
}: {
  snap: SnapSlice<(typeof BELL_FIELDS)[number]>;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  useRecordChime(snap);

  /*
    Answers shown at once, before the server's push agrees: id → read or not. Cleared when the
    snapshot catches up (the same ids then say the same thing).
  */
  const [local, setLocal] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [cleared, setCleared] = useState(false);
  const items = (snap.notices?.items ?? [])
    .map((n) => (local.has(n.id) ? { ...n, read: local.get(n.id) } : n))
    .filter((n) => !(cleared && n.read));
  useEffect(() => {
    setLocal(new Map());
    setCleared(false);
  }, [snap.notices?.items]);
  const unread = items.filter((n) => !n.read);
  const read = items.filter((n) => n.read);

  const setRead = useCallback(
    (ids: string[] | "all", isRead: boolean) => {
      const pick = ids === "all" ? items.filter((n) => !n.read).map((n) => n.id) : ids;
      setLocal((prev) => {
        const next = new Map(prev);
        for (const id of pick) next.set(id, isRead);
        return next;
      });
      const body = ids === "all" ? { all: true } : { ids };
      void post(isRead ? "/api/notices/read" : "/api/notices/unread", body).then((ok) => {
        if (!ok) toast.error("Could not change the notice.");
      });
    },
    [items, toast],
  );
  const clearRead = useCallback(() => {
    setCleared(true);
    void post("/api/notices/clear-read", {}).then((ok) => {
      if (!ok) toast.error("Could not clear the read notices.");
    });
  }, [toast]);

  const show = useCallback(
    (n: NoticeDTO) => {
      const here = n.systemAddress === snap.currentSystemAddress;
      void (async () => {
        await post("/api/ui/view-system", { systemAddress: here ? null : n.systemAddress });
        if (n.bodyKey) await post("/api/ui/selected-body", { bodyKey: n.bodyKey, focus: true });
      })();
      if (!n.read) setRead([n.id], true);
      setOpen(false);
    },
    [snap.currentSystemAddress, setRead],
  );

  const row = (n: NoticeDTO) => (
    <div key={n.id} className={`exo-data-alert notice notice--${n.kind}${n.read ? " notice--read" : ""}`} role="listitem">
      <span className={`exo-data-alert__icon notice__icon notice__icon--${n.kind}`} aria-hidden>
        {NOTICE_ICON[n.kind]}
      </span>
      <div className="exo-data-alert__text">
        <div className="exo-data-alert__meta">
          {n.body ? `${n.body} · ` : ""}
          {n.system} · {ago(n.at)}
        </div>
        <div className="exo-data-alert__title">{n.title}</div>
        <div className="exo-data-alert__detail">{n.text}</div>
      </div>
      <div className="exo-data-alert__actions">
        {n.systemAddress != null ? (
          <button
            type="button"
            className="exo-data-alert__btn"
            title={`Show ${n.body ? `${n.body} in ` : ""}${n.system}`}
            onClick={() => show(n)}
          >
            Show
          </button>
        ) : null}
        {n.kind === "cg" ? (
          <button
            type="button"
            className="exo-data-alert__btn"
            title={`Copy ${n.system} to paste into the galaxy map`}
            onClick={() => void navigator.clipboard?.writeText(n.system).catch(() => {})}
          >
            Copy system
          </button>
        ) : null}
        <button
          type="button"
          className="exo-data-alert__btn exo-data-alert__btn--secondary"
          onClick={() => setRead([n.id], !n.read)}
        >
          {n.read ? "Unread" : "Read"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="exo-data-alerts-header-wrap notices-bell">
      {/* Opened, placed and closed by ui/Popover (Radix): focus in and back, Escape, outside click. */}
      <Popover
        open={open}
        onOpenChange={setOpen}
        label="Notices"
        className="exo-data-alerts-popover"
        // Right edge on the button's right edge, as it opened before; Radix shifts it in where needed.
        align="end"
        trigger={
          <button
            type="button"
            className={`exo-data-alerts-trigger btn-top-neutral notices-bell__btn${unread.length ? " exo-data-alerts-trigger--notice" : " exo-data-alerts-trigger--idle"}`}
            aria-label={`Notices: ${unread.length} unread`}
            title={
              unread.length
                ? `${unread.length} unread notice${unread.length === 1 ? "" : "s"} — Options → Notify me chooses what comes here`
                : "Notices — Options → Notify me chooses what comes here"
            }
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>
        }
      >
        <div className="notices-group__head">
          <span className="notices-group__title">
            Notices{unread.length ? ` · ${unread.length} unread` : ""}
          </span>
          {unread.length ? (
            <button type="button" className="exo-data-alert__btn exo-data-alert__btn--secondary" onClick={() => setRead("all", true)}>
              Mark all read
            </button>
          ) : null}
        </div>
        {!items.length ? (
          <p className="dim tiny">Nothing yet. Options → Notify me chooses what comes here.</p>
        ) : null}
        {unread.length ? (
          <div className="exo-data-alerts exo-data-alerts--in-popover" role="list">
            {unread.map(row)}
          </div>
        ) : items.length ? (
          <p className="dim tiny">All read.</p>
        ) : null}
        {read.length ? (
          <>
            <div className="notices-group__head notices-group__head--read">
              <span className="notices-group__title">Read ({read.length})</span>
              <button type="button" className="exo-data-alert__btn exo-data-alert__btn--secondary" onClick={clearRead}>
                Clear read
              </button>
            </div>
            <div className="exo-data-alerts exo-data-alerts--in-popover" role="list">
              {read.map(row)}
            </div>
          </>
        ) : null}
      </Popover>
      {/* Beside the button, not in it: the cockpit's cut corner (clip-path) clipped it to the button's
          square, so most numbers could not be read (owner, 2026-10-11). */}
      {unread.length ? (
        <span className="exo-data-alerts-trigger__badge exo-data-alerts-trigger__badge--notice" aria-hidden>
          {unread.length}
        </span>
      ) : null}
    </div>
  );
});
