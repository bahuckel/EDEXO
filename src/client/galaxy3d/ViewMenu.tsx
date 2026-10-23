/**
 * The View drawer: camera, follow, Elite controls, colour and brightness. Moved out of GalaxyMap3D.tsx
 * (audit 2026-10-22).
 */
import type { GalaxyRouteDTO } from "@shared/types";
import { Tooltip } from "../ui/Tooltip";
import { GalaxyIndexRow } from "../GalaxyIndexDownload";
import { G3D_HELP, MenuHead, MenuRow, MenuToggle } from "./G3dMenu";
import type { Colour } from "./mapConstants";

const colours: [Colour, string][] = [
  [0, "Evidence"],
  [1, "Species count"],
  [2, "Value"],
];

export function ViewMenu({
  view,
  route,
  toShip,
  ship,
  follow,
  setFollow,
  elite,
  setElite,
  colour,
  setColour,
  exposure,
  setExposure,
}: {
  view: (k: "top" | "tilted" | "core" | "sol") => void;
  route: GalaxyRouteDTO | null;
  toShip: () => void;
  ship: GalaxyRouteDTO["position"] | undefined;
  follow: boolean;
  setFollow: (v: boolean) => void;
  elite: boolean;
  setElite: (v: boolean) => void;
  colour: Colour;
  setColour: (c: Colour) => void;
  exposure: number;
  setExposure: (v: number) => void;
}) {
  return (
    <aside className="g3d-drawer g3d-menu" aria-label="View" data-testid="g3d-view">
      <MenuHead title="View" help={G3D_HELP.view} />
      <div className="g3d-row g3d-row--buttons" role="group" aria-label="Camera">
        <Tooltip text="Look straight down on the galaxy">
          <button type="button" className="g3d-btn" onClick={() => view("top")}>
            Top
          </button>
        </Tooltip>
        <Tooltip text="Look across the disc at an angle">
          <button type="button" className="g3d-btn" onClick={() => view("tilted")}>
            Tilt
          </button>
        </Tooltip>
        <Tooltip text="Fly to the galactic core, Sagittarius A*">
          <button type="button" className="g3d-btn" onClick={() => view("core")}>
            Core
          </button>
        </Tooltip>
        <Tooltip text="Fly home to Sol">
          <button type="button" className="g3d-btn" onClick={() => view("sol")}>
            Sol
          </button>
        </Tooltip>
        <Tooltip
          text={
            route?.system
              ? `Fly to your ship, in ${route.system}`
              : "Your ship's position is not known yet"
          }
        >
          <button type="button" className="g3d-btn" onClick={toShip} disabled={!ship}>
            Me
          </button>
        </Tooltip>
      </div>
      <MenuToggle
        label="Follow my ship"
        hint="When you jump, the camera moves with you and keeps its distance"
        on={follow}
        set={setFollow}
      />
      <MenuToggle
        label="Elite controls"
        hint="The game's galaxy map: a cross-hair with its shadow on the galactic plane. W A S D move it, Q E turn, R F raise and lower it; left drag turns and tilts all the way round (under the map too), right drag turns and raises; the wheel zooms. Moving is faster zoomed out."
        on={elite}
        set={setElite}
      />
      <MenuRow
        label="Colour by"
        hint="Evidence: how sure the record is (mapped, codex logged, signals only). Species count and Value: how rich the system is."
      >
        <select
          className="g3d-select g3d-row__val"
          aria-label="Colour by"
          value={colour}
          onChange={(ev) => setColour(Number(ev.target.value) as Colour)}
        >
          {colours.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </MenuRow>
      <MenuRow label="Brightness" hint="How bright the systems are drawn">
        <input
          type="range"
          className="g3d-row__range"
          min={0.2}
          max={4}
          step={0.1}
          value={exposure}
          aria-label="Brightness"
          onChange={(ev) => setExposure(Number(ev.target.value))}
        />
      </MenuRow>
      <GalaxyIndexRow />
      <MenuRow
        label="Classic map"
        hint="The 2D sector map, for a machine without 3D graphics or a quick look"
      >
        <a className="g3d-row__val g3d-classic" href="?screen=map">
          Open
        </a>
      </MenuRow>
      <p className="g3d-panel__note">
        {elite
          ? "W A S D move · Q E turn · R F up / down · left drag turns and tilts · right drag turns and raises · the wheel zooms."
          : "Left drag pans · right drag tilts and turns · the wheel zooms · click a ring or a system."}
      </p>
    </aside>
  );
}
