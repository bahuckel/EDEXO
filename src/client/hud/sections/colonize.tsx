import { useEffect } from "react";
import { formatTons as t } from "../../../shared/colonize/formatPrice";
import type { ColonizeHudBuy, ColonizeHudNeed } from "../../../shared/colonize/hud";
import type { HudSnapshot } from "../types";
import { HUD_LIST_ROWS, api, listRowLimit } from "../core";
import { Head, type HudSection } from "../parts";
import { pref } from "../theme";

/* ============================================================== Colonize ==================== */
/*
  Colonisation at a glance (1.3.0): what to unload when docked at a site, the next stop of the haul plan the Colonize
  window made with bars that fill as the cargo comes aboard, the followed site's materials with bars that fill as they
  are delivered, the other sites, and the hold (server: colonize/hudSummary.ts). A line that is finished (bought, or
  delivered in full) leaves the HUD; with "Show finished lines" on it stays, last and green (owner, 2026-10-22).

  Colonize starts on its first request, so this section asks: the HUD shows the sites without the Colonize window ever
  being opened. Asked again after a minute while there is still nothing (the server restarted, the phone reconnected).
*/
const num = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0);

const ASK_AGAIN_MS = 60_000;
let lastAskAt = 0;
function StartColonize({ have }: { have: boolean }) {
  useEffect(() => {
    if (have || (lastAskAt && Date.now() - lastAskAt < ASK_AGAIN_MS)) return;
    lastAskAt = Date.now();
    void fetch(api("/api/colonize/rpc/getSnapshot"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args: [] }),
    }).catch(() => {
      lastAskAt = 0; // the server was not up yet: the next snapshot asks again
    });
  });
  return null;
}

function Bar({ value, done = false }: { value: number; done?: boolean }) {
  return (
    <div className="hud-bar hud-bar--thin">
      <div className={"hud-bar__fill" + (done ? " hud-bar__fill--done" : "")} style={{ width: `${value}%` }} />
    </div>
  );
}

/** Open lines first (as given), finished ones last: kept only when the option asks for them. */
function withFinished<T>(rows: T[], done: (r: T) => boolean, showFinished: boolean): { open: T[]; finished: T[] } {
  const open = rows.filter((r) => !done(r));
  return { open, finished: showFinished ? rows.filter(done) : [] };
}

function BuyRow({ b }: { b: ColonizeHudBuy }) {
  const have = b.done ? b.tons : Math.min(b.tons, b.have ?? 0);
  return (
    <div className={b.done ? "row--done" : undefined}>
      <div className="row">
        <span className="k">{(b.done ? "✓ " : "") + b.label}</span>
        <span className="v">{b.done ? t(b.tons) : `${num(have)} / ${t(b.tons)}`}</span>
      </div>
      <Bar value={pct(have, b.tons)} done={b.done} />
    </div>
  );
}

function NeedRow({ n }: { n: ColonizeHudNeed }) {
  const left = Math.max(0, n.required - n.provided);
  return (
    <div className={n.done ? "row--done" : undefined}>
      <div className="row">
        <span className="k">{(n.done ? "✓ " : "") + n.label}</span>
        <span className="v">{n.done ? "delivered" : `${t(left)}${n.aboard > 0 ? ` · ${num(n.aboard)} aboard` : ""}`}</span>
      </div>
      <Bar value={pct(n.provided, n.required)} done={n.done} />
    </div>
  );
}

