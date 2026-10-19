/**
 * The galaxy map's menus, in the game's own manner (owner, 2026-10-04, after the in-game comms panel):
 * a row of icon tabs at the top left, and under the open one a list of rows — the label on the left,
 * its value in a box on the right, the row lit when the pointer is on it. Every tab and row explains
 * itself on hover, and each menu has a [?] for the longer story.
 */
import type { ReactNode } from "react";
import { BookOpen, Compass, Crosshair, Eye, Filter, FlaskConical, Layers, Route, ScanSearch, Search, type LucideIcon } from "lucide-react";
import { InfoPopover, Tooltip } from "../ui/Tooltip";

export type G3dTabKey =
  | "view"
  | "layers"
  | "filter"
  | "search"
  | "navroute"
  | "codex"
  | "targets"
  | "expedition"
  | "neutron"
  | "stations"
  | "jumponium"
  | "finder";

export const G3D_TABS: { key: G3dTabKey; label: string; hint: string }[] = [
  { key: "view", label: "View", hint: "View: camera, follow your ship, colours, brightness" },
  {
    key: "layers",
    label: "Layers",
    hint: "Layers: your systems, borders, names, points of interest, carriers, bookmarks…",
  },
  {
    key: "filter",
    label: "Filter",
    hint: "Filter: light the systems with a star, a planet type or a plant you pick",
  },
  {
    key: "search",
    label: "Search",
    hint: "Species search: where a species has been recorded, nearest first",
  },
  {
    key: "navroute",
    label: "NavRoute",
    hint: "NavRoute: the route plotted now (Next) and the systems you have been to (Previous)",
  },
  { key: "codex", label: "Codex", hint: "Codex: what you have logged, region by region" },
  {
    key: "targets",
    label: "Targets",
    hint: "Biology targets: the nearest system worth flying to, and a plan of several",
  },
  {
    key: "expedition",
    label: "Expedition",
    hint: "Expedition: where nobody has been yet — boxels ranked by the first-footfall credits they are likely to hold per jump",
  },
  {
    key: "neutron",
    label: "Neutron",
    hint: "Neutron route: through two or more systems by supercharged jumps, with refuel stops and the FSD's wear",
  },
  {
    key: "stations",
    label: "Stations",
    hint: "Stations: the nearest station with the services you pick (repair, refuel, Vista Genomics…), shown on the map",
  },
  {
    key: "finder",
    label: "Colonisation candidate search",
    hint: "Colonisation candidate search: systems round your colonies, a system you pick or every colonised one — by the bodies they have, without the systems already taken",
  },
  {
    key: "jumponium",
    label: "Laboratory",
    hint: "Laboratory: the jumponium and AFM refill materials you hold, what they make, and the nearest bodies rich in the ones you pick, shown on the map",
  },
];

