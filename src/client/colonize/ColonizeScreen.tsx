/**
 * The Colonize window (`?screen=colonize`, 1.3.0): your construction sites, the haul plan, where to buy. Its own
 * window from the launcher's "Open Colonize", beside the main app; one server underneath (src/server/colonize).
 *
 * Plan opens first (owner, 2026-10-18: "Sites + haul plan"); Search, Sources and Wing are a tab away.
 */
import { useEffect, useState } from "react";
import "./colonize.css";
import { depotDisplayLabel } from "../../shared/colonize/depotLabel";
import { useColonizeAppState } from "./api";
import { loadColonizeUiState, onRemoteUiState } from "./uiStateSync";
import { LoadingNote } from "../ui/Loading";
import { AppStateProvider } from "./state/AppStateContext";
import { useColonize } from "./useColonize";
import { PlanView } from "./views/PlanView";
import { SearchView } from "./views/SearchView";
import { SourcesView } from "./views/SourcesView";
import { WingView } from "./views/WingView";

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
  const [ready, setReady] = useState(false);
  const [gen, setGen] = useState(0);
  const [remote, setRemote] = useState(false);
  useEffect(() => {
    let live = true;
    void loadColonizeUiState().finally(() => live && setReady(true));
    const off = onRemoteUiState(() => {
      if (document.hasFocus()) setRemote(true);
      else setGen((g) => g + 1);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  if (!ready) return <LoadingNote className="screen-loading" />;
  const redraw = () => {
    setRemote(false);
    setGen((g) => g + 1);
  };
  return (
    <AppStateProvider key={gen}>
      <ColonizeApp remoteChange={remote ? redraw : null} />
    </AppStateProvider>
  );
}

function ColonizeApp({ remoteChange }: { remoteChange: (() => void) | null }) {
  const m = useColonize();
  const app = useColonizeAppState();
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
    document.title = "Colonize — ED Exo Compare";
  }, []);

  const snap = m.snap;
  const docked = snap?.liveDocked ?? null;
  // At one of your sites, its short name ("Hammond Port"), not the game's "Orbital Construction Site: Hammond Port".
  const dockedSite = docked ? snap?.activeDepots.find((d) => d.marketId === docked.marketId) : undefined;
  const where = docked?.stationName
    ? { k: "Docked", v: dockedSite ? depotDisplayLabel(dockedSite) : docked.stationName, sub: docked.starSystem ?? "" }
    : { k: "You", v: snap?.navContext.starSystem ?? app.state.currentSystem ?? "…", sub: "" };
  const sellers = m.stations.checkoutBundle?.plans.reduce((n, p) => n + (p.catalogStations?.length ?? 0), 0) ?? 0;

  return (
    <div className="cz">
      <header className="cz-head">
        <div className="cz-brand">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <path d="M14 2 25 8.5v11L14 26 3 19.5v-11Z" fill="none" stroke="var(--hud)" strokeWidth="2" />
            <path d="M14 8v12M9 11l5-3 5 3" fill="none" stroke="var(--hud-hi)" strokeWidth="1.6" />
          </svg>
          EDEXO <span className="cz-brand__tag">COLONIZE</span>
        </div>
        <div className="cz-chips">
          <span className={`cz-chip${docked?.stationName ? " cz-chip--info" : ""}`}>
            <span className="cz-chip__k">{where.k}</span>
            <b>{where.v}</b>
            {where.sub ? <span className="cz-chip__k">{where.sub}</span> : null}
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
                {on ? "✓ " : ""}Carrier {c.callsign || c.name} · {tons.toLocaleString("en-US")} t
              </button>
            );
          })}
        </div>
        <div className="cz-head__right">
          {!app.connected ? <span className="cz-small" style={{ color: "var(--warn)" }}>Reconnecting…</span> : null}
          {snap?.replayBusy ? <span className="cz-small cz-dim">Reading your journals…</span> : null}
          <span className="cz-small cz-dim">{sellers ? `${sellers} sellers known` : "No sellers known yet"}</span>
          <a className="cz-btn" href="/?screen=galaxy&drawer=finder" target="_blank" rel="noreferrer">
            Find colony sites <span aria-hidden="true">›</span>
          </a>
        </div>
      </header>
      <nav className="cz-tabs" role="tablist" aria-label="Colonize sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className="cz-tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "wing" && (snap?.wingRoster.length ?? 0) > 0 ? (
              <span className="cz-tab__count">{snap?.wingRoster.length}</span>
            ) : null}
          </button>
        ))}
      </nav>
      {remoteChange ? (
        <div className="cz-main" style={{ paddingBottom: 0 }}>
          <div className="cz-note cz-note--info" role="status">
            <span className="cz-note__text">Another window changed your plan or settings.</span>
            <button type="button" className="cz-btn" onClick={remoteChange}>
              Show the changes
            </button>
          </div>
        </div>
      ) : null}
      {m.inaraNotice ? (
        <div className="cz-main" style={{ paddingBottom: 0 }}>
          <div className="cz-note cz-note--info" role="status">
            <span className="cz-note__text">{m.inaraNotice}</span>
            <button type="button" className="cz-btn cz-btn--quiet" onClick={m.dismissInaraNotice}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      <main className="cz-main">
        {tab === "plan" ? <PlanView m={m} /> : null}
        {tab === "search" ? <SearchView m={m} /> : null}
        {tab === "sources" ? <SourcesView m={m} /> : null}
        {tab === "wing" ? <WingView m={m} /> : null}
        {snap?.lastError ? (
          <p className="cz-note cz-note--bad" role="alert" style={{ marginTop: 16 }}>
            {snap.lastError}
          </p>
        ) : null}
      </main>
      <footer className="cz-small cz-dim" style={{ padding: "16px 24px", textAlign: "center" }}>
        EDEXO is not affiliated with Frontier Developments.
      </footer>
    </div>
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
      <b className="cz-num">
        {m.cargoOnHand.toLocaleString("en-US")} / {m.capacity != null ? `${m.capacity.toLocaleString("en-US")} t` : "? t"}
      </b>
    </button>
  );
}
