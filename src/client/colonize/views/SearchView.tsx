/**
 * Search: one box, three kinds — a commodity (a comma means "sells all of them"), a system, a construction site.
 * Results come from every source together (Spansh, your Inara imports, markets you docked at); a station opens its
 * market, with what your sites still need marked.
 */
import { useEffect, useMemo, useState } from "react";
import type { BuyIndexStationMaterial, BuyIndexStationResult } from "../../../shared/colonize/buyIndexSearchTypes";
import { RAVEN_COLONIAL_SITE, type ConstructionSiteHit, type SiteNeeds } from "../../../shared/colonize/siteLookup";
import { resolveSearchHopLy } from "../../../shared/colonize/searchDistanceLy";
import { formatHopLy } from "../../../shared/colonize/systemDistanceLy";
import { errText, formatPrice, formatTons } from "../../../shared/colonize/formatPrice";
import { commodityMergeBucket } from "../../../shared/colonize/commodityKey";
import type { ColonizeModel } from "../useColonize";
import { BTN, BTN_BAD, BTN_GO, Fact, Panel, copyText } from "./ui";

type Kind = "commodity" | "system" | "site";
const KINDS: { k: Kind; label: string; hint: string }[] = [
  { k: "commodity", label: "Commodity", hint: "Steel, Aluminium" },
  { k: "system", label: "System", hint: "a system name" },
  { k: "site", label: "Construction site", hint: "part of the station's name" },
];

