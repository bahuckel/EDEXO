/*
  The launcher's page script (launcher.html), built by Vite since 1.3.1 (discuss item 19): minified, cached for a year
  under its hashed name, and able to import what the app shares (the HUD section list, the HUD's colours). It was one
  3,700-line script in public/; each part is now a module, and this runs them in the order the old script did.
*/
import { start as networkStart } from "./network.js";
import { start as updateStart } from "./update.js";
import { start as whatsNewStart } from "./whatsNew.js";
import { start as optionsStart } from "./options.js";
import { start as keybindsStart } from "./keybinds.js";
import { start as commandersStart } from "./commanders.js";
import { start as openUiStart } from "./openUi.js";
import { start as exomasteryStart } from "./exomastery.js";
import { start as hudOverlaysStart } from "./hudOverlays.js";
import { start as liveStripStart } from "./liveStrip.js";
import { start as hudSettingsStart } from "./hudSettings.js";
import { start as backupStart } from "./backup.js";
import { start as dataImportStart } from "./dataImport.js";
import { start as linuxSetupStart } from "./linuxSetup.js";
import { start as trayGraphicsStart } from "./trayGraphics.js";
import { start as wizardStart } from "./wizard.js";
import { connectWs, loopPoll } from "./status.js";

networkStart();
updateStart();
whatsNewStart();
optionsStart();
keybindsStart();
commandersStart();
openUiStart();
exomasteryStart();
hudOverlaysStart();
liveStripStart();
hudSettingsStart();
backupStart();
dataImportStart();
linuxSetupStart();
trayGraphicsStart();
wizardStart();

connectWs();
loopPoll();

// The logo hides itself when the icon cannot load (was an inline onerror, which the CSP forbids).
(function () {
  var logo = document.querySelector("img.logo");
  if (!logo) return;
  var hide = function () {
    logo.style.display = "none";
  };
  if (logo.complete && logo.naturalWidth === 0) hide();
  else logo.addEventListener("error", hide);
})();
