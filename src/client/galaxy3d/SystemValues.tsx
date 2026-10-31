/**
 * What a discovered system is worth, in the map's side panel (plan 1.3.3 R-1 / R-3, owner 2026-10-30): the FSS and
 * DSS of the whole system, the expected exobiology, and its notable planets and bodies with biology, from Spansh's
 * bodies (`/api/route/system-values`). At 1×: other commanders reported it.
 */
import { useEffect, useState } from "react";
import type { RouteSystemValuesDTO } from "@shared/dto/routeSystem.js";
import { fmtCrExact, fmtCrShort } from "@shared/format";

/** Bodies listed; the rest are counted. */
const SHOWN = 8;

/** The body's name without the system's in front ("AB 1 c"). */
const shortName = (body: string, system: string) =>
  body.toLowerCase().startsWith(system.toLowerCase() + " ") ? body.slice(system.length + 1) : body;

export function SystemValues({ addr, name }: { addr: string; name: string }) {
  const [d, setD] = useState<RouteSystemValuesDTO | "loading" | "error">("loading");
  useEffect(() => {
    let live = true;
    setD("loading");
    fetch(`/api/route/system-values?addr=${encodeURIComponent(addr)}&name=${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? (r.json() as Promise<RouteSystemValuesDTO>) : Promise.reject(new Error(String(r.status)))))
      .then((v) => live && setD(v))
      .catch(() => live && setD("error"));
    return () => {
      live = false;
    };
  }, [addr, name]);

  if (d === "loading") return <p className="g3d-panel__note">Asking Spansh for the bodies…</p>;
  if (d === "error") return <p className="g3d-panel__note">Could not ask Spansh for the bodies.</p>;
  if (d.state === "none") return <p className="g3d-panel__note">Spansh has no bodies for it: nobody has reported them.</p>;
  if (d.state === "error") return <p className="g3d-panel__note">Spansh: {d.error}</p>;
  const hidden = Math.max(0, d.bodies.length - SHOWN);
  return (
    <>
      <h3 className="g3d-panel__sub">
        What the system pays ({d.bodyCount}
        {d.bodyTotal != null && d.bodyTotal > d.bodyCount ? ` of ${d.bodyTotal}` : ""} bodies{" "}
        {d.source === "journal" ? "in your journals" : "on Spansh"})
      </h3>
      {d.missing ? <p className="g3d-panel__todo">{d.missing} bodies missing: the honk counted them, nobody has scanned them.</p> : null}
      <table className="g3d-species">
        <tbody>
          <tr title="Every star and planet scanned with the FSS, the honk included">
            <td>FSS, every body</td>
            <td className="g3d-num">{fmtCrExact(d.fssCr)}</td>
          </tr>
          <tr title="Earth-like, water and ammonia worlds, terraformables, Helium gas giants, mapped (in place of their scan)">
            <td>
              DSS, {d.dssBodies} worth mapping
            </td>
            <td className="g3d-num">{fmtCrExact(d.dssCr)}</td>
          </tr>
          <tr title="Each body's candidates: chance × price, at 1× (no first footfall)">
            <td>Exobiology, expected</td>
            <td className="g3d-num">{fmtCrExact(d.bioCr)}</td>
          </tr>
          {d.codexNew ? (
            <tr title="The likeliest species of each genus on its bodies not yet in your codex for this region">
              <td>Codex</td>
              <td className="g3d-num">
                CODEX ×{d.codexNew}
                {d.codexFirst ? ` · ${d.codexFirst} first` : ""}
              </td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr>
            <td>Scan, map and sample</td>
            <td className="g3d-num">{fmtCrExact(d.totalCr + d.bioCr)}</td>
          </tr>
        </tfoot>
      </table>
      {d.bodies.length ? (
        <ul className="g3d-bodies">
          {d.bodies.slice(0, SHOWN).map((b) => (
            <li key={b.name}>
              <div className="g3d-bodies__head">
                <strong>{shortName(b.name, d.name)}</strong>
                <span>
                  {[
                    b.tag ? `${b.tag} · map ${fmtCrShort(b.dssCr)}` : null,
                    b.bioSignals ? `${b.bioSignals} bio · ${b.bioCr != null ? fmtCrShort(b.bioCr) : "?"}` : null,
                    b.codexNew ? `CODEX ×${b.codexNew}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {b.species.length ? (
                <ul>
                  {b.species.map((s) => (
                    <li key={s.name} className={s.logged ? "g3d-done" : "g3d-todo"} title={s.logged ? "Logged here by other commanders" : "Predicted"}>
                      {s.logged ? "✓" : "?"} {s.name}
                      {s.cr != null ? ` · ${fmtCrShort(s.cr)}` : ""}
                      {!s.logged && s.chancePct != null ? ` · ${s.chancePct} %` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="g3d-panel__note">No notable planets or biology on Spansh.</p>
      )}
      {hidden ? <p className="g3d-panel__note">{hidden} more bodies worth less.</p> : null}
      <p className="g3d-panel__note">✓ logged by other commanders · ? predicted, with its chance.</p>
    </>
  );
}
