import { HexSignals } from "./HexSignals";
import { createRoot } from "react-dom/client";
import { useEffect, useState, type ComponentType } from "react";
import "./styles.css";
import { UiFeedbackProvider } from "./ui/feedback";
import { applyAppTheme, followAppThemeChanges } from "./appTheme";
import { applyMotion } from "./motion";
import { installPressFx } from "./ui/pressFx";
import { applyUiFont } from "./uiFont";
import { applyUiStyle } from "./uiStyle";
import { applyStreamerMode, STREAMER_MODE } from "./streamerMode";
import { loadUiMirror, startUiMirrorSource, watchUiMirror } from "./uiMirror";

const screen = new URLSearchParams(window.location.search).get("screen");

/*
  Compare's App is loaded like the other screens (audit 2026-10-22). Imported statically, it made the Colonize,
  galaxy, map and triage windows fetch, parse and run its whole chunk (BodyPane, SpeciesCard and the rest) for a
  screen they never draw. Asked for here, before the streamer view's await below, so Compare's own window starts the
  download first thing.

  The other windows' own chunks the same way (2026-11-23): as a lazy() under Suspense each drew a loading note first,
  and React then held the window back until 300 ms after it (see App below). Each chunk carries its window only:
  three.js stays in the galaxy map's, Colonize's code in its own. An unknown `?screen=` opens Compare.
*/
const SCREENS: Record<string, () => Promise<ComponentType>> = {
  // `?screen=triage`: the second screen (§51) — a query parameter rather than a router, a bookmark on a phone is the
  // whole delivery mechanism.
  triage: () => import("./SecondScreen").then((m) => m.SecondScreen),
  // `?screen=map`: the galaxy sector map (Phase 10).
  map: () => import("./GalaxyMapScreen").then((m) => m.GalaxyMapScreen),
  // `?screen=galaxy`: the 3D galaxy map (docs/galaxy-plan-28092026.md), with three.js.
  galaxy: () => import("./GalaxyMap3D").then((m) => m.GalaxyMap3D),
  // `?screen=colonize`: the Colonize window (1.3.0, docs/plan-colonize-integration.md).
  colonize: () => import("./colonize/ColonizeScreen").then((m) => m.ColonizeScreen),
};
const screenImport = screen && Object.hasOwn(SCREENS, screen) ? SCREENS[screen]!() : null;
const appImport = screenImport ? null : import("./App");

// The streamer view takes the streamer's own settings first (uiMirror.ts), so even its first paint
// is what the streamer sees.
const mirrorRev = STREAMER_MODE ? await loadUiMirror() : -1;
// The colour scheme, before the first paint, so the page never flashes orange first; and again when
// another window of the app changes it.
applyAppTheme();
followAppThemeChanges();
applyMotion();
installPressFx();
applyUiFont();
applyUiStyle();
// `?view=stream`: the same app, as a picture for a stream (streamerMode.ts).
applyStreamerMode();

/*
  Compare's own window waits for its chunk before it draws anything (2026-11-16). As a lazy() under Suspense it drew
  the backdrop first, and React then held the app back until 300 ms after that first paint (its rule against a flash
  of fallback). Measured on the built app: every script was in by 90-140 ms, the header came at 450-480 ms.
*/
const App = appImport ? (await appImport).App : null;
const Screen = screenImport ? await screenImport : null;

/** The streamer view, drawn afresh whenever the streamer changes a setting in the app. */
function StreamerApp() {
  const [gen, setGen] = useState(0);
  useEffect(() => {
    watchUiMirror(mirrorRev, () => {
      applyAppTheme();
      setGen((g) => g + 1);
    });
  }, []);
  return App ? <App key={gen} /> : null;
}
// The app on this PC tells the streamer view how it is set up.
if (!STREAMER_MODE && !Screen) startUiMirrorSource();

createRoot(document.getElementById("root")!).render(
  Screen ? (
    <Screen />
  ) : (
    <UiFeedbackProvider>
      <HexSignals />
      {App ? STREAMER_MODE ? <StreamerApp /> : <App /> : null}
    </UiFeedbackProvider>
  ),
);
