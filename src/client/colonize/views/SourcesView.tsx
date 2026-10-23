/**
 * Where the cargo comes from, in three stacks (R5b, cards mockup P11; group names from discuss 15a): cargo you have
 * (your carriers, trade-party carriers), where sellers come from (seller data, Inara, markets you docked at), and keep
 * out / clean up (stations you never want, forgetting saved sellers). Three columns on a wide window, one on a phone,
 * with no holes under the short panels.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { carrierDisplayName, type CarrierStock } from "../../../shared/colonize/carrierStock";
import type { ClearBuyDataScope } from "../../../shared/colonize/buyIndexClear";
import { formatHopLy } from "../../../shared/colonize/systemDistanceLy";
import { errText, formatPrice, formatTons as t } from "../../../shared/colonize/formatPrice";
import { formatMarketAge } from "../../../shared/colonize/marketAge";
import { IDLE_MATERIAL_BUY_SCAN_STATUS } from "../../../shared/colonize/materialBuyScanStatus";
import {
  addPartyMember,
  loadTradeParty,
  normalizeCallsign,
  ordersForNeeds,
  removePartyMember,
  saveTradeParty,
  type PartyCarrier,
  type PartyMember,
} from "../../../shared/colonize/tradeParty";
import { inaraCommoditySearchUrl } from "../../../shared/colonize/inaraLinks";
import { openInEdexoBrowser } from "../inaraBrowser";
import type { ColonizeModel } from "../useColonize";
import { BTN, BTN_BAD, BTN_GO, BTN_LINK, BTN_WARN, Panel } from "./ui";


export function SourcesView({ m }: { m: ColonizeModel }) {
  return (
    <div className="cz-colstacks">
      <div className="cz-colstack">
        <div className="cz-colhead">Cargo you have</div>
        <CarriersPanel m={m} />
        <TradePartyPanel m={m} />
      </div>
      <div className="cz-colstack">
        <div className="cz-colhead">Where sellers come from</div>
        <SellerDataPanel m={m} />
        <InaraPanel m={m} />
        <HistoryPanel m={m} />
      </div>
      <div className="cz-colstack">
        <div className="cz-colhead">Keep out / clean up</div>
        <BansPanel m={m} />
        <ForgetPanel m={m} />
      </div>
    </div>
  );
}

/* ---- your carriers ---------------------------------------------------------------------------------------------- */

function CarriersPanel({ m }: { m: ColonizeModel }) {
  // What your sites still need, by commodity: a carrier says how much of it its cargo covers.
  const need = useMemo(() => new Map((m.summary?.rows ?? []).map((r) => [r.id, r.totalTonsNeeded])), [m.summary]);
  return (
    <Panel k="carriers" title="Your carriers" aside={<span className="cz-aside-note">{m.carriers.length || "none"}</span>}>
      <div className="cz-stack">
      <p className="cz-lead">
        What the journal saw moving on and off them. Switch one on and the plan counts its cargo as already bought.
      </p>
      {m.carriers.length ? (
        m.carriers.map((c) => (
          <CarrierCard key={c.carrierId} c={c} on={m.haulingCarrierIds.has(c.carrierId)} toggle={() => m.toggleCarrier(c.carrierId)} need={need} />
        ))
      ) : (
        <p className="cz-dim" style={{ margin: 0 }}>
          No carrier of yours in the journal yet. The game names your carrier each time you load in, and when you open its
          management screen.
        </p>
      )}
      </div>
    </Panel>
  );
}

