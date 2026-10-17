/**
 * The galaxy map's Codex drawer, Biology: the entries other commanders have logged in the picked region that are not in
 * your codex there, rarest here first (1.2.19, plan F2 "codex gaps by region"), folded until opened. A click finds the
 * nearest system IN THAT REGION known to have it (owner, 2026-10-17: codex entries are per region, a system elsewhere
 * is no use) and flies there. EDAstro's codex counts, from `/api/codex/gaps` and `/api/codex/nearest`.
 */
import { useEffect, useRef, useState } from "react";
import type { CodexGapsDTO, CodexNearestDTO } from "@shared/types";
import { CopySystemButton } from "./CopySystemButton";

const SHOWN = 12;

export function CodexGapsList({
  region,
  from,
  onPick,
}: {
  region: string;
  /** Where "nearest" is measured from: the ship, else Sol. */
  from: { x: number; y: number; z: number } | null;
  onPick: (site: CodexNearestDTO) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CodexGapsDTO | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<{
    key: string;
    name: string;
    regionSystems: number;
    site: CodexNearestDTO | null;
  } | null>(null);
  // The latest click (and region): an older "nearest" answer arriving late is dropped, never flown to.
  const ask = useRef(0);

  useEffect(() => {
    let live = true;
    ask.current++;
    setData(null);
    setFailed(false);
    setAll(false);
    setPicked(null);
    fetch(`/api/codex/gaps?region=${encodeURIComponent(region)}`)
      .then((r) => (r.ok ? (r.json() as Promise<CodexGapsDTO>) : null))
      .then((d) => {
        if (!live) return;
        if (d) setData(d);
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [region]);

  const pick = (key: string, name: string, regionSystems: number) => {
    const at = from ?? { x: 0, y: 0, z: 0 };
    const q = `region=${encodeURIComponent(region)}&key=${encodeURIComponent(key)}&x=${at.x}&y=${at.y}&z=${at.z}`;
    const mine = ++ask.current;
    void fetch(`/api/codex/nearest?${q}`)
      .then((r) => (r.ok ? (r.json() as Promise<CodexNearestDTO>) : null))
      .then((site) => {
        if (mine !== ask.current) return;
        setPicked({ key, name, regionSystems, site });
        if (site) onPick(site);
      })
      .catch(() => {
        if (mine === ask.current) setPicked({ key, name, regionSystems, site: null });
      });
  };

  if (failed) return null;
  const rows = data ? (all ? data.gaps : data.gaps.slice(0, SHOWN)) : [];
  return (
    <div className="g3d-codex__gaps" data-testid="g3d-codex-gaps">
      <button
        type="button"
        className={open ? "g3d-row g3d-row--pick g3d-row--on" : "g3d-row g3d-row--pick"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="g3d-row__label">{open ? "▾" : "▸"} Not in your codex here</span>
        <span className="g3d-row__val g3d-num">{data ? data.gaps.length : "…"}</span>
      </button>
      {open && data ? (
        <>
          <p className="g3d-menu__sub">
            {data.gaps.length} of {data.known} biology entries logged in {data.region}, rarest first. Click one: the
            nearest system in {data.region} that has it.
          </p>
          {data.gaps.length ? (
            <ul className="g3d-menu__rows">
              {rows.map((g) => (
                <li key={g.key}>
                  <button
                    type="button"
                    className={picked?.key === g.key ? "g3d-row g3d-row--pick g3d-row--on" : "g3d-row g3d-row--pick"}
                    title={`${g.name}: logged in ${g.regionSystems} system${g.regionSystems === 1 ? "" : "s"} of ${data.region}, ${g.galaxySystems} galaxy-wide (EDAstro's codex). Click: the nearest of them in ${data.region}.`}
                    onClick={() => pick(g.key, g.name, g.regionSystems)}
                  >
                    <span className="g3d-row__label">{g.name}</span>
                    <span className="g3d-row__val g3d-num">
                      {g.regionSystems} · {g.galaxySystems}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="g3d-panel__note">Every biology entry logged in this region is in your codex.</p>
          )}
          {picked ? (
            <p className="g3d-panel__note" role="status">
              {picked.site ? (
                <>
                  {picked.name}: nearest in {data.region} is <strong>{picked.site.name}</strong>{" "}
                  <CopySystemButton system={picked.site.name} />,{" "}
                  {Math.round(picked.site.distanceLy).toLocaleString()} ly{from ? "" : " from Sol"}
                  {picked.site.complete
                    ? ` — the nearest of the ${picked.site.known} system${picked.site.known === 1 ? "" : "s"} it is logged in there.`
                    : ` — the nearest of ${picked.site.known} spread-out examples; it is logged in ${picked.regionSystems.toLocaleString()} systems there, so a closer one is likely.`}
                </>
              ) : (
                <>{picked.name}: no system with a known position in {data.region}.</>
              )}
            </p>
          ) : null}
          {!all && data.gaps.length > SHOWN ? (
            <button type="button" className="g3d-btn" onClick={() => setAll(true)}>
              Show all {data.gaps.length}
            </button>
          ) : null}
          <p className="g3d-panel__note">Systems here · galaxy-wide, from EDAstro&apos;s codex.</p>
        </>
      ) : null}
    </div>
  );
}