export const G3D_HELP: Record<G3dTabKey, string[]> = {
  finder: [
    "Systems within the distance you set of a reference: your colonised systems (from your journals), a system you select on the map or type, or every colonised system in the galaxy. The distance runs from 15 to 150 ly in steps of 5; each system is measured from the nearest reference.",
    "Every filter is a floor — at least this many of a body type, ringed, landable or terraformable bodies, bodies with biology or geology signals (any species: the signal is what counts) — and the stars: the main star's class, or a black hole, neutron star, white dwarf or giant anywhere in it. Hide colonised leaves out every system someone colonised or claimed, Frontier's own inhabited systems, and your own colonies.",
    "The data is a download of its own: the systems within 150 ly of inhabited space, from Spansh's dump. The counts are the bodies Spansh lists, so a system may hold more than it shows; Fully scanned only keeps the systems whose every body is listed. Colonisation is as of the data's date: a system claimed since may still show.",
  ],
  jumponium: [
    "Two tabs: Jumponium, the FSD injection materials (Basic +25 %, Standard +50 %, Premium +100 % jump range for one jump), and AFM Refill, the materials that refill an AFMU (Standard and Premium repair faster). Each shows what you hold (from your journals: the game writes the list at every login, the app follows each pick-up, trade and synthesis after it) and how many of each tier that makes.",
    "Below, the nearest landable bodies with the elements you pick. Rich is the top tenth of landable bodies for an element, Top 1 % the best hundredth. Carbon, nickel, chromium and manganese are on most bodies and are not listed. No body carries all five premium jumponium elements: premium always takes two or more bodies.",
    "Your own scanned bodies are always searched. The rest of the galaxy comes from a file downloaded with the galaxy index: the top 1 % of landable bodies for each of thirteen elements, from Spansh's dump. An AFMU's ammunition is not in the journals: the app knows whether one is fitted, not how full it is.",
  ],
  stations: [
    "The nearest stations to your ship with every service you pick (or any of them), a pad big enough and not too far from the arrival star. Settlements and colony construction sites only if you ask for them.",
    "Click a row to fly the map there; Layers → Stations shows every system with a station, and pointing at one names its stations.",
    "From Spansh's station dump, downloaded with the galaxy index (or alone here). Fleet carriers are in Carriers.",
  ],
  view: [
    "Top looks straight down on the galaxy, Tilt across it at an angle. Core flies to Sagittarius A*, Sol home, Me to your ship.",
    "Follow my ship keeps the camera on you: each jump moves it with you, at the distance you were looking from.",
    "Colour by Evidence shows how sure each record is — mapped with a DSS, codex logged, or signals only. Species count and Value show how rich a system is.",
    "With the mouse: left drag pans, right drag tilts and turns, the wheel zooms. Click a ring to open a group, a dot to open a system.",
  ],
  layers: [
    "What is drawn over the 5.3 million systems. Your systems: amber where signals still wait for you, green where you mapped or sampled, grey where you only passed through.",
    "Region borders and names, the groups that stand for many systems when zoomed out, and the Milky Way drawn behind them.",
    "Points of interest, notable phenomena, fleet carriers, your bookmarks and green gas giants come from lists already on this PC; a layer that needs a download says so.",
  ],
  filter: [
    "Tick what you are after — a star class, a planet type, a genus or a species — and the systems that have it light up while the rest dim. Several ticks in one group mean any of them; across groups, all of them.",
    "Star and planet types come from Spansh's galaxy dump; the plants from EDAstro's codex records.",
  ],
  search: [
    "Where has a species been recorded? Pick one, or a minimum value, and the map shows the systems where commanders logged it, nearest first.",
    "These are recorded sightings, not the app's predictions.",
  ],
  navroute: [
    "Next is the route plotted now in the game's galaxy map, read from NavRoute.json with each system's star class and coordinates — a free survey of the star types on the way. Check EDSM asks which of them EDSM knows: one it does not is a system nobody has reported.",
    "Previous is the systems you have been to, from your journals, over the last day, week, month, three months, year or all of it.",
    "Pick a star type to find neutron stars, Wolf-Rayets or black holes; ☆ keeps one as a bookmark. Layers → NavRoute – unvisited places the route ahead on the map.",
  ],
  codex: [
    "Your codex, region by region: how many of a region's entries you have logged. Click a region on the map or in the list to see its systems.",
  ],
  neutron: [
    "A route through two or more systems, jumping from neutron star to neutron star: at one the FSD supercharges and the next jump reaches four times your range (six in a Caspian Explorer: read from the ship you fly).",
    "Your jump range, how many full-range jumps a tank does and the fuel aboard come from your journals; change them for another ship.",
    "Refuel stops are neutron stars with a scoopable star of their own (four in ten): scoop it, then supercharge. Where only normal jumps cross a gap longer than the tank lasts, the route says to scoop on the way.",
    "Every supercharge wears the FSD, by how much depends on the ship and its drive: learned for each ship from its Loadouts (about 1 % until it has three supercharges between two of them). The plan marks where it is expected under 80 %: repair before going on — Carriers → Stations → Repair finds the nearest.",
    "Fly this route: after each jump onto a stop, the next stop goes to the clipboard (paste it in the game's galaxy map; F6 copies it again) and the HUD's Next jump says where to scoop and supercharge. It ends at the last stop, with Stop, or when a boxel run starts.",
    "The neutron stars are a separate download beside the galaxy index; a plan reads only the part of the galaxy it crosses.",
  ],
  expedition: [
    "Where to go for first footfalls in space nobody has recorded. Every boxel around you is scored from the Spansh dump: how many systems a boxel of its size holds in this region, how often one has biology, how many biological bodies, and what the genera seen there are worth at five times for a first footfall. Systems already in the galaxy index count against it: someone has been. So do the ones somebody flew since 2025 and found without biology, and the ones you have visited.",
    "Ranked by credits per jump — the jumps to reach the boxel plus one per system in it, so a huge boxel has to earn its flying. Pick a species to light only the boxels where it can grow (its nebula, Guardian or core rule) and rank them by how many of its bodies they should hold.",
    "Type: a sphere round you, or a route to a system — search one, or pick a suggestion in eight directions round you — with the boxels within the corridor of the line, ranked by the detour of going by them.",
    "Looking for: exobiology, or bodies (Earth-likes, water and ammonia worlds, helium-rich gas giants, boxels dense with gas giants), a main star type, or systems worth a sum to a first discoverer who scans and maps it all and samples its biology. Those come from the systems Spansh holds whole in the same region and mass code; a boxel's unflown systems are expected to be like them.",
    "These are averages over many boxels like it, not a promise about one. Click a boxel for the system names nobody has recorded yet, copy one into the game's galaxy map, and add boxels to a plan to see the order and the jumps.",
  ],
  targets: [
    "For exobiology runs. Set a floor and Next target finds the nearest system worth at least that much that you have not mapped or sampled, flies there and copies its name for the game's galaxy map.",
    "Plan adds more stops, each the nearest worthwhile system to the last, and visits them in the shortest order it finds — back to where you started, if you tick Back to start.",
    "Values are the recorded species at 1×: these systems come from other commanders' records, so the first footfall is most likely gone.",
  ],
};

