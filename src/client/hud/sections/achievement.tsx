import type { HudSnapshot } from "../types";
import { Head, type HudSection } from "../parts";

/* ============================================================== Achievement ================= */
/*
  The achievement the commander tracks (owner, 2026-09-27): its progress, the next step, and which
  plants in the system in view would count toward it — the ★ rows of the main UI.
*/
export const ACH_STEP = ["", "Bronze", "Silver", "Gold"];

function Achievement({ d }: { d: HudSnapshot }) {
  const a = d.trackedAchievement;
  if (!a) {
    return (
      <>
        <Head title="Achievement" status="None tracked" />
        <div className="row">
          <span className="k" data-f="name">
            —
          </span>
          <span className="v" data-f="count" />
        </div>
        <div className="ach-hud-bar">
          <div className="ach-hud-bar__fill" data-f="fill" style={{ width: "0%" }} />
        </div>
        <p className="hud-note" data-f="next">
          Pick one to track in the app&apos;s Achievements window.
        </p>
        <div data-f="here" />
      </>
    );
  }
  const list = a.here || [];
  return (
    <>
      <Head title="Achievement" status={a.step ? ACH_STEP[a.step] : "Not started"} />
      <div className="row">
        <span className="k" data-f="name">
          {a.name}
        </span>
        <span className="v" data-f="count">
          {`${a.done} / ${a.total}`}
        </span>
      </div>
      <div className="ach-hud-bar">
        <div
          className={"ach-hud-bar__fill ach-hud-bar__fill--s" + a.step}
          data-f="fill"
          style={{ width: (a.total > 0 ? Math.min(100, (100 * a.done) / a.total) : 0) + "%" }}
        />
      </div>
      <p className="hud-note" data-f="next">
        {a.step >= 3 ? "Complete." : (a.thresholds as readonly number[])[a.step]! - a.done + " more for " + ACH_STEP[a.step + 1] + "."}
      </p>
      <div data-f="here">
        {a.todo ? (
          // A star, world or sight set: what is left, nearest sight first.
          a.todo.length ? (
            a.todo.map((t, i) => (
              <div className="row" key={i}>
                <span className="k">
                  {t.label + (t.hint ? " " : "")}
                  {t.hint ? <small>{t.hint}</small> : null}
                </span>
                <span className="v">{t.distanceLy != null ? Number(t.distanceLy).toLocaleString() + " ly" : ""}</span>
              </div>
            ))
          ) : (
            <p className="hud-note">Nothing left.</p>
          )
        ) : list.length ? (
          <>
            {list.slice(0, 8).map((h, i) => (
              <div className="row" key={i}>
                <span className="k">
                  {"★ " + h.species + (h.colours && h.colours.length ? " " : "")}
                  {h.colours && h.colours.length ? <small>{h.colours.join(" / ")}</small> : null}
                </span>
                <span className="v">{h.body}</span>
              </div>
            ))}
            {list.length > 8 ? <p className="hud-note">and {list.length - 8} more</p> : null}
          </>
        ) : (
          <p className="hud-note">Nothing in this system counts toward it.</p>
        )}
      </div>
    </>
  );
}

export const achievement: HudSection = {
  title: "Achievement",
  state: (d) => {
    const a = d.trackedAchievement;
    return a && !a.todo && (a.here || []).length ? "ok" : null;
  },
  render: (d) => <Achievement d={d} />,
};