function CarrierCard({ c, on, toggle, need }: { c: CarrierStock; on: boolean; toggle: () => void; need: Map<string, number> }) {
  // What your sites need first, then the rest, each biggest first.
  const lines = Object.entries(c.tonsByCommodity)
    .filter(([, n]) => n > 0)
    .sort((a, b) => Number(need.has(b[0])) - Number(need.has(a[0])) || b[1] - a[1]);
  const total = lines.reduce((a, [, n]) => a + n, 0);
  const covers = lines.reduce((a, [id, n]) => a + Math.min(n, need.get(id) ?? 0), 0);
  const useful = lines.filter(([id]) => need.has(id)).length;
  return (
    <article className={`cz-card cz-stack${on ? " cz-card--on" : ""}`} aria-label={carrierDisplayName(c)}>
      <div className="cz-cardhead">
        <div className="min0">
          <b>{carrierDisplayName(c)}</b>
          <div className="cz-small cz-dim">
            {c.callsign}
            {c.kind === "squadron" ? " · squadron carrier" : ""}
          </div>
        </div>
        {/* The plan's on/off button (was a checkbox): on, its cargo counts as already bought. */}
        <button type="button" className={`btn-top-toggle${on ? " btn-top-toggle--on" : ""}`} aria-pressed={on} onClick={toggle}>
          Use its cargo
        </button>
      </div>
      <div className="facts cz-facts3">
        <div className="fact">
          <span className="fact-k">{c.reportedTons != null ? "Aboard" : "Seen moving"}</span>
          <span className="fact-v">{t(c.reportedTons ?? total)}</span>
        </div>
        {c.capacityTons ? (
          <div className="fact">
            <span className="fact-k">Holds</span>
            <span className="fact-v">{t(c.capacityTons)}</span>
          </div>
        ) : null}
        <div className={`fact${covers > 0 ? " cz-fact--hot" : ""}`}>
          <span className="fact-k">Covers</span>
          <span className="fact-v">{t(covers)}</span>
        </div>
      </div>
      {lines.length ? (
        <details className="cz-fold">
          <summary>
            {lines.length} commodities{useful ? ` · ${useful} your sites need` : ""}
          </summary>
          <ul className="cz-list cz-num">
            {lines.map(([id, n]) => {
              const hot = need.has(id);
              return (
                <li key={id} className={hot ? "cz-li cz-li--hot" : "cz-li"}>
                  <span>{hot ? <b>{c.labels[id] ?? id}</b> : <span className="cz-soft">{c.labels[id] ?? id}</span>}</span>
                  <span className="cz-dim">{t(n)}</span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

/* ---- trade party: other commanders' carriers, by callsign ---------------------------------------------------------- */

const PARTY_POLL_MS = 5 * 60_000;

function TradePartyPanel({ m }: { m: ColonizeModel }) {
  const [members, setMembers] = useState<PartyMember[]>(() => loadTradeParty());
  const [carriers, setCarriers] = useState<Map<string, PartyCarrier>>(new Map());
  const [callsign, setCallsign] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const near = m.constructionSiteRefs[0]?.trim() || m.homeSystem || undefined;
  const needIds = useMemo(() => new Set((m.summary?.rows ?? []).map((r) => r.id)), [m.summary]);

  const save = (next: PartyMember[]) => {
    setMembers(next);
    saveTradeParty(next);
  };
  const callsigns = members.map((x) => x.callsign).join(",");
  const lookUp = useCallback(async () => {
    if (!callsigns) return;
    setBusy(true);
    setError(null);
    try {
      const res = await m.api.lookUpPartyCarriers({ callsigns: callsigns.split(","), referenceSystem: near });
      if (res.ok) setCarriers(new Map(res.carriers.map((c) => [c.callsign, c])));
      else setError(res.err);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }, [m.api, callsigns, near]);
  useEffect(() => {
    void lookUp();
    const id = window.setInterval(() => void lookUp(), PARTY_POLL_MS);
    return () => clearInterval(id);
  }, [lookUp]);

  const valid = normalizeCallsign(callsign) != null;
  return (
    <Panel
      k="party"
      title="Trade party"
      aside={
        members.length ? (
          <button type="button" className={BTN_LINK} disabled={busy} onClick={() => void lookUp()}>
            {busy ? "Looking…" : "Look again"}
          </button>
        ) : undefined
      }
    >
      <div className="cz-stack">
      <p className="cz-lead">Friends' carriers by callsign: where they are and what they sell, from Spansh (about 15 minutes behind).</p>
      <form
        className="cz-row"
        style={{ justifyContent: "flex-start", alignItems: "center", gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          save(addPartyMember(members, callsign, note));
          setCallsign("");
          setNote("");
        }}
      >
        <input className="cz-input" style={{ width: 110 }} aria-label="Callsign" placeholder="ABC-123" value={callsign} onChange={(e) => setCallsign(e.target.value)} />
        <input className="cz-input" style={{ flex: "1 1 140px" }} aria-label="Note" placeholder="whose it is (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit" className={BTN} disabled={!valid}>
          Add
        </button>
      </form>
      {error ? <p className="cz-note cz-note--bad">{error}</p> : null}
      {members.map((p) => {
        const c = carriers.get(p.callsign);
        const forUs = c ? ordersForNeeds(c, needIds) : [];
        return (
          <article key={p.callsign} className="cz-card cz-stack" aria-label={p.callsign}>
            <div className="cz-cardhead">
              <div className="min0">
                <b>{p.callsign}</b>
                {p.note ? <span className="cz-dim"> · {p.note}</span> : null}
                <div className="cz-small cz-dim">
                  {!c ? "looking…" : !c.found ? "Spansh has never seen this carrier" : (c.systemName ?? "somewhere")}
                </div>
              </div>
              <button type="button" className={BTN_LINK} onClick={() => save(removePartyMember(members, p.callsign))}>
                Remove
              </button>
            </div>
            {c?.found && (c.locationAt || c.marketAt) ? (
              <div className="cz-chiprow">
                {c.locationAt ? <span className="sys-chip sys-chip--ok">Seen {formatMarketAge(c.locationAt)}</span> : null}
                {c.marketAt ? <span className="sys-chip">Market {formatMarketAge(c.marketAt)}</span> : null}
              </div>
            ) : null}
            {forUs.length || (c?.found && c.systemName) ? (
              <div className="cz-mtiles">
                {c?.found && c.systemName ? (
                  <div className="fact">
                    <span className="fact-k">Dist</span>
                    <span className="fact-v">{formatHopLy(c.distanceLy)}</span>
                  </div>
                ) : null}
                {forUs.map((o) => (
                  <div key={o.commodityId} className="fact">
                    <span className="fact-k" title={o.label}>
                      {o.label}
                    </span>
                    <span className="fact-v cz-hi">
                      {t(o.tons)}
                      {o.price != null ? <small> {formatPrice(o.price)} cr</small> : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {!forUs.length && c?.found ? (
              <div className="cz-small cz-dim">
                {c.selling.length ? `Sells ${c.selling.length} things, none your sites need.` : "Sells nothing right now."}
              </div>
            ) : null}
          </article>
        );
      })}
      </div>
    </Panel>
  );
}

/* ---- seller data: Spansh scans ---------------------------------------------------------------------------------- */

function SellerDataPanel({ m }: { m: ColonizeModel }) {
  const s = m.materialBuyScanStatus ?? IDLE_MATERIAL_BUY_SCAN_STATUS;
  const running = [s.active, s.passive].find((q) => q.phase !== "idle");
  const ps = m.plannerSettings;
  return (
    <Panel k="seller-data" title="Seller data">
      <div className="cz-stack">
      <p className="cz-lead">Sellers come from every market you dock at, Spansh and your Inara imports; the plan uses all of them.</p>
      <div className="cz-note cz-note--info" role="status" style={{ margin: 0 }}>
        {running
          ? `${running.phase === "queued" ? "Waiting to look" : "Looking"} for ${running.commodityLabel ?? "sellers"}${running.referenceSystem ? ` near ${running.referenceSystem}` : ""}${running.total ? ` · ${running.done} of ${running.total}` : ""}`
          : s.passivePaused
            ? "Background look paused while a plan is being built."
            : "Not looking right now."}
      </div>
      {s.lastError ? <p className="cz-note cz-note--warn">{s.lastError}</p> : null}
      <div className="cz-actions">
        <button
          type="button"
          className={`btn-top-toggle${ps.liveSpanshScans ? " btn-top-toggle--on" : ""}`}
          aria-pressed={ps.liveSpanshScans}
          onClick={() => m.setPlannerSettings({ ...ps, liveSpanshScans: !ps.liveSpanshScans })}
        >
          Ask Spansh in the background
        </button>
      </div>
      <label className="cz-field">
        <span className="cz-soft">Stop after this many seller systems per material</span>
        <input
          className="cz-input"
          inputMode="numeric"
          style={{ width: 90 }}
          placeholder="no limit"
          value={ps.maxSystemsPerMaterial}
          onChange={(e) => m.setPlannerSettings({ ...ps, maxSystemsPerMaterial: e.target.value.replace(/[^\d]/g, "") })}
        />
      </label>
      <div>
        <button type="button" className={BTN_GO} disabled={m.stations.lookingBusy} onClick={m.stations.lookNow}>
          {m.stations.lookingBusy ? "Looking…" : "Look for sellers now"}
        </button>
      </div>
      </div>
    </Panel>
  );
}

/* ---- Inara imports ---------------------------------------------------------------------------------------------- */

function InaraPanel({ m }: { m: ColonizeModel }) {
  // The biggest needs first, for the quick links (summary rows are in the plan's order).
  const needs = useMemo(() => [...(m.summary?.rows ?? [])].sort((a, b) => b.totalTonsNeeded - a.totalTonsNeeded), [m.summary]);
  const near = m.constructionSiteRefs[0]?.trim() || m.homeSystem || m.snap?.navContext.starSystem || "";
  const [dir, setDir] = useState<{ dir: string; defaultDir: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void m.api
      .getInaraImportDir()
      .then((r) => {
        setDir(r);
        setDraft(r.dir);
      })
      .catch(() => {});
  }, [m.api]);

  const setFolder = async (value: string | null) => {
    try {
      const r = await m.api.setInaraImportDir(value);
      if (!r.ok) setMsg({ bad: true, text: r.err });
      else {
        setDir(r);
        setDraft(r.dir);
        setMsg({ bad: false, text: "Folder saved." });
      }
    } catch (e) {
      setMsg({ bad: true, text: errText(e) });
    }
  };
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const done: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const r = await m.api.importInaraFile({ fileName: f.name, text: await f.text() });
        done.push(r.ok ? `${r.commodityLabel} near ${r.nearSystem}: ${r.merged} sellers saved` : `${f.name}: ${r.err}`);
      } catch (e) {
        done.push(`${f.name}: ${errText(e)}`);
      }
    }
    setMsg({ bad: false, text: done.join(" · ") });
    if (file.current) file.current.value = "";
  };

  return (
    <Panel k="inara" title="Inara">
      <div className="cz-stack">
      <p className="cz-lead">
        Inara's commodity search opens in the EDEXO Browser. Run the search there, then “EDEXO — Read” in the pop-up on
        the page saves the sellers it shows. Only the page you opened is read; nothing is fetched behind your back.
      </p>
      <div className="cz-actions">
        {needs.slice(0, 3).map((r) => (
          <a
            key={r.id}
            className={BTN}
            href={inaraCommoditySearchUrl(r.label, near)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (openInEdexoBrowser(e.currentTarget.href)) e.preventDefault();
            }}
          >
            Inara: {r.label}
          </a>
        ))}
        {!needs.length ? (
          <a
            className={BTN}
            href={inaraCommoditySearchUrl("", near)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (openInEdexoBrowser(e.currentTarget.href)) e.preventDefault();
            }}
          >
            Open Inara's commodity search
          </a>
        ) : null}
      </div>
      <p className="cz-lead">Files from the Inara browser extension, or saved by hand, are read from this folder:</p>
      <form
        className="cz-row"
        style={{ justifyContent: "flex-start", alignItems: "center", gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void setFolder(draft.trim() || null);
        }}
      >
        <input className="cz-input" style={{ flex: "1 1 260px" }} aria-label="Import folder" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className={BTN} disabled={!dir || draft.trim() === dir.dir}>
          Save
        </button>
        {dir && dir.dir !== dir.defaultDir ? (
          <button type="button" className={BTN_LINK} onClick={() => void setFolder(null)}>
            Use default
          </button>
        ) : null}
      </form>
      <div className="cz-actions">
        <button type="button" className={BTN} onClick={() => void m.api.openInaraImportDir().catch(() => {})}>
          Open folder
        </button>
        <button type="button" className={BTN} onClick={() => file.current?.click()}>
          Import a file…
        </button>
        <input ref={file} type="file" accept=".json,.html,.htm,.txt" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
      </div>
      {msg ? <p className={`cz-note ${msg.bad ? "cz-note--bad" : "cz-note--info"}`}>{msg.text}</p> : null}
      </div>
    </Panel>
  );
}

/* ---- stations you never want ------------------------------------------------------------------------------------ */

function BansPanel({ m }: { m: ColonizeModel }) {
  return (
    <Panel k="bans" title="Never use" aside={<span className="cz-aside-note">{m.bannedStations.length || "none"}</span>}>
      {m.bannedStations.length ? (
        <ul className="cz-list">
          {m.bannedStations.map((b) => (
            <li key={`${b.systemName}|${b.stationName}`}>
              <span>
                <b>{b.stationName}</b> <span className="cz-small cz-dim">{b.systemName}</span>
              </span>
              <button type="button" className={BTN_LINK} onClick={() => m.stations.unban(b.systemName, b.stationName)}>
                Allow again
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cz-dim" style={{ margin: 0 }}>
          No station banned. “Never use this station” on a trip or in Search puts one here.
        </p>
      )}
    </Panel>
  );
}

/* ---- markets you bought at ------------------------------------------------------------------------------------- */

function HistoryPanel({ m }: { m: ColonizeModel }) {
  const [all, setAll] = useState(false);
  const rows = useMemo(() => [...m.shopHistory].sort((a, b) => b.visitedAt.localeCompare(a.visitedAt)), [m.shopHistory]);
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <Panel k="history" title="Markets you docked at" aside={<span className="cz-aside-note">{rows.length || "none"}</span>}>
      <div className="cz-stack">
      <p className="cz-lead">From the journal. The plan prefers these when their prices are still fresh.</p>
      {rows.length ? (
        <ul className="cz-list">
          {shown.map((h) => (
            <li key={`${h.systemName}|${h.stationName}`} className="cz-histrow">
              <span className="min0">
                <b className="ell">{h.stationName}</b>
                <span className="cz-small cz-dim ell">{h.systemName}</span>
              </span>
              <span className="cz-small cz-dim cz-num" title={h.visitedAt.slice(0, 10)}>
                {h.constructionDistanceLy != null ? `${formatHopLy(h.constructionDistanceLy)} · ` : ""}
                {h.purchases?.length ? `bought ${h.purchases.length}× · ` : ""}
                {h.visitedAt.slice(5, 10)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cz-dim" style={{ margin: 0 }}>
          None yet.
        </p>
      )}
      {rows.length > 10 ? (
        <button type="button" className={BTN} style={{ alignSelf: "flex-start" }} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      ) : null}
      </div>
    </Panel>
  );
}

/* ---- forgetting saved sellers ---------------------------------------------------------------------------------- */

const SCOPES: { scope: ClearBuyDataScope; label: string; what: string }[] = [
  { scope: "spansh", label: "Spansh results", what: "Sellers saved from Spansh. The plan asks again." },
  { scope: "inara", label: "Inara imports", what: "Sellers from imported Inara files." },
  { scope: "visited", label: "Markets you docked at", what: "Your station history and its saved prices." },
  { scope: "all", label: "Everything", what: "All of the above, and the saved plan." },
];

function ForgetPanel({ m }: { m: ColonizeModel }) {
  const [armed, setArmed] = useState<ClearBuyDataScope | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Panel k="forget" title="Forget saved sellers" className="cz-panel--quiet">
      <div className="cz-stack">
        {SCOPES.map((s) => (
          <div key={s.scope} className="cz-row" style={{ alignItems: "center" }}>
            <span>
              <b>{s.label}</b>
              <div className="cz-small cz-dim">{s.what}</div>
            </span>
            {armed === s.scope ? (
              <span style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className={BTN_BAD}
                  onClick={() => {
                    setArmed(null);
                    void m
                      .clearSavedBuyData(s.scope)
                      .then((r) => setMsg(r.ok ? `Forgot ${s.label.toLowerCase()}.` : r.err))
                      .catch((e: unknown) => setMsg(errText(e)));
                  }}
                >
                  Forget
                </button>
                <button type="button" className={BTN_LINK} onClick={() => setArmed(null)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className={BTN_WARN} onClick={() => setArmed(s.scope)}>
                Forget…
              </button>
            )}
          </div>
        ))}
        {msg ? <p className="cz-note cz-note--info">{msg}</p> : null}
      </div>
    </Panel>
  );
}
