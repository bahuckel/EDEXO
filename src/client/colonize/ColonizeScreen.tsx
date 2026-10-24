/**
 * The Colonize window (`?screen=colonize`, 1.3.0): your construction sites, the haul plan, where to buy. Its own
 * window from the launcher's "Open Colonize", beside the main app; one server underneath (src/server/colonize).
 *
 * Plan opens first (owner, 2026-10-18: "Sites + haul plan"); Search, Sources and Wing are a tab away.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { withTransition } from "../motion";
import "./colonize.css";
import "./cards.css";
import { depotDisplayLabel } from "../../shared/colonize/depotLabel";
import { formatTons } from "../../shared/colonize/formatPrice";
import { onGalaxyDrawerLinkClick } from "../galaxyDrawerRequest";
import { colonizeReadOnly, useColonizeAppState } from "./api";
import { AppLegalFooter } from "../AppLegalFooter";
import { HeaderBar } from "../HeaderBar";
import { HexSignals } from "../HexSignals";
import { TabHost } from "../tabs/TabHost";
import { UiFeedbackProvider } from "../ui/feedback";
import { tabListKeyDown } from "../ui/Tabs";
import { useLiveSnapshot } from "../useLiveSnapshot";
import { STREAMER_MODE } from "../streamerMode";
import { PhoneView } from "./views/PhoneView";
import { loadColonizeUiState, onRemoteUiState } from "./uiStateSync";
import { adoptSavedPlanOnNextMount } from "./planner/hooks/useLogisticsPlan";
import { LoadingNote } from "../ui/Loading";
import { AppStateProvider } from "./state/AppStateContext";
import { useColonize, type ColonizeModel } from "./useColonize";
import { PlanView } from "./views/PlanView";
import { SearchView } from "./views/SearchView";
import { SourcesView } from "./views/SourcesView";
import { WingView } from "./views/WingView";
import { BTN, BTN_GO, BTN_LINK } from "./views/ui";

type Tab = "plan" | "search" | "sources" | "wing";
const TABS: { key: Tab; label: string }[] = [
  { key: "plan", label: "Plan" },
  { key: "search", label: "Search" },
  { key: "sources", label: "Sources" },
  { key: "wing", label: "Wing" },
];
const TAB_KEY = "edexo.colonize.tab";

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.key === t) ? (t as Tab) : "plan";
  } catch {
    return "plan";
  }
}

/**
 * Draws once the server's copy of the settings and progress is in this browser (uiStateSync.ts), so the first paint
 * already has the trip ticks another window made. Another window's later saves redraw the window at once when it is
 * not in front; in front, a note offers to, so nothing moves under the commander's cursor.
 */
export function ColonizeScreen() {
  if (STREAMER_MODE) return <PhoneScreen streamer />;
  return colonizeReadOnly() ? <PhoneScreen /> : <PcScreen />;
}

/**
 * A paired phone or tablet, or the streamer view (`&view=stream`, owner 2026-10-22: an OBS Browser source on this PC):
 * the read-only view (PhoneView.tsx) on the server's copy of the plan. The streamer view saves nothing either, so the
 * stream never changes the commander's settings.
 */
function PhoneScreen({ streamer = false }: { streamer?: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    document.title = streamer ? "EDEXO Colonize — streamer view" : "EDEXO Colonize";
    void loadColonizeUiState({ readOnly: true }).finally(() => setReady(true));
  }, [streamer]);
  return ready ? <PhoneView streamer={streamer} /> : <LoadingNote className="screen-loading" />;
}

