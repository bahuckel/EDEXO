/**
 * The Targets drawer: your nearest waiting system, the next target recorded by others worth the floor, and the plan
 * of the next few. Moved out of GalaxyMap3D.tsx (2026-10-27: the file was near its size cap); the map keeps the state
 * and the fetching, this draws it.
 */
import type { Dispatch, SetStateAction } from "react";
import type { GalaxyNextDTO } from "@shared/types";
import { fmtLy } from "@shared/format";
import { CopySystemButton } from "../CopySystemButton";
import { Tooltip } from "../ui/Tooltip";
import type { Selection } from "./GalaxyEngine";
import { formatCount, formatValue } from "./clusters";
import { G3D_HELP, MenuHead, MenuRow, MenuToggle } from "./G3dMenu";
import { crShort, PLAN_SIZES, WORTH_STEPS_M, type MineRow } from "./mapConstants";

type Point = { x: number; y: number; z: number };

export function TargetsMenu({
  waitMinM,
  nearest,
  go,
  worthStep,
  setWorthStep,
  worthM,
  worthCount,
  skipVisited,
  setSkipVisited,
  nextTarget,
  skipped,
  targetBusy,
  target,
  copied,
  skipTarget,
  planOn,
  setPlanOn,
  openPlan,
  planSize,
  setPlanSize,
  planLoop,
  setPlanLoop,
  plan,
  skipStop,
  planCopied,
  setPlanCopied,
  fitTo,
}: {
  waitMinM: number;
  nearest: { row: MineRow; ly: number } | null;
  go: (g: Point, distance: number, sel?: Selection) => void;
  worthStep: number;
  setWorthStep: (v: number) => void;
  worthM: number;
  worthCount: number | null;
  skipVisited: boolean;
  setSkipVisited: (v: boolean) => void;
  nextTarget: (skip: number[], o?: { plan?: number; fly?: boolean; loop?: boolean }) => Promise<void>;
  skipped: number[];
  targetBusy: boolean;
  target: GalaxyNextDTO | null;
  copied: boolean;
  skipTarget: () => void;
  planOn: boolean;
  setPlanOn: (v: boolean) => void;
  openPlan: () => void;
  planSize: number;
  setPlanSize: Dispatch<SetStateAction<number>>;
  planLoop: boolean;
  setPlanLoop: (v: boolean) => void;
  plan: GalaxyNextDTO["plan"] | null;
  skipStop: (ordinal: number) => void;
  planCopied: boolean;
  setPlanCopied: (v: boolean) => void;
  /** Frames the camera on the plan's stops (and the start). */
  fitTo: (points: Point[]) => void;
}) {
  return (
      <aside className="g3d-drawer g3d-menu g3d-plan" aria-label="Targets" data-testid="g3d-targets">
        <MenuHead title="Biology targets" help={G3D_HELP.targets} />
        {/* Your own systems still waiting (owner, 2026-10-04: here, not over the map all the time). */}
        <div className="g3d-menu__section g3d-menu__section--first" data-testid="g3d-nearest">
          <Tooltip text="Of your own systems with biology still to sample, the nearest one worth at least the Waiting floor (Layers)">
            <span className="g3d-menu__sub">Your nearest waiting{waitMinM ? ` ≥ ${waitMinM}M` : ""}</span>
          </Tooltip>
          {nearest ? (
            <div className="g3d-target">
              <span>
                <strong>{nearest.row.name}</strong> · {fmtLy(nearest.ly)} · at least{" "}
                {crShort(nearest.row.unfinishedFloorCr)}
              </span>
              <CopySystemButton system={nearest.row.name} />
              <button
                type="button"
                className="g3d-btn"
                onClick={() =>
                  go(nearest.row, 400, {
                    kind: "marker",
                    layer: "you",
                    id: String(nearest.row.addr),
                    x: nearest.row.x,
                    y: nearest.row.y,
                    z: nearest.row.z,
                  })
                }
              >
                Show
              </button>
            </div>
          ) : (
            <p className="g3d-panel__note">
              None of yours waiting{waitMinM ? ` at ${waitMinM}M or more` : ""}.
            </p>
          )}
        </div>
        <span className="g3d-menu__sub">Recorded by others</span>
        <MenuRow label="Worth ≥" hint="Only systems whose recorded species add up to at least this (1×)">
          <input
            type="range"
            className="g3d-row__range"
            min={0}
            max={WORTH_STEPS_M.length - 1}
            step={1}
            value={worthStep}
            aria-label="Worth at least (million CR)"
            onChange={(ev) => setWorthStep(Number(ev.target.value))}
          />
          <span className="g3d-slider-val">
            {worthM ? `${worthM}M` : "any"}
            {worthCount != null && worthM ? ` (${formatCount(worthCount)})` : ""}
          </span>
        </MenuRow>
        <MenuToggle
          label="Skip visited"
          hint="Also skip systems you have been to, not only the ones you mapped or sampled"
          on={skipVisited}
          set={setSkipVisited}
        />
        <button
          type="button"
          className="g3d-btn g3d-btn--primary-small"
          onClick={() => void nextTarget(skipped)}
          disabled={targetBusy}
          title="The nearest system worth at least that much that you have not mapped or sampled; its name is copied for the game's galaxy map"
        >
          {targetBusy ? "Finding…" : "Next target"}
        </button>
        {target ? (
          <div className="g3d-target" data-testid="g3d-target">
            {target.target ? (
              <>
                <span>
                  Next target{worthM ? ` ≥ ${worthM}M` : ""}: <strong>{target.target.name}</strong> ·{" "}
                  {fmtLy(target.target.distanceLy)} · {target.target.species} species ·{" "}
                  {formatValue(target.target.valueCr / 100_000)}
                  {copied ? " · name copied" : ""}
                </span>
                <CopySystemButton system={target.target.name} />
                <button type="button" className="g3d-btn" onClick={skipTarget} disabled={targetBusy}>
                  Skip
                </button>
                <button
                  type="button"
                  className="g3d-btn"
                  onClick={() => {
                    const t = target.target!;
                    go(t, 400, { kind: "index", ordinal: t.ordinal, x: t.x, y: t.y, z: t.z });
                  }}
                >
                  Show
                </button>
                {!planOn ? (
                  <button
                    type="button"
                    className="g3d-btn"
                    onClick={openPlan}
                    disabled={targetBusy}
                    title="The next few targets, each the nearest to the last, in the shortest order"
                  >
                    Plan {planSize}
                  </button>
                ) : null}
              </>
            ) : (
              <span>
                {target.from
                  ? `Nothing left${worthM ? ` worth ≥ ${worthM}M` : ""} that you have not done${skipped.length ? " (after your skips)" : ""}.`
                  : "Your ship's position is not known yet — jump once and try again."}
              </span>
            )}
          </div>
        ) : null}
        {planOn ? (
          <div className="g3d-menu__section" data-testid="g3d-plan">
            <div className="g3d-plan__head">
              <strong>Plan</strong>
              <button
                type="button"
                className="g3d-panel__close"
                aria-label="Close the plan"
                onClick={() => setPlanOn(false)}
              >
                ✕
              </button>
            </div>
            <MenuRow label="Stops" hint="How many systems the plan visits; the target is one of them">
              <select
                className="g3d-select g3d-row__val"
                aria-label="Stops in the plan"
                value={planSize}
                onChange={(ev) => {
                  const n = Number(ev.target.value);
                  setPlanSize(n);
                  void nextTarget(skipped, { plan: n, fly: false });
                }}
              >
                {PLAN_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </MenuRow>
            <MenuToggle
              label="Back to start"
              hint="The route ends where the ship is now: back to a carrier or a station to sell at"
              on={planLoop}
              set={(v) => {
                setPlanLoop(v);
                void nextTarget(skipped, { plan: planSize, fly: false, loop: v });
              }}
            />
            {targetBusy && !plan ? <p className="g3d-panel__note">Planning…</p> : null}
            {plan && plan.stops.length ? (
              <>
                <ol className="g3d-plan__list">
                  {plan.stops.map((s, i) => (
                    <li key={s.ordinal}>
                      <button
                        type="button"
                        className="g3d-plan__stop"
                        onClick={() =>
                          go(s, 400, { kind: "index", ordinal: s.ordinal, x: s.x, y: s.y, z: s.z })
                        }
                      >
                        <span className="g3d-plan__n">{i + 1}</span>
                        <span className="g3d-plan__name">{s.name}</span>
                        <em>
                          +{fmtLy(s.legLy)} · {s.species} sp. · {formatValue(s.valueCr / 100_000)}
                        </em>
                      </button>
                      <CopySystemButton system={s.name} />
                      <button
                        type="button"
                        className="g3d-btn g3d-plan__skip"
                        title="Skip this one; the plan is worked out again without it"
                        aria-label={`Skip ${s.name}`}
                        disabled={targetBusy}
                        onClick={() => skipStop(s.ordinal)}
                      >
                        Skip
                      </button>
                    </li>
                  ))}
                </ol>
                <p className="g3d-plan__total" data-testid="g3d-plan-total">
                  {plan.stops.length} stops · {fmtLy(plan.totalLy)} ·{" "}
                  {formatValue(plan.totalValueCr / 100_000)}
                </p>
                {plan.loop && plan.returnLy != null ? (
                  <p className="g3d-panel__note">
                    Back to the start: +{fmtLy(plan.returnLy)}, counted in the total.
                  </p>
                ) : null}
                {plan.greedyLy - plan.totalLy >= 0.5 ? (
                  <p className="g3d-panel__note" data-testid="g3d-plan-saving">
                    {fmtLy(plan.greedyLy - plan.totalLy)} shorter than taking each nearest next (
                    {fmtLy(plan.greedyLy)}).
                  </p>
                ) : null}
                <div className="g3d-panel__actions">
                  <button
                    type="button"
                    className="g3d-btn"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(plan.stops.map((s) => s.name).join("\n"))
                        .then(() => setPlanCopied(true))
                        .catch(() => setPlanCopied(false));
                    }}
                  >
                    {planCopied ? "Names copied" : "Copy names"}
                  </button>
                  <button
                    type="button"
                    className="g3d-btn"
                    onClick={() =>
                      fitTo([...(target?.from ? [target.from] : []), ...plan.stops])
                    }
                  >
                    Show all
                  </button>
                </div>
                <p className="g3d-panel__note">
                  The stops: each the nearest one to the last that is worth the floor and that you have not
                  mapped or sampled{skipVisited ? " or visited" : ""}; then visited in the shortest order
                  found. Values at 1×; legs are straight lines, not jumps.
                </p>
              </>
            ) : target && !targetBusy ? (
              <p className="g3d-panel__note">No plan: nothing qualifies from here.</p>
            ) : null}
          </div>
        ) : null}
      </aside>
  );
}