/** A menu's title row with its [?]. */
export function MenuHead({ title, help }: { title: string; help: string[] }) {
  return (
    <div className="g3d-menu__head">
      <span>{title}</span>
      <InfoPopover title={title} label={`About ${title}`}>
        {help.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </InfoPopover>
    </div>
  );
}

/** One row: the label (with its hover explanation) on the left, the control on the right. */
export function MenuRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="g3d-row">
      <Tooltip text={hint} className="g3d-row__label">
        <span>{label}</span>
      </Tooltip>
      <span className="g3d-row__ctl">{children}</span>
    </div>
  );
}

/** An on / off row, a checkbox under the game-style value box. */
export function MenuToggle({
  label,
  hint,
  on,
  set,
}: {
  label: string;
  hint: string;
  on: boolean;
  set: (v: boolean) => void;
}) {
  return (
    <label className="g3d-row g3d-row--check">
      <input
        type="checkbox"
        className="g3d-row__box"
        checked={on}
        onChange={(ev) => set(ev.target.checked)}
      />
      <Tooltip text={hint} className="g3d-row__label">
        <span>{label}</span>
      </Tooltip>
      <span className="g3d-row__val">{on ? "On" : "Off"}</span>
    </label>
  );
}

/*
  The tab icons, 24 × 24 in the current colour: lucide's (1.2.17, owner 2026-10-15: "uses for lucide approved") at the
  stroke the drawn ones had, except the two drawn for him — the Coriolis starport and the neutron star — which stay.
*/
const LUCIDE_TABS: Partial<Record<G3dTabKey, LucideIcon>> = {
  view: Eye,
  layers: Layers,
  filter: Filter,
  search: Search,
  navroute: Route,
  codex: BookOpen,
  targets: Crosshair,
  expedition: Compass,
  jumponium: FlaskConical,
  finder: ScanSearch,
};

export function G3dIcon({ name }: { name: G3dTabKey }) {
  const L = LUCIDE_TABS[name];
  if (L) return <L className="g3d-tab__icon" strokeWidth={1.7} aria-hidden="true" focusable="false" />;
  const p = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  return (
    <svg className="g3d-tab__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === "stations" ? (
        /*
          A Coriolis starport face on (owner, 2026-10-13): a cuboctahedron — six squares meeting at their corners, a
          triangle in each gap. From the front its outline is a square; the front square stands on a corner inside
          it, touching each side in the middle, the four corner gaps are triangles, and the docking slot lies level
          across the middle, from the left corner towards the right.
        */
        <>
          <path {...p} d="M3.5 3.5h17v17h-17z" />
          <path {...p} d="M12 3.5 20.5 12 12 20.5 3.5 12z" />
          <path {...p} d="M8.6 11.3h6.8v1.4H8.6z" strokeWidth={1.3} />
        </>
      ) : (
        /*
          A neutron star, not a sun (owner, 2026-10-15): a small bright core, the two jets the game draws along its
          axis, and a thin ring tilted across them.
        */
        <>
          <ellipse {...p} cx="12" cy="12" rx="9" ry="2.6" transform="rotate(45 12 12)" strokeWidth={1.1} opacity={0.75} />
          <path {...p} d="M13.3 10.7 19.4 2.6 21.4 4.6z M10.7 13.3 4.6 21.4 2.6 19.4z" fill="currentColor" strokeWidth={1} />
          <circle {...p} cx="12" cy="12" r="2.2" fill="currentColor" />
        </>
      )}
    </svg>
  );
}