function PcScreen() {
  const [ready, setReady] = useState(false);
  const [gen, setGen] = useState(0);
  const [remote, setRemote] = useState(false);
  useEffect(() => {
    let live = true;
    void loadColonizeUiState().finally(() => live && setReady(true));
    const off = onRemoteUiState(() => {
      if (document.hasFocus()) setRemote(true);
      else {
        adoptSavedPlanOnNextMount();
        setGen((g) => g + 1);
      }
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  const redraw = useCallback(() => {
    adoptSavedPlanOnNextMount();
    setRemote(false);
    setGen((g) => g + 1);
  }, []);
  if (!ready) return <LoadingNote className="screen-loading" />;
  /*
    Compare's shell (owner, 2026-10-22: "the same quality and feel"): its feedback (toasts, confirms) and background.
    Compare's live snapshot is read above the redraw's key (audit 2026-10-22): inside it, every "Show the changes" (and
    every save another window made while this one was behind) closed the socket and loaded the full snapshot twice
    over, 0.8-10 MB each, to draw the same header.
  */
  return (
    <UiFeedbackProvider>
      <HexSignals />
      <LiveSnapshotFeed>
        <AppStateProvider key={gen}>
          <ColonizeApp remoteChange={remote ? redraw : null} />
        </AppStateProvider>
      </LiveSnapshotFeed>
    </UiFeedbackProvider>
  );
}

type LiveSnapshot = ReturnType<typeof useLiveSnapshot>;
const LiveSnapshotContext = createContext<LiveSnapshot>({ snapshot: null, connected: false });

/**
 * Compare's live snapshot for the shared header, handed down by context to ColonizeShell alone. A push re-renders
 * this and the shell; its `children` were made by PcScreen, so React leaves them (and the Colonize views) be.
 */
function LiveSnapshotFeed({ children }: { children: ReactNode }) {
  const { snapshot, connected } = useLiveSnapshot();
  const live = useMemo(() => ({ snapshot, connected }), [snapshot, connected]);
  return <LiveSnapshotContext.Provider value={live}>{children}</LiveSnapshotContext.Provider>;
}

const noop = () => undefined;

function ColonizeApp({ remoteChange }: { remoteChange: (() => void) | null }) {
  const m = useColonize();
  const [tab, setTabState] = useState<Tab>(readTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* the tab is remembered for this session */
    }
  };
  useEffect(() => {
    document.title = "EDEXO Colonize";
  }, []);

  const snap = m.snap;
  /*
    The views, as an element for the shell to place. Made here, so a Compare push or a colonize-socket frame, which
    re-render only ColonizeShell, finds the same element and skips the whole Colonize tree (audit 2026-10-22: Plan,
    the sites and the trips were drawn again 1-4 times a second while flying). They redraw when Colonize's own
    state does.
  */
  return (
    <ColonizeShell m={m}>
      <div className="cz cz--in-shell">
      {/* The app's keyboard for an option strip (ui/Tabs.tsx): one Tab stop, the arrows move and choose. */}
      <nav className="cz-tabs" role="tablist" aria-label="Colonize sections" onKeyDown={(ev) => tabListKeyDown(ev, { follow: true })}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className={`tab${tab === t.key ? " on" : ""}`}
            aria-selected={tab === t.key}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => withTransition(() => setTab(t.key))}
          >
            {t.label}
            {t.key === "wing" && (snap?.wingRoster.length ?? 0) > 0 ? (
              <span className="cz-tab__count">{snap?.wingRoster.length}</span>
            ) : null}
          </button>
        ))}
      </nav>
      {remoteChange ? (
        <div className="cz-main cz-main--note">
          <div className="cz-note cz-note--info" role="status">
            <span className="cz-note__text">Another window changed your plan or settings.</span>
            <button type="button" className={BTN} onClick={remoteChange}>
              Show the changes
            </button>
          </div>
        </div>
      ) : null}
      {m.inaraNotice ? (
        <div className="cz-main cz-main--note">
          <div className="cz-note cz-note--info" role="status">
            <span className="cz-note__text">{m.inaraNotice}</span>
            <button type="button" className={BTN_LINK} onClick={m.dismissInaraNotice}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      <main className="cz-main">
        {/*
          The Plan tab stays mounted behind the others (discuss item 14): switching back is instant and the HUD's next
          stop stays current; its background Spansh looks pause while another tab is shown (PlanView `shown`).
        */}
        <div hidden={tab !== "plan"} className="cz-tabpane">
          <PlanView m={m} shown={tab === "plan"} />
        </div>
        {tab === "search" ? <SearchView m={m} /> : null}
        {tab === "sources" ? <SourcesView m={m} /> : null}
        {tab === "wing" ? <WingView m={m} /> : null}
        {snap?.lastError ? (
          <p className="cz-note cz-note--bad" role="alert" style={{ marginTop: 16 }}>
            {snap.lastError}
          </p>
        ) : null}
      </main>
      </div>
    </ColonizeShell>
  );
}

/**
 * Compare's app bar and footer around the Colonize views, with Colonize's tray in the bar. The only part that reads
 * Compare's live snapshot and the colonize socket's app state, so their frequent changes redraw this and the header,
 * and not the views it is given as `children`.
 */
function ColonizeShell({ m, children }: { m: ColonizeModel; children: ReactNode }) {
  const live = useContext(LiveSnapshotContext);
  const app = useColonizeAppState();
  const snap = m.snap;
  const docked = snap?.liveDocked ?? null;
  // At one of your sites, its short name ("Hammond Port"), not the game's "Orbital Construction Site: Hammond Port".
  const dockedSite = docked ? snap?.activeDepots.find((d) => d.marketId === docked.marketId) : undefined;
  const where = docked?.stationName
    ? { k: "Docked", v: dockedSite ? depotDisplayLabel(dockedSite) : docked.stationName, sub: docked.starSystem ?? "" }
    : { k: "You", v: snap?.navContext.starSystem ?? app.state.currentSystem ?? "…", sub: "" };
  const sellers = m.stations.checkoutBundle?.plans.reduce((n, p) => n + (p.catalogStations?.length ?? 0), 0) ?? 0;

  /* Colonize's tray, under the shared app bar: where the ship is, the hold, carriers, sellers, the site finder. */
  const tray = (
      <div className="cz cz-tray">
        <div className="cz-chips">
          <span className={`cz-chip${docked?.stationName ? " cz-chip--info" : ""}`}>
            <span className="cz-chip__k">{where.k}</span>
            <b className="cz-chip__v">{where.v}</b>
            {where.sub ? <span className="cz-chip__s">{where.sub}</span> : null}
          </span>
          <HoldChip m={m} />
          {m.carriers.map((c) => {
            const on = m.haulingCarrierIds.has(c.carrierId);
            const tons = c.reportedTons ?? Object.values(c.tonsByCommodity).reduce((a, b) => a + b, 0);
            return (
              <button
                key={c.carrierId}
                type="button"
                className={`cz-chip${on ? " cz-chip--info" : " cz-chip--off"}`}
                aria-pressed={on}
                title={on ? "Its stock counts as yours in the plan" : "Click to count its stock in the plan"}
                onClick={() => m.toggleCarrier(c.carrierId)}
              >
                <span className="cz-chip__k">{on ? "✓ Carrier" : "Carrier"}</span>
                <b className="cz-chip__v">{c.callsign || c.name}</b>
                <span className="cz-chip__s">{formatTons(tons)}</span>
              </button>
            );
          })}
        </div>
        <div className="cz-head__right">
          {!app.connected ? <span className="cz-small cz-warn">Reconnecting…</span> : null}
          {snap?.replayBusy ? <span className="cz-small cz-dim">Reading your journals…</span> : null}
          <span className="cz-small cz-dim">
            {/* The markets in the journal count too: the plan buys there first (2026-10-22: "No sellers known yet" over
                a plan buying at them). */}
            {[sellers ? `${sellers} sellers saved` : "", m.shopHistory.length ? `${m.shopHistory.length} markets in your journal` : ""]
              .filter(Boolean)
              .join(" · ") || "No sellers known yet"}
          </span>
          <a className={BTN_GO} href="/?screen=galaxy&drawer=finder" target="_blank" rel="noreferrer" onClick={onGalaxyDrawerLinkClick("finder")}>
            Find colony sites <span aria-hidden="true">›</span>
          </a>
        </div>
      </div>
  );

  if (!live.snapshot) {
    return (
      <div className="app-shell">
        <div className="panel load">Connecting to journal service…</div>
        <AppLegalFooter />
      </div>
    );
  }

  return (
    <TabHost>
    <div className="app-shell">
      <HeaderBar
        app="colonize"
        snap={live.snapshot}
        connected={live.connected}
        encyclopediaSpawnCompare={null}
        onOpenSystemMap={noop}
        trayContent={tray}
        trayLabel="where you are, the hold, your carriers and the sellers known"
      />
      {children}
      <AppLegalFooter />
    </div>
    </TabHost>
  );
}

/** The hold: what is aboard and the capacity, which can be typed in when the game has not said it. */
function HoldChip({ m }: { m: ReturnType<typeof useColonize> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (editing) {
    return (
      <form
        className="cz-chip"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Math.round(Number(draft));
          m.setCapacity(draft.trim() && Number.isFinite(n) && n > 0 ? n : null);
          setEditing(false);
        }}
      >
        <label className="cz-chip__k" htmlFor="cz-cap">
          Hold size
        </label>
        <input
          id="cz-cap"
          className="cz-input"
          inputMode="numeric"
          size={5}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          placeholder={String(m.snap?.shipCargoCapacity ?? "")}
        />
        <span className="cz-chip__k">t (empty: the game's)</span>
      </form>
    );
  }
  return (
    <button
      type="button"
      className="cz-chip"
      title="Your hold. Click to set its size when the game has not reported it."
      onClick={() => {
        setDraft(m.manualCapacity != null ? String(m.manualCapacity) : "");
        setEditing(true);
      }}
    >
      <span className="cz-chip__k">Hold</span>
      <b className="cz-chip__v cz-num">
        {m.cargoOnHand.toLocaleString("en-US")} / {m.capacity != null ? `${m.capacity.toLocaleString("en-US")} t` : "? t"}
      </b>
    </button>
  );
}
