/**
 * The galaxy search's result dialogs. Split out of GalaxySearchPanel.tsx (code review D, 2026-09-27).
 */
import { CopySystemButton } from "./CopySystemButton";
import { cr, ly } from "./galaxySearchShared";
import { ModalHead } from "./ui/ModalHead";
import { useModal } from "./ui/useModal";
import type { GalaxyBodyScanDTO, GalaxyValueHitDTO } from "@shared/types";
import type { ReactNode } from "react";

/**
 * The results, in a window over the map rather than in the page under it.
 *
 * The owner's ranking of the two: *"the main focus there is the map, the list is just a 'nice to
 * have' and for people who will find it easier than dealing with the map"*. A 200-row table in the
 * page pushed the thing it describes off the screen, which inverted that — so the table opens on
 * request and closes again, and the map keeps the page.
 *
 * It reuses {@link useModal}, so it behaves like every other dialog in the app: Escape closes it,
 * focus is trapped inside and handed back on the way out, and the page behind it does not scroll.
 */
export function GalaxyHitsModal({
  hits,
  onClose,
  children,
}: {
  hits: readonly GalaxyValueHitDTO[];
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel gsx-hits-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gsx-hits-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <ModalHead
          title={`${hits.length} system${hits.length === 1 ? "" : "s"}, nearest first`}
          titleId="gsx-hits-title"
          onClose={onClose}
          helpTitle="What this list shows"
          help={<RecordedHelp />}
        />
        <div className="fdb-scroll gsx-hits-scroll">{children}</div>
      </div>
    </div>
  );
}

/**
 * The bodies a predicted search found, in the same window the recorded list uses.
 *
 * A body table rather than a system table: the answer is "this world would be offered that plant",
 * and the world is what the commander has to fly to and land on. The system is the heading.
 */
export function GalaxyPossibleModal({ result, onClose }: { result: GalaxyBodyScanDTO; onClose: () => void }) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const bodies = result.hits.reduce((n, h) => n + h.bodies.length, 0);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel gsx-hits-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gsx-possible-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <ModalHead
          title={
            <>
              {bodies} bod{bodies === 1 ? "y" : "ies"} in {result.hits.length} system
              {result.hits.length === 1 ? "" : "s"}
              {/* Never "nearest first" over a partial walk — see the summary row for why. */}
              {result.truncated ? ", nearest in the part searched" : ", nearest first"}
            </>
          }
          titleId="gsx-possible-title"
          onClose={onClose}
          helpTitle="What this list shows"
          help={<PossibleHelp />}
        />
        <div className="fdb-scroll gsx-hits-scroll">
          {/*
            Said once, at the top of the list, rather than beside every row. Every row here is the
            same kind of claim and repeating it would turn a warning into wallpaper.
          */}
          <p className="dim gsx-caveat">
            These are bodies whose conditions suit the species — the same gates the app applies when you are
            standing there. Nobody has confirmed anything on them.
          </p>
          <table className="fdb-table">
            <thead>
              <tr>
                <th>Body</th>
                <th className="fdb-num">Away</th>
                <th>Conditions</th>
                <th className="fdb-num">Signals</th>
                <th>Could be</th>
                <th className="fdb-num">At 5×</th>
              </tr>
            </thead>
            <tbody>
              {result.hits.map((h) =>
                h.bodies.map((b, i) => (
                  <tr key={`${h.systemAddress}:${b.bodyId}`} className="fdb-row">
                    <td className="fdb-sys">
                      {b.bodyName}
                      {/* The body name carries the system's; the icon copies the system. */}
                      <CopySystemButton system={h.starSystem} />
                      {b.probed ? (
                        <span className="dim gsx-ff" title="Somebody has mapped this body with probes.">
                          {" "}
                          · probed
                        </span>
                      ) : null}
                      {h.walked ? (
                        <span className="dim gsx-ff" title="Somebody has logged a species in this system.">
                          {" "}
                          · walked
                        </span>
                      ) : null}
                    </td>
                    {/* Once per system: the distance is the system's, and repeating it reads as detail. */}
                    <td className="fdb-num dim">{i === 0 ? ly(h.distanceLy) : ""}</td>
                    <td className="gsx-species">
                      {[
                        b.planetClass || "unknown class",
                        b.atmosphere || "no atmosphere",
                        `${Math.round(b.temperatureK)} K`,
                        `${b.gravityG.toFixed(2)} g`,
                        /*
                          The odds beside the gravity that produced them, so the number is read as
                          a consequence of the body rather than a verdict on it. Absent for an
                          airless body or one the dump never measured — see gravityBiologyOdds.ts.
                        */
                        b.gravityOdds ? `${b.gravityOdds.observedPct}% carry biology` : null,
                        h.starType ? `${h.starType} star` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                    {/*
                      The FSS count is the hard fact on the row: the game puts one genus per signal,
                      so it is how many different plants are down there whatever anybody predicts.
                    */}
                    <td className="fdb-num">{b.bioCount || "—"}</td>
                    <td className="gsx-species">{b.species.map((s) => s.displayName).join(", ")}</td>
                    <td className="fdb-num fdb-floor">
                      {b.species[0] ? cr(b.species[0].firstFootfallCr) : "—"}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Behind the "?" beside the × of the recorded list (owner, 2026-10-23). */
function RecordedHelp() {
  return (
    <>
      <p>
        Systems where what you searched for has been recorded, nearest to you first. Every row is a sighting
        somebody logged, not a prediction.
      </p>
      <p>
        The species come from EDAstro's codex and the body counts from Spansh's export.{" "}
        <strong>Evidence</strong> says how much is known: a species logged on
        foot, a genus from a probe-mapped body, or only an FSS signal count. Hover it for the detail.
      </p>
      <p>
        <strong>System worth</strong> adds up every species known there at the price-list value, then the same
        at five times for a first footfall. Nothing here can say whether the bodies have been walked, so both are
        shown. The icon beside a name copies the system.
      </p>
    </>
  );
}

/** Behind the "?" beside the × of the predicted list (owner, 2026-10-23). */
function PossibleHelp() {
  return (
    <>
      <p>
        Bodies in the region you searched whose conditions suit the species, nearest to you first. They pass the
        same gates the app applies when you are in the system; nobody has confirmed anything on them.
      </p>
      <p>
        The bodies come from the galaxy body file on this machine. <strong>Conditions</strong> lists the planet
        class, atmosphere, temperature, gravity and star, and how often bodies with that gravity carry biology
        where known. <strong>Signals</strong> is the FSS biological signal count; <strong>Could be</strong> the
        species that pass, priciest first; <strong>At 5×</strong> the priciest one's first-footfall value.
      </p>
      <p>
        "probed" means somebody has mapped the body with probes, "walked" that somebody has logged a species in
        the system. The icon beside a name copies the system.
      </p>
    </>
  );
}