export function SearchView({ m }: { m: ColonizeModel }) {
  const [kind, setKind] = useState<Kind>("commodity");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stations, setStations] = useState<BuyIndexStationResult[] | null>(null);
  const [sites, setSites] = useState<ConstructionSiteHit[] | null>(null);
  const [picked, setPicked] = useState<BuyIndexStationResult | null>(null);
  const [pickedSite, setPickedSite] = useState<ConstructionSiteHit | null>(null);
  const api = m.api;
  const near = m.constructionSiteRefs[0]?.trim() || m.homeSystem || m.snap?.navContext.starSystem || "";

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setPicked(null);
    setPickedSite(null);
    try {
      if (kind === "site") {
        const res = await api.searchConstructionSites({ query: q, referenceSystem: near || undefined });
        if (res.ok) setSites(res.sites);
        else setError(res.err);
        setStations(null);
      } else {
        const res =
          kind === "commodity" ? await api.searchBuyIndexStationsForMaterials({ query: q }) : await api.searchBuyIndexSystem({ query: q });
        if (res.ok) {
          setStations(res.stations);
          m.setSearchDistanceTargets([...new Set(res.stations.map((s) => s.systemName))]);
        } else setError(res.err);
        setSites(null);
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  /** Commodity mode: Spansh's sellers near a site (or where the ship is), saved with the rest, then searched again. */
  const askSpanshForCommodity = async () => {
    const q = query.trim();
    if (!q || !near) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.askSpanshForMaterials({ query: q, referenceSystem: near });
      if (!res.ok) {
        setError(res.err);
        return;
      }
      setNotice(res.saved ? `Spansh: ${res.saved.toLocaleString("en-US")} sellers near ${near} saved.` : `Spansh knows no seller of that near ${near}.`);
      const again = await api.searchBuyIndexStationsForMaterials({ query: q });
      if (again.ok) {
        setStations(again.stations);
        m.setSearchDistanceTargets([...new Set(again.stations.map((s) => s.systemName))]);
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const askSpanshForSystem = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.debugSpanshSystem({ systemName: q, includeStationMarkets: false });
      if (!res.ok) {
        setError(res.err ?? "Spansh did not answer.");
        return;
      }
      const sys = (res.resolvedSystem ?? q).trim();
      const saved = typeof res.buyIndexRowsSaved === "number" ? res.buyIndexRowsSaved : 0;
      setNotice(saved > 0 ? `Saved ${saved.toLocaleString("en-US")} offers from ${sys}.` : `Spansh knows no market in ${sys} that sells to commanders.`);
      const again = await api.searchBuyIndexSystem({ query: sys });
      if (again.ok) setStations(again.stations);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const hint = KINDS.find((x) => x.k === kind)?.hint ?? "";
  return (
    <div className="cz-stack" style={{ gap: 18 }}>
      <form className="cz-row" style={{ alignItems: "center", justifyContent: "flex-start", gap: 12 }} onSubmit={run}>
        <div className="cz-kinds" role="tablist" aria-label="Search for">
          {KINDS.map((x) => (
            <button
              key={x.k}
              type="button"
              role="tab"
              className={`tab${kind === x.k ? " on" : ""}`}
              aria-selected={kind === x.k}
              onClick={() => {
                setKind(x.k);
                setStations(null);
                setSites(null);
                setPicked(null);
                setPickedSite(null);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        <label style={{ flex: "1 1 360px", display: "flex" }}>
          <span className="sr-only" style={{ position: "absolute", left: -9999 }}>
            {KINDS.find((x) => x.k === kind)?.label}
          </span>
          <input className="cz-input cz-input--big" type="search" value={query} placeholder={hint} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button type="submit" className={BTN_GO} disabled={busy || !query.trim()}>
          {busy ? "Searching…" : "Search"}
        </button>
        {kind === "system" ? (
          <button type="button" className={BTN} disabled={busy || !query.trim()} onClick={() => void askSpanshForSystem()}>
            Ask Spansh for its markets
          </button>
        ) : null}
        {kind === "commodity" ? (
          <button
            type="button"
            className={BTN}
            disabled={busy || !query.trim() || !near}
            title={near ? undefined : "No system to search near yet: a site, or one jump"}
            onClick={() => void askSpanshForCommodity()}
          >
            {near ? `Ask Spansh near ${near}` : "Ask Spansh"}
          </button>
        ) : null}
      </form>
      {kind === "commodity" ? (
        <p className="cz-small cz-dim" style={{ margin: 0 }}>
          A comma means “sells all of them”. Your journal first (where you bought it, where you docked), then saved
          Spansh results and Inara imports.
        </p>
      ) : null}
      {error ? <p className="cz-note cz-note--bad" role="alert">{error}</p> : null}
      {notice ? <p className="cz-note cz-note--info" role="status">{notice}</p> : null}

      <div className="cz-cols">
        {stations ? (
          <div className="cz-wide">
          <Panel
            k="search-stations"
            title="Stations"
            className="cz-panel--flush"
            aside={<span className="cz-aside-note">{stations.length ? `${stations.length} found` : "none found"}</span>}
          >
            {stations.length ? (
              <div className="cz-table-wrap">
                <table className="cz-table">
                  <thead>
                    <tr>
                      <th scope="col" style={{ paddingLeft: 16 }}>
                        Station
                      </th>
                      <th scope="col" className="r">
                        Distance
                      </th>
                      <th scope="col" className="r">
                        Matches
                      </th>
                      <th scope="col">Kind</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stations.map((s) => (
                      <tr key={`${s.systemName}|${s.stationName}`} className={picked === s ? "is-picked" : undefined}>
                        <td style={{ paddingLeft: 16 }}>
                          <button type="button" className="cz-pick" onClick={() => setPicked(s)}>
                            {s.stationName}
                          </button>
                          <div className="cz-small cz-dim">
                            {s.systemName}
                            {s.boughtCount ? <span className="cz-own">{` · bought here ${s.boughtCount}×`}</span> : null}
                            {!s.boughtCount && s.lastVisitIso ? ` · docked ${s.lastVisitIso.slice(0, 10)}` : null}
                          </div>
                        </td>
                        {/* From your sites, by site-to-seller pair: the map has no plain names, so a name always missed (audit 2026-10-22). */}
                        <td className="r">{formatHopLy(resolveSearchHopLy(s.systemName, m.constructionSiteRefs, m.systemDistanceLy, s.minDistanceLy))}</td>
                        <td className="r">{s.materialCount}</td>
                        <td className="cz-small cz-dim">
                          {s.stationType ?? ""}
                          {s.isPlanetaryOrGround ? " · planet port" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="cz-dim cz-pad">
                Nothing in your journal or the saved sellers matches. {kind === "system" ? "Ask Spansh for its markets." : near ? `Ask Spansh near ${near}.` : ""}
              </p>
            )}
          </Panel>
          </div>
        ) : null}
        {picked ? <StationMarket m={m} station={picked} query={kind === "commodity" ? query : ""} /> : null}

        {sites ? (
          <div className="cz-wide">
          <Panel
            k="search-sites"
            title="Construction sites"
            className="cz-panel--flush"
            aside={<span className="cz-aside-note">{sites.length ? `${sites.length} found` : "none found"}</span>}
          >
            {sites.length ? (
              <div className="cz-table-wrap">
                <table className="cz-table">
                  <thead>
                    <tr>
                      <th scope="col" style={{ paddingLeft: 16 }}>
                        Site
                      </th>
                      <th scope="col" className="r">
                        Distance
                      </th>
                      <th scope="col">Kind</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map((s) => (
                      <tr key={s.marketId} className={pickedSite === s ? "is-picked" : undefined}>
                        <td style={{ paddingLeft: 16 }}>
                          <button type="button" className="cz-pick" onClick={() => setPickedSite(s)}>
                            {s.name}
                          </button>
                          <div className="cz-small cz-dim">{s.systemName}</div>
                        </td>
                        <td className="r">{formatHopLy(s.distanceLy)}</td>
                        <td className="cz-small cz-dim">{s.kind === "planetary" ? "surface" : "orbital"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="cz-dim cz-pad">Spansh knows no construction site by that name.</p>
            )}
          </Panel>
          </div>
        ) : null}
        {pickedSite ? <SiteNeedsPanel m={m} site={pickedSite} /> : null}
      </div>
    </div>
  );
}

/** A station's market: everything it sells, what your sites need first. */
function StationMarket({ m, station, query }: { m: ColonizeModel; station: BuyIndexStationResult; query: string }) {
  const [rows, setRows] = useState<BuyIndexStationMaterial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = m.api;
  const { systemName, stationName, marketId } = station;
  /*
    Asked in an effect, and an answer is used only while its station is still the one picked: started during render,
    a slow answer for the station picked before landed under the newly picked one's heading (audit 2026-10-22).
  */
  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    api
      .getBuyIndexStationCatalog({ systemName, stationName, marketId })
      .then((r) => {
        if (!live) return;
        if (r.ok) setRows(r.materials);
        else setError(r.err);
      })
      .catch((e: unknown) => {
        if (live) setError(errText(e));
      });
    return () => {
      live = false;
    };
  }, [api, systemName, stationName, marketId]);
  const needed = useMemo(() => new Set((m.summary?.rows ?? []).map((r) => r.id)), [m.summary]);
  const asked = useMemo(
    () => new Set(query.split(",").map((q) => commodityMergeBucket(q.trim())).filter(Boolean)),
    [query],
  );
  const sorted = useMemo(() => {
    const score = (r: BuyIndexStationMaterial) => (asked.has(r.commodityId) ? 2 : needed.has(r.commodityId) ? 1 : 0);
    return [...(rows ?? [])].sort((a, b) => score(b) - score(a) || a.label.localeCompare(b.label));
  }, [rows, needed, asked]);
  const [copied, setCopied] = useState(false);
  return (
    <aside className="cz-side cz-side--wide" aria-label={station.stationName}>
      <Panel k="search-market" tone="hot" title={station.stationName}>
      <div className="cz-stack">
      <div className="cz-small cz-dim">
        {station.systemName}
        {station.stationType ? ` · ${station.stationType}` : ""}
        {station.bodyName ? ` · ${station.bodyName}` : ""}
      </div>
      {station.boughtCount || station.lastVisitIso ? (
        <div className="facts cz-facts">
          {station.boughtCount ? <Fact k="Bought here" v={`${station.boughtCount}×`} tone="open" /> : null}
          {station.lastVisitIso ? <Fact k="Docked" v={station.lastVisitIso.slice(0, 10)} /> : null}
        </div>
      ) : null}
      {error ? <p className="cz-note cz-note--bad">{error}</p> : null}
      {!rows && !error ? <p className="cz-dim">Reading its market…</p> : null}
      {rows ? (
        <ul className="cz-list cz-num">
          {sorted.map((r) => {
            const hot = asked.has(r.commodityId) || needed.has(r.commodityId);
            return (
              <li key={r.commodityId} className={hot ? "cz-li cz-li--hot" : "cz-li"}>
                <span>{hot ? <b>{r.label}</b> : r.label}</span>
                <span className="cz-dim">
                  {r.supply != null ? formatTons(r.supply) : ""}
                  {r.buyPrice != null ? ` · ${formatPrice(r.buyPrice)} cr` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="cz-actions">
        <button
          type="button"
          className={BTN_GO}
          onClick={() => {
            void copyText(station.systemName);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? "Copied" : "Copy system name"}
        </button>
        <button type="button" className={BTN_BAD} onClick={() => m.stations.ban(station.systemName, station.stationName)}>
          Never use this station
        </button>
      </div>
      </div>
      </Panel>
    </aside>
  );
}

/** What a construction site still needs, from Raven Colonial (when somebody registered the project there). */
function SiteNeedsPanel({ m, site }: { m: ColonizeModel; site: ConstructionSiteHit }) {
  const [needs, setNeeds] = useState<SiteNeeds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = m.api;
  const { systemName, marketId } = site;
  // As StationMarket: asked in an effect, a late answer for another site dropped (audit 2026-10-22).
  useEffect(() => {
    let live = true;
    setNeeds(null);
    setError(null);
    api
      .lookupSiteNeeds({ systemName, marketId })
      .then((r) => {
        if (!live) return;
        if (r.ok) setNeeds(r.needs);
        else setError(r.err);
      })
      .catch((e: unknown) => {
        if (live) setError(errText(e));
      });
    return () => {
      live = false;
    };
  }, [api, systemName, marketId]);
  return (
    <aside className="cz-side cz-side--wide" aria-label={site.name}>
      <Panel k="search-site" tone="hot" title={site.name}>
      <div className="cz-stack">
      <div className="cz-small cz-dim">{site.systemName}</div>
      {error ? <p className="cz-note cz-note--bad">{error}</p> : null}
      {!needs && !error ? <p className="cz-dim">Asking Raven Colonial…</p> : null}
      {needs && !needs.found ? (
        <p>
          Raven Colonial does not track this site, so nobody has published what it needs. Dock at it once and it becomes one of
          your sites, needs and all.
        </p>
      ) : null}
      {needs?.found ? (
        <>
          <div>
            <b>{needs.buildName}</b> <span className="cz-dim">· {needs.buildType}</span>
          </div>
          <div className="cz-soft">
            {needs.complete
              ? "Finished."
              : `${formatTons(needs.remainingTons)} still to deliver${needs.totalTons ? ` of ${formatTons(needs.totalTons)}` : ""}.`}
          </div>
          <ul className="cz-list cz-num">
            {needs.remaining.map((r) => (
              <li key={r.commodityId}>
                <span>{r.label}</span>
                <span className="cz-dim">{formatTons(r.tons)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="cz-small cz-dim" style={{ margin: 0 }}>
        Needs from{" "}
        <a href={RAVEN_COLONIAL_SITE} target="_blank" rel="noreferrer">
          Raven Colonial
        </a>
        , where commanders register their projects.
      </p>
      </div>
      </Panel>
    </aside>
  );
}
