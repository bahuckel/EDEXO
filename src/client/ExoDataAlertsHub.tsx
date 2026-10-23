/**
 * The codex-consistency alerts hub in the app bar, split out of App.tsx (7.3).
 */
import { useToast } from "./ui/feedback";
import { Popover } from "./ui/Popover";
import { useCallback, useEffect, useMemo, useState, ReactNode } from "react";
import type { ExoDataAlertDTO } from "@shared/types";
import {
  EXO_ALERT_DETECT_FEEDER_LS,
  EXO_ALERT_DETECT_JOURNAL_LS,
  EXO_ALERT_RESCAN_EVENT,
  EXO_ALERT_SOURCES_EVENT,
  EXO_DATA_ALERT_DISMISS_LS,
  applyExoDataScanSourceClear,
  collectExoDataAlertsFromSnapshot,
  readExoAlertAckIds,
  readExoAlertDismissals,
  writeExoAlertAckIds,
} from "./exoAlertsStore";
import { readLsBool } from "./lsPrefs";
import { memoOnSnapSlice, type SnapSlice } from "./snapSlice";

const ALERT_FIELDS = ["bodies", "exoOverlayFocusBody", "sharedExomastery", "journalBoot"] as const;

/** Re-rendered when the bodies or the alerts' sources change, not on every push (snapSlice.ts). */
export const ExoDataAlertsHeaderHub = memoOnSnapSlice(ALERT_FIELDS, function ExoDataAlertsHeaderHub({
  snap,
}: {
  snap: SnapSlice<(typeof ALERT_FIELDS)[number]>;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [detectJournal, setDetectJournal] = useState(() => readLsBool(EXO_ALERT_DETECT_JOURNAL_LS, true));
  const [detectFeeder, setDetectFeeder] = useState(() => readLsBool(EXO_ALERT_DETECT_FEEDER_LS, true));
  const [dismissed, setDismissed] = useState(() => readExoAlertDismissals());
  const [ackEpoch, setAckEpoch] = useState(0);

  // `ackEpoch` is the re-read trigger: the ids live in localStorage, and bumping it re-reads them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ackIds = useMemo(() => readExoAlertAckIds(), [ackEpoch]);

  // Keyed on the fields it reads, not the whole snapshot (UI review P3): a fuel-only push used to
  // re-collect the alerts from every body. Unchanged fields keep their identity (reuseUnchanged).
  const collected = useMemo(() => {
    if (snap.journalBoot) return [];
    return collectExoDataAlertsFromSnapshot(snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.journalBoot, snap.bodies, snap.exoOverlayFocusBody, snap.sharedExomastery]);

  const filteredBySource = useMemo(
    () => collected.filter((a) => (a.detectionSource === "exomastery" ? detectFeeder : detectJournal)),
    [collected, detectJournal, detectFeeder],
  );

  const visible = useMemo(
    () => filteredBySource.filter((a) => !dismissed.has(a.id)),
    [filteredBySource, dismissed],
  );

  const hasUnread = useMemo(
    () => visible.length > 0 && visible.some((a) => !ackIds.has(a.id)),
    [visible, ackIds],
  );

  const topSeverity = useMemo(() => {
    if (visible.some((a) => a.severity === "error")) return "error";
    if (visible.some((a) => a.severity === "warning")) return "warning";
    return null;
  }, [visible]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(EXO_DATA_ALERT_DISMISS_LS, JSON.stringify([...next]));
      } catch {
        /* ignore quota */
      }
      return next;
    });
  }, []);

  const runScan = useCallback(async () => {
    if (snap.journalBoot) return;
    if (!detectJournal && !detectFeeder) return;
    try {
      applyExoDataScanSourceClear(detectJournal, detectFeeder);
      setDismissed(readExoAlertDismissals());
      setAckEpoch((e) => e + 1);
      if (detectFeeder) {
        const r = await fetch("/api/exomastery/reload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const j = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed.");
    }
  }, [detectJournal, detectFeeder, snap.journalBoot, toast]);

  // The switches and "Show dismissed again" live in Options › Exobiology now (2026-10-23).
  useEffect(() => {
    const sources = () => {
      setDetectJournal(readLsBool(EXO_ALERT_DETECT_JOURNAL_LS, true));
      setDetectFeeder(readLsBool(EXO_ALERT_DETECT_FEEDER_LS, true));
    };
    const rescan = () => void runScan();
    window.addEventListener(EXO_ALERT_SOURCES_EVENT, sources);
    window.addEventListener(EXO_ALERT_RESCAN_EVENT, rescan);
    return () => {
      window.removeEventListener(EXO_ALERT_SOURCES_EVENT, sources);
      window.removeEventListener(EXO_ALERT_RESCAN_EVENT, rescan);
    };
  }, [runScan]);

  const fix = useCallback(
    async (a: ExoDataAlertDTO) => {
      const fallbackClipboard = async () => {
        const text = (a.fixClipboard ?? `${a.title}\n${a.detail}`).trim();
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          window.prompt("Copy fix hints (clipboard unavailable):", text);
        }
      };
      if (a.speciesEntryId && a.genusDataDir) {
        try {
          const r = await fetch("/api/exo-data-alerts/fix", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alert: a }),
          });
          const j = (await r.json().catch(() => null)) as {
            ok?: boolean;
            written?: { root: string; relativePath: string }[];
            error?: string;
            notifyTarget?: "native" | "browser";
          } | null;
          if (!r.ok || !j?.ok) throw new Error(j?.error || r.statusText);
          if (j.notifyTarget === "native") return;
          const lines = (j.written ?? []).map((w) => `${w.relativePath}\n  (${w.root})`).join("\n\n");
          toast.success(
            lines
              ? `Fix stub written next to ${(j.written ?? []).length} source file(s); originals are untouched.`
              : "Fix stub written.",
          );
          return;
        } catch (e) {
          toast.error(
            e instanceof Error
              ? `${e.message}\n\nCopying hints to clipboard instead.`
              : "Fix failed; copying hints.",
          );
        }
      }
      await fallbackClipboard();
    },
    [toast],
  );

  const triggerClass = `exo-data-alerts-trigger btn-top-neutral${
    topSeverity === "error"
      ? " exo-data-alerts-trigger--error"
      : topSeverity === "warning"
        ? " exo-data-alerts-trigger--warn"
        : " exo-data-alerts-trigger--idle"
  }${hasUnread ? " exo-data-alerts-trigger--unread" : ""}`;
  const badgeCount = visible.length;

  let panelBody: ReactNode;
  if (snap.journalBoot) {
    panelBody = <p className="dim tiny">Journal loading…</p>;
  } else if (!detectJournal && !detectFeeder) {
    panelBody = (
      <p className="dim tiny">
        Both sources are off: switch them on in Options › Exobiology › Codex consistency alerts.
      </p>
    );
  } else if (visible.length > 0) {
    panelBody = (
      <div className="exo-data-alerts exo-data-alerts--in-popover" role="list">
        {visible.map((a) => (
          <div key={a.id} className={`exo-data-alert exo-data-alert--${a.severity}`} role="listitem">
            <span className={`exo-data-alert__icon exo-data-alert__icon--${a.severity}`} aria-hidden>
              {a.severity === "error" ? "!" : "⚠"}
            </span>
            <div className="exo-data-alert__text">
              <div className="exo-data-alert__meta">{a.bodyTabLabel}</div>
              <div className="exo-data-alert__title">{a.title}</div>
              <div className="exo-data-alert__detail">{a.detail}</div>
            </div>
            <div className="exo-data-alert__actions">
              <button
                type="button"
                className="exo-data-alert__btn"
                title="Append a fixes_*.json stub in your user data folder, where an update cannot replace it (never overwrites the original codex or exomastery file)."
                onClick={() => void fix(a)}
              >
                Fix
              </button>
              <button
                type="button"
                className="exo-data-alert__btn exo-data-alert__btn--secondary"
                onClick={() => dismiss(a.id)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  } else if (filteredBySource.length > 0) {
    panelBody = <p className="dim tiny">All alerts dismissed.</p>;
  } else if (collected.length > 0) {
    panelBody = (
      <p className="dim tiny">
        No alerts for the sources switched on in Options › Exobiology.
      </p>
    );
  } else {
    panelBody = <p className="dim tiny">No mismatches detected for loaded bodies.</p>;
  }

  // Hidden until there is something to show (owner, 2026-10-23); open stays open until closed.
  if (!visible.length && !open) return null;

  return (
    <div className="exo-data-alerts-header-wrap">
      {/* Opened, placed and closed by ui/Popover (Radix): focus in and back, Escape, outside click. */}
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Opening marks the alerts on show as seen (the badge counts the unseen ones).
          if (next) {
            const merged = new Set(readExoAlertAckIds());
            for (const a of visible) merged.add(a.id);
            writeExoAlertAckIds(merged);
            setAckEpoch((e) => e + 1);
          }
          setOpen(next);
        }}
        label="Codex consistency alerts"
        className="exo-data-alerts-popover"
        // Right edge on the button's right edge, as it opened before; Radix shifts it in where needed.
        align="end"
        trigger={
          <button
            type="button"
            className={triggerClass}
            aria-label="Codex consistency alerts"
            title="Codex consistency: journal vs genus_new.json, and exo-feeder profiles vs codex. Notices are under the bell beside it."
          >
            <svg
              className="exo-data-alerts-trigger__mail"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            {topSeverity === "error" ? (
              <span className="exo-data-alerts-trigger__glyph exo-data-alerts-trigger__glyph--error" aria-hidden>
                !
              </span>
            ) : topSeverity === "warning" ? (
              <span className="exo-data-alerts-trigger__glyph exo-data-alerts-trigger__glyph--warn" aria-hidden>
                ⚠
              </span>
            ) : null}
          </button>
        }
      >
        {panelBody}
      </Popover>
      {/* Beside the button, not in it: its cut corner (clip-path) clipped the number (owner, 2026-10-11). */}
      {badgeCount > 0 ? (
        <span className="exo-data-alerts-trigger__badge" aria-hidden>
          {badgeCount}
        </span>
      ) : null}
    </div>
  );
});