function Colonize({ d }: { d: HudSnapshot }) {
  const c = d.colonizeHud;
  if (!c) {
    return (
      <>
        <StartColonize have={false} />
        <Head title="Colonize" status="—" />
        <p className="hud-note" data-f="none">
          No site being built. Dock at a construction site and it shows here.
        </p>
      </>
    );
  }
  const showFinished = pref("edexoHudCzFinished", "0") === "1";
  const showNeeds = pref("edexoHudCzNeeds", "1") !== "0";
  const showSites = pref("edexoHudCzSites", "1") !== "0";
  const limit = listRowLimit(HUD_LIST_ROWS);

  const docked = c.sites.find((s) => s.docked);
  const status = c.next?.here ? "Buy here" : docked ? "Docked at site" : `${c.sites.length + c.moreSites} building`;
  const next = c.next;
  const buys = next ? withFinished(next.buys, (b) => b.done, showFinished) : null;
  const target = c.target ?? null;
  const needs = target ? withFinished(target.needs, (n) => n.done, showFinished) : null;
  const doneNeeds = target ? target.needs.filter((n) => n.done).length : 0;
  const others = c.sites.filter((s) => !target || s.marketId !== target.marketId);
  const away = next?.here
    ? "Buy here"
    : next?.fromShipLy != null
      ? `${num(next.fromShipLy)} ly away`
      : next?.distanceLy != null
        ? `${num(next.distanceLy)} ly from the site`
        : "";

  return (
    <>
      <StartColonize have />
      <Head title="Colonize" status={status} />

      {c.deliver ? (
        <div data-f="deliver">
          <div className="row row--rule row--total">
            <span className="k">Deliver here</span>
            <span className="v">{c.deliver.lines.length ? t(c.deliver.lines.reduce((a, l) => a + l.tons, 0)) : ""}</span>
          </div>
          {c.deliver.lines.length ? (
            c.deliver.lines.map((l) => (
              <div className="row" key={l.label}>
                <span className="k">{l.label}</span>
                <span className="v">{t(l.tons)}</span>
              </div>
            ))
          ) : (
            <p className="hud-note">Nothing aboard that this site still needs.</p>
          )}
        </div>
      ) : null}

      {next && buys ? (
        <div data-f="next">
          <div className="row row--rule">
            <span className="k">{`Next · trip ${next.trip} of ${next.trips}`}</span>
            <span className="v">{away}</span>
          </div>
          <div className="row">
            <span className="k">
              {next.kind === "deliver" ? "Deliver to " : ""}
              {next.station} <small>{next.system}</small>
            </span>
          </div>
          {buys.open.map((b) => (
            <BuyRow key={b.commodityId ?? b.label} b={b} />
          ))}
          {buys.finished.map((b) => (
            <BuyRow key={b.commodityId ?? b.label} b={b} />
          ))}
          {next.deliverTo.length && next.kind !== "deliver" ? <p className="hud-note">{"Then to " + next.deliverTo.join(", ")}</p> : null}
          {c.plan === "stale" ? <p className="hud-note hud-explain">Plan made for other sites: open Colonize to update it.</p> : null}
        </div>
      ) : (
        <p className="hud-note" data-f="next">
          {c.plan === "done" ? "All planned trips done." : "No haul plan yet: Colonize makes one from the sellers it knows."}
        </p>
      )}

      {showNeeds && target && needs ? (
        <div data-f="site">
          <div className="row row--rule">
            <span className="k">
              {target.label} {target.system ? <small>{target.system}</small> : null}
            </span>
            <span className="v">{`${target.pct}% · ${t(target.leftTons)} left`}</span>
          </div>
          {needs.open.slice(0, limit).map((n) => (
            <NeedRow key={n.commodityId || n.label} n={n} />
          ))}
          {needs.open.length > limit ? <p className="hud-note">{`+${needs.open.length - limit} more`}</p> : null}
          {needs.finished.map((n) => (
            <NeedRow key={n.commodityId || n.label} n={n} />
          ))}
          {doneNeeds && !showFinished ? <p className="hud-note hud-explain">{`${doneNeeds} of ${target.needs.length} delivered`}</p> : null}
        </div>
      ) : null}

      {showSites && others.length ? (
        <div data-f="sites">
          {others.map((s) => (
            <div key={s.marketId}>
              <div className="row">
                <span className="k">
                  {s.label} {s.system ? <small>{s.system}</small> : null}
                </span>
                <span className="v">{`${s.pct}% · ${t(s.leftTons)} left`}</span>
              </div>
              <Bar value={s.pct} />
            </div>
          ))}
          {c.moreSites ? <p className="hud-note">{`+${c.moreSites} more`}</p> : null}
        </div>
      ) : null}

      <div className="row row--rule" data-f="hold">
        <span className="k">Hold</span>
        <span className="v">{`${Math.round(c.hold.used).toLocaleString("en-US")} / ${c.hold.capacity != null ? t(c.hold.capacity) : "? t"}`}</span>
      </div>
    </>
  );
}

export const colonize: HudSection = {
  title: "Colonize",
  /* "Only when relevant": a site is being built. */
  relevant: (d) => !!d.colonizeHud?.sites.length,
  /* The game's blue (ok) while there is something to do right here: unload at the site, or buy at the next stop. */
  state: (d) => (d.colonizeHud?.next?.here || d.colonizeHud?.deliver?.lines.length ? "ok" : null),
  initial: () => (
    <>
      <Head title="Colonize" status="…" />
      <p className="hud-note">Waiting for Colonize…</p>
    </>
  ),
  render: (d) => <Colonize d={d} />,
};
