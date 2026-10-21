/**
 * Search: one box, three kinds — a commodity (a comma means "sells all of them"), a system, a construction site.
 * Results come from every source together (Spansh, your Inara imports, markets you docked at); a station opens its
 * market, with what your sites still need marked.
 */
import { useMemo, useState } from "react";
import type { BuyIndexStationMaterial, BuyIndexStationResult } from "../../../shared/colonize/buyIndexSearchTypes";
import { RAVEN_COLONIAL_SITE, type ConstructionSiteHit, type SiteNeeds } from "../../../shared/colonize/siteLookup";
import { formatHopLy } from "../../../shared/colonize/systemDistanceLy";
import { formatPrice } from "../../../shared/colonize/formatPrice";
import { commodityMergeBucket } from "../../../shared/colonize/commodityKey";
import type { ColonizeModel } from "../useColonize";

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
  const near = m.constructionSiteRefs[0]?.trim() || m.homeSystem;

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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const hint = KINDS.find((x) => x.k === kind)?.hint ?? "";
  return (
    <div className="cz-stack" style={{ gap: 18 }}>
      <form className="cz-row" style={{ alignItems: "center", justifyContent: "flex-start", gap: 12 }} onSubmit={run}>
        <div className="cz-seg" role="tablist" aria-label="Search for">
          {KINDS.map((x) => (
            <button
              key={x.k}
              type="button"
              role="tab"
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
        <button type="submit" className="cz-btn cz-btn--primary" disabled={busy || !query.trim()}>
          {busy ? "Searching…" : "Search"}
        </button>
        {kind === "system" ? (
          <button type="button" className="cz-btn" disabled={busy || !query.trim()} onClick={() => void askSpanshForSystem()}>
            Ask Spansh for its markets
          </button>
        ) : null}
      </form>
      {kind === "commodity" ? (
        <p className="cz-small cz-dim" style={{ margin: 0 }}>
          A comma means “sells all of them”. From what is saved: Spansh results, your Inara imports, markets you docked at.
        </p>
      ) : null}
      {error ? <p className="cz-note cz-note--bad" role="alert">{error}</p> : null}
      {notice ? <p className="cz-note cz-note--info" role="status">{notice}</p> : null}

      <div className="cz-cols">
        {stations ? (
          <section className="cz-wide cz-panel" aria-label="Stations" style={{ padding: 0 }}>
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
                          <div className="cz-small cz-dim">{s.systemName}</div>
                        </td>
                        <td className="r">{formatHopLy(m.systemDistanceLy[s.systemName.toLowerCase()] ?? s.minDistanceLy)}</td>
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
              <p style={{ padding: 16, margin: 0 }} className="cz-dim">
                Nothing saved matches. {kind === "system" ? "Ask Spansh for its markets." : "The plan's “Look for sellers now” asks Spansh."}
              </p>
            )}
          </section>
        ) : null}
        {picked ? <StationMarket m={m} station={picked} query={kind === "commodity" ? query : ""} /> : null}

        {sites ? (
          <section className="cz-wide cz-panel" aria-label="Construction sites" style={{ padding: 0 }}>
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
              <p style={{ padding: 16, margin: 0 }} className="cz-dim">
                Spansh knows no construction site by that name.
              </p>
            )}
          </section>
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
  const key = `${station.systemName}|${station.stationName}`;
  const [loadedKey, setLoadedKey] = useState("");
  if (loadedKey !== key) {
    setLoadedKey(key);
    setRows(null);
    setError(null);
    void m.api
      .getBuyIndexStationCatalog({ systemName: station.systemName, stationName: station.stationName, marketId: station.marketId })
      .then((r) => (r.ok ? setRows(r.materials) : setError(r.err)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }
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
    <aside className="cz-side cz-panel cz-panel--hot" aria-label={station.stationName} style={{ maxWidth: 440 }}>
      <div>
        <h2 className="cz-h2">{station.stationName}</h2>
        <div className="cz-small cz-dim">
          {station.systemName}
          {station.stationType ? ` · ${station.stationType}` : ""}
          {station.bodyName ? ` · ${station.bodyName}` : ""}
        </div>
      </div>
      {error ? <p className="cz-note cz-note--bad">{error}</p> : null}
      {!rows && !error ? <p className="cz-dim">Reading its market…</p> : null}
      {rows ? (
        <ul className="cz-list cz-num">
          {sorted.map((r) => {
            const hot = asked.has(r.commodityId) || needed.has(r.commodityId);
            return (
              <li key={r.commodityId} style={hot ? { padding: "5px 8px", background: "var(--hud-ghost)", borderRadius: 6 } : { padding: "5px 8px" }}>
                <span>{hot ? <b>{r.label}</b> : r.label}</span>
                <span className="cz-dim">
                  {r.supply != null ? `${r.supply.toLocaleString("en-US")} t` : ""}
                  {r.buyPrice != null ? ` · ${formatPrice(r.buyPrice)} cr` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="cz-btn cz-btn--primary"
          onClick={() => {
            void navigator.clipboard?.writeText(station.systemName).catch(() => {});
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? "Copied" : "Copy system name"}
        </button>
        <button type="button" className="cz-btn cz-btn--bad" onClick={() => m.stations.ban(station.systemName, station.stationName)}>
          Never use this station
        </button>
      </div>
    </aside>
  );
}

/** What a construction site still needs, from Raven Colonial (when somebody registered the project there). */
function SiteNeedsPanel({ m, site }: { m: ColonizeModel; site: ConstructionSiteHit }) {
  const [needs, setNeeds] = useState<SiteNeeds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  if (loadedKey !== site.marketId) {
    setLoadedKey(site.marketId);
    setNeeds(null);
    setError(null);
    void m.api
      .lookupSiteNeeds({ systemName: site.systemName, marketId: site.marketId })
      .then((r) => (r.ok ? setNeeds(r.needs) : setError(r.err)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }
  return (
    <aside className="cz-side cz-panel cz-panel--hot" aria-label={site.name} style={{ maxWidth: 440 }}>
      <div>
        <h2 className="cz-h2">{site.name}</h2>
        <div className="cz-small cz-dim">{site.systemName}</div>
      </div>
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
          <div style={{ color: "var(--text-dim)" }}>
            {needs.complete
              ? "Finished."
              : `${needs.remainingTons.toLocaleString("en-US")} t still to deliver${needs.totalTons ? ` of ${needs.totalTons.toLocaleString("en-US")} t` : ""}.`}
          </div>
          <ul className="cz-list cz-num">
            {needs.remaining.map((r) => (
              <li key={r.commodityId}>
                <span>{r.label}</span>
                <span className="cz-dim">{r.tons.toLocaleString("en-US")} t</span>
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
    </aside>
  );
}
