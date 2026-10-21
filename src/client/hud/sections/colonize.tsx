import { useEffect } from "react";
import type { HudSnapshot } from "../types";
import { api } from "../core";
import { Head, type HudSection } from "../parts";

/* ============================================================== Colonize ==================== */
/*
  Colonisation at a glance (1.3.0): the sites being built, what to unload when docked at one, and the next stop of
  the haul plan the Colonize window made (server: colonize/hudSummary.ts). Colonize starts on its first request, so
  this section asks once: the HUD shows the sites without the Colonize window ever being opened.
*/
const t = (n: number) => `${Math.round(n).toLocaleString("en-US")} t`;

let asked = false;
function StartColonize() {
  useEffect(() => {
    if (asked) return;
    asked = true;
    void fetch(api("/api/colonize/rpc/getSnapshot"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args: [] }),
    }).catch(() => {
      asked = false; // the server was not up yet: the next snapshot asks again
    });
  });
  return null;
}

function Colonize({ d }: { d: HudSnapshot }) {
  const c = d.colonizeHud;
  if (!c) {
    return (
      <>
        <StartColonize />
        <Head title="Colonize" status="—" />
        <p className="hud-note" data-f="none">
          No site being built. Dock at a construction site and it shows here.
        </p>
      </>
    );
  }
  const docked = c.sites.find((s) => s.docked);
  const status = c.next?.here ? "Buy here" : docked ? "Docked at site" : `${c.sites.length + c.moreSites} building`;
  return (
    <>
      <StartColonize />
      <Head title="Colonize" status={status} />
      <div data-f="sites">
        {c.sites.map((s) => (
          <div key={s.marketId}>
            <div className="row">
              <span className="k">
                {s.label} {s.system ? <small>{s.system}</small> : null}
              </span>
              <span className="v">{`${s.pct}% · ${t(s.leftTons)} left`}</span>
            </div>
            <div className="ach-hud-bar">
              <div className="ach-hud-bar__fill" style={{ width: `${s.pct}%` }} />
            </div>
          </div>
        ))}
        {c.moreSites ? <p className="hud-note">{`+${c.moreSites} more`}</p> : null}
      </div>

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

      {c.next ? (
        <div data-f="next">
          <div className="row row--rule">
            <span className="k">{`Next · trip ${c.next.trip} of ${c.next.trips}`}</span>
            <span className="v">{c.next.here ? "Buy here" : c.next.distanceLy != null ? `${Math.round(c.next.distanceLy)} ly` : ""}</span>
          </div>
          <div className="row">
            <span className="k">
              {c.next.station} <small>{c.next.system}</small>
            </span>
          </div>
          {c.next.buys.map((b) => (
            <div className={"row" + (b.done ? " row--muted" : "")} key={b.label}>
              <span className="k">{(b.done ? "✓ " : "") + b.label}</span>
              <span className="v">{t(b.tons)}</span>
            </div>
          ))}
          {c.next.deliverTo.length ? <p className="hud-note">{"Then to " + c.next.deliverTo.join(", ")}</p> : null}
        </div>
      ) : (
        <p className="hud-note" data-f="next">
          No haul plan yet: Colonize makes one from the sellers it knows.
        </p>
      )}

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
  /* Green while there is something to do right here: unload at the site, or buy at the next stop. */
  state: (d) => (d.colonizeHud?.next?.here || d.colonizeHud?.deliver?.lines.length ? "ok" : null),
  initial: () => (
    <>
      <Head title="Colonize" status="…" />
      <p className="hud-note">Waiting for Colonize…</p>
    </>
  ),
  render: (d) => <Colonize d={d} />,
};
