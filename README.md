# EDEXO-Compare

Companion app for Elite Dangerous that predicts the exobiology on a planet from an FSS scan alone.

It reads your local journal folder, merges every `Journal.*.log` into one picture of the galaxy you
have visited, and — for any body with a biological signal — narrows the codex down to the species
that can actually live there, with payout ranges, first-footfall tracking, a system map and a
species encyclopedia.

Made by Bahuckel (CMDR FALrenica). Not affiliated with Frontier Developments.

## Download

Windows x64, no installer. Nothing is written to Program Files and nothing is registered with
Windows; everything the app saves lives in `%LOCALAPPDATA%\ED Exo Compare\`.

|                                                                                                                |                                                                       |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **[Portable — one file](https://github.com/bahuckel/EDEXO-Compare/releases/download/v1.2.16/EDExoCompare.exe)** | Download and run. Unpacks itself somewhere temporary each time.       |
| **[Program folder — .zip](https://github.com/bahuckel/EDEXO-Compare/releases/tag/v1.2.16-zip)**                 | Extract and keep. Starts faster, and includes the two console builds. |

Both are the same version and the same code — [all releases](https://github.com/bahuckel/EDEXO-Compare/releases).

The galaxy map's index (every system with recorded biology, from EDAstro's codex data, about 250 MB)
is a separate download: the map offers it the first time you open it, and updates leave it in place.

Windows will say the publisher is unrecognised: the executable is signed, but with a self-signed
certificate that SmartScreen does not trust. "More info" → "Run anyway".

### Linux — ![Untested](https://img.shields.io/badge/Linux-untested-orange)

**First Linux release, not yet tried on a real Linux desktop with the game running.** It starts,
finds a Proton journal folder and serves the app on Ubuntu 24.04; the HUD windows themselves have
not been seen over the game yet. If you try it, an issue saying what worked and what did not —
distro, desktop, X11 or Wayland — is the most useful thing you can send.

|                                                                                                                                         |                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **[AppImage — launcher + HUD](https://github.com/bahuckel/EDEXO-Compare/releases/download/v1.2.16-zip/EDExoCompare-1.2.16-x86_64.AppImage)** | The same app as on Windows: launcher window, tray, HUD overlays. One file, x86_64.       |
| **[Browser build — .tar.gz](https://github.com/bahuckel/EDEXO-Compare/releases/download/v1.2.16-zip/EDExoCompare-1.2.16-linux-x64.tar.gz)** | No Electron. The app and the HUD pages open in your browser. For anything the AppImage cannot run on. |

**AppImage:** `chmod +x EDExoCompare-1.2.16-x86_64.AppImage`, then run it. It needs FUSE 2:

| Distro                                            | Command                                   |
| ------------------------------------------------- | ----------------------------------------- |
| Ubuntu 24.04+, Mint 22+, Debian 13+               | `sudo apt install libfuse2t64`            |
| Ubuntu 22.04, Mint 21, Pop!\_OS 22.04, Debian 12  | `sudo apt install libfuse2`               |
| Fedora, Nobara                                    | `sudo dnf install fuse-libs`              |
| Bazzite, Silverblue (read-only)                   | `rpm-ostree install fuse-libs`, reboot    |
| openSUSE                                          | `sudo zypper install libfuse2`            |
| Arch, CachyOS, Manjaro                            | `sudo pacman -S --needed fuse2`           |

Without FUSE, `./EDExoCompare-1.2.16-x86_64.AppImage --appimage-extract-and-run` works too.

On start the launcher checks your desktop and lists anything the HUD needs that is missing, with the
install command for your distro: XWayland on a Wayland session, a compositor on a bare window
manager (the HUD is see-through only with one), the AppIndicator extension for the tray on GNOME.

**Browser build:** `tar xzf EDExoCompare-1.2.16-linux-x64.tar.gz`, then `./edexo-client.sh` in the
folder it makes. Its `README.txt` has the rest.

**Both:** the journals are found inside the game's Proton or Wine prefix — every Steam library
(native, Flatpak, Snap), Heroic and Lutris. Settings live in `~/.config/edexo-compare`. Run Elite
in **Borderless**: nothing can draw over an exclusive fullscreen game.

**Steam Deck:** in Gaming Mode the Deck's compositor (gamescope) shows one window, the game, so the
HUD windows cannot appear over it. Open the HUD in a browser on a phone or a second screen instead:
start the app in server mode (`./edexo-server.sh` in the browser build) and open
`/hud-overlay.html` at the address the launcher lists under **Network settings → LAN**. In Desktop
Mode it behaves like any Linux desktop.

## What it tells you

**Which body to fly to.** _Worth the trip?_ ranks every body in the system by expected value —
Σ chance × payout × first-footfall multiplier — alongside how many minutes on the ground it will
cost. Both timings are measured from your own journal, not guessed: approach and landing, and one
sampling run per genus.

**How likely each species is.** _Chance here_ is a calibrated probability, not a resemblance score.
It is built from how often a species has actually been recorded at this gravity, temperature,
pressure, planet class, atmosphere and host star, weighted by how common it is, and normalised
across the body's candidates. On bodies where every genus was sampled, rows it calls 90–100 % turn
up 97.8 % of the time.

**Which species, once you have mapped it.** After a DSS names the genus, the same posterior
renormalises inside that genus to say which of its species you are looking at.

**What you have not logged before.** A badge marks species new to your codex.

**What is left to find.** Achievements count every colour variant you have sampled, galaxy-wide and
region by region, with Bronze, Silver and Gold steps — plus stars, worlds and points of interest to
visit in each region. Track one and its plants are marked in the app and in the HUD.

**Where to go next.** The galaxy map (the galaxy icon in the top bar) draws all 5.3 million systems
with recorded biology in 3D, grouped by region, sector and neighbourhood, with your own systems on
top. Set a floor — _Worth ≥_ 50 M, say — and **Next target** flies to the nearest system above it that
you have not mapped or sampled, and copies its name to paste into the game's galaxy map; **Plan**
picks up to 20 more, each the nearest to the last, and visits them in the shortest order it finds —
back to where you started, if you tick **Back to start**. **NavRoute** lists every system on the
routes you plot in the game with its star class, to find neutron stars, Wolf-Rayets or black holes
along the way and check which EDSM does not know. Values there are the recorded species at 1×: those
systems come from other commanders' records, so first footfall is most likely gone. Without WebGL the
2D Classic map opens instead.

**Where it was wrong.** Every species you find that the app failed to offer is written to a local
miss log. That log is the reason recall went from 93.2 % to 97.1 %: it is read, not just recorded.

**On a second screen.** Open `?screen=triage` on a phone or tablet for a read-only triage view that
updates as you jump. In the desktop app, turn on **LAN access** in Network settings first.

**Backups.** The launcher's Backups tile zips your journals, the app's own data (settings, on-foot
scans, surface marks, the miss log) and your exomastery and codex downloads — when you leave the game,
on a timer, or when you ask. Every backup is complete; unchanged files are copied from the one before,
so it stays quick. Choose a folder on another drive, a USB drive or a synced folder: the launcher warns
in red when the folder shares a partition with your journals, and in yellow when it shares the physical
drive. A restore never overwrites: app data goes back at the next start with the replaced files set
aside, and journals go into a folder you pick.

## Everything in it

A map of the app, screen by screen. Most of it is on by default; anything that sends data anywhere is
off until you turn it on.

### The main screen

- **Header**: the system you are in and its region, whether you honked, whether you are the first
  to visit, its star types, what your unsold exploration and exobiology data is worth (as Universal
  Cartographics pays it: the honk, +30 % for mapped bodies, the gas giant classes, an optional fleet
  carrier sale at -25 % or -15 % on your own, and the Pranav Antal bonus), and whether every body is
  FSS'd.
- **Route line**: jumps before you must refuel and the light years left on the plot, with fuel
  costed by your drive's own law (learned from your jumps) and a bar for how long the tank lasts.
  The route strip puts a yellow pump on the star to refuel at and a blinking red one on the last
  scoopable star the tank reaches.
- **Next boxel**: the best unflown boxel within 500 ly by first-footfall credits per jump, asked
  again on every jump; a click opens it in the galaxy map.
- **Body tabs**: every body with biological signals, switched when you target one in the game, plus
  AutoScanned bodies that still want an FSS. Marks for a species missing from your codex (CX) and a
  first codex entry for the region (FCX).
- **Body facts**: class, atmosphere and pressure, gravity, temperature, distance from arrival,
  volcanism and its geological signal count.
- **Payout**: the least and most the body should pay, the x5 first-footfall bonus, and what you have
  already confirmed on foot or by composition scan.
- **Candidates**: each species with its chance, payout, rarity and codex marks; _Why this chance_
  says what the percentage is made of; an _Unknown plant_ row when a signal is left unfilled; Thargoid
  sites with their Vista prices; `[CODEX FIRST]` for a colour nobody has logged in the region; a
  _worth sampling_ marker where the data needs more finds.

### Screens

They open as tabs (Ctrl+Tab, Ctrl+W, drag a tab out into its own window, Shift+F1 / Shift+F2 from the
game) or as pop-ups if Tab view is off.

- **My discoveries**: every species, body, system and star in your journals, sortable and filterable
  (body features such as small bodies, fast orbits, shepherd moons), as a list or cards, with CSV
  export.
- **Unfinished business**: the biology you left behind and what it was worth.
- **System map**: every body by class with orbits, rings and moons, terraformables, the biology worth
  chasing, and a _GGG ladder_ drawer for where a gas giant stands on the cloud ladder.
- **Encyclopedia**: every species' conditions checked against the body you are at, each card coloured
  by the same check the body tab runs; gravity, temperature and pressure bands per atmosphere, measured
  on a year of finds. Also online as the
  [species guide](https://bahuckel.com/projects/edexo-compare/species).
- **Boxels**: every system in your saved boxels, flown or not, with stars, notable bodies and biology;
  a Spansh look-up; what each mass code holds across the galaxy; golden boxels where a genus is many
  times more common; a boxel run that copies the next system after every jump (F6 copy, F7 start or
  stop, F8 / F9 previous and next); your boxel history.
- **Statistics**: how you made your credits, a forecast for your next exobiologist and explorer rank,
  your records against the galactic ones, your carrier's upkeep, and _How good are my predictions_:
  every species you confirmed against what the app had listed.
- **Achievements**: quest-style goals by colour variant, region and rarity, with Bronze, Silver and
  Gold steps and a notice when you reach one; track one on the HUD.
- **Carriers** and **Points of interest**: EDAstro's lists, downloaded when you ask, searchable by
  distance and service.
- **Bookmarks** with tags, notes and distances; **Green gas giants** by CMDR Arcanic's cloud ladder;
  **Data feeder** for your own Spansh Exomastery dumps; a **Session log**.

### Galaxy map

- All 5.3 million systems with recorded biology in 3D, by region, sector and neighbourhood, with your
  own route on top; game-style controls (W A S D, Q E, R F) or a mouse; it runs on a phone.
- **Find** and filters by species, genus, star or planet type; layers for points of interest,
  Notable Stellar Phenomena, carriers, bookmarks, green gas giants and the 18 helium gas giants on
  record; your codex by region.
- **Next target** and **Plan**: the nearest system above a value you set, and up to 20 more in the
  shortest order. **NavRoute** keeps every route you plot with each system's star class.
- **Expedition**: every boxel round you, or along a route to any system you name (or one of eight
  suggestions round you), ranked by the first-footfall credits its unflown systems should pay per
  jump, or by the bodies, star type or system worth you are looking for. Systems you visited, systems
  in the galaxy index and the 4.2 million flown since 2025 without biology are taken off. A boxel's
  card lists the system names nobody has recorded, ready to copy; a plan puts up to 20 boxels in
  flying order; a species lights only the boxels its position rule allows.
- The galaxy index is a separate download from inside the map; its update button says how many systems
  it adds.

### Overlay (HUD)

Click-through panels over the game, each on or off: the exo-distance tracker (a radar with each sample
ringed at its genus's distance, and the payout), discovery scan count, candidates for the targeted
body, unsold data value, the next jumps with their star class and whether EDSM knows them, the Next
boxel line, notable bodies, notices (F5 clears them) and a tracked achievement. Stacked or merged into
one panel, in the original look, a title bar or an Elite-style frame; any colour, 50–200 % scale,
10–100 % background, hidden when the game is not in front.

### Launcher and options

- **Open exobiology UI** in the app window or your browser; a **Triage** view for a phone or tablet;
  a **Streamer view** for OBS.
- **Network settings**: this PC, your LAN (with an access key in the link) and your public address,
  each one can be hidden or turned off.
- **Backups** of your journals and the app's data, with warnings when the folder shares a drive with
  them.
- **Notify me**: notices for notable bodies, Notable Stellar Phenomena, nearby carriers with the
  services you pick, achievements, with or without sound.
- **Colour scheme** for the app and the HUD; **key binds** in one place, live only while Elite or the
  app is in front; **snapshot images** that render what you see without taking a screenshot of your
  screen; **About this install** for a bug report with paths masked.
- **Opt-ins**, each off by default: EDSM look-ups and journal upload (your own API key), Canonn, EDDN.
- **Close to tray**, and **What's new** once after each update.

## Where the predictions come from

Two sources, and the app tells them apart.

The **codex rows** in `data/species/` say where a species should grow. A local corpus of ~39,000
real sightings says where it has grown. Where they disagree on a species the corpus has watched
enough times, **observation wins** — for host star, planet class, temperature, volcanism type,
gravity and atmosphere. Each of those six thresholds was swept against the app's own accuracy probe
before it shipped.

No number reaches the screen as a percentage unless the probe has calibrated it.

### The 1 % chance floor

Every candidate carries a **Chance here** figure — how often a species with this profile turns out to
actually be on a body like this one. It is the one percentage in the app that has been calibrated
against real outcomes: on bodies where every species is known, the 90-100 % band comes in at 97.8 %
and the 0-10 % band at 8.9 %.

Candidates below **1 %** are moved behind _show unlikely_ rather than listed. The rule is no misses
first: a list of three where one is right beats a list of one that is wrong. The floor was 5 % until
1.2.11; measured over 2,960 bodies of every genus, 5 % hid the right species on 25 of them, 1 % on 4,
for one wrong row more on 2.5 % of the bodies.

The floor never empties a panel — if nothing clears it, the single best candidate stays — never
touches a row the model has no opinion about, and never argues with a species you have scanned on
foot yourself. Checked against other commanders' finds on EDDN: after a DSS, 6,599 of 6,599 species
were listed.

To change it, edit `PRESENCE_FLOOR_PCT` in [`src/server/presenceFloors.ts`](src/server/presenceFloors.ts) and
rebuild.

## EDSM

The app can look a system up on [EDSM](https://www.edsm.net/) so a system already in the community
database can be triaged before you arrive.

This is **off by default**, and it stays off until you enter your own EDSM API key from
[edsm.net/en/settings/api](https://www.edsm.net/en/settings/api) in **Options**. Turning it on sends
the name of each system you jump to to EDSM, at most once per system — asked the moment the FSD
starts its countdown, so the answer is waiting when you drop out of witchspace rather than arriving
after you have already read an empty panel. The key is stored on your
machine in its own file beside your settings, never in the settings file, and **Forget key** deletes
it and switches auto-fetch off.

## Canonn

The app can send your discoveries to [Canonn Research](https://canonn.science/), the community
science archive. The project is not affiliated with Canonn and its data does not come from there; the
switch is there for commanders who want to help their research.

This is **off by default**. Turning it on sends organic scans, the sales that date them, codex
entries and whatever else Canonn is currently asking for — **with your CMDR name attached**, because
their archive is keyed on it, and with the journal line exactly as the game wrote it. There is no
anonymous form of it. Only live events go: switching it on never uploads journals you already have.

There is no telemetry and no analytics. Three requests run without a switch, and none carries
anything about you: the update check (each time the launcher opens, at most once an hour, GitHub is
asked for this project's releases; the app's version is in the user agent), the game server status,
and EDSM's answer to which systems on your plotted route it already knows (the system names only).
Every request is listed in the [privacy policy](public/legal/privacy.html), which ships with the app.

## Running it

The packaged app is a small launcher window; the app itself opens in your browser.

```
npm install
npm run dev            # Vite (5173) + API/WS (7111)
npm run electron:dev   # build, bundle and launch the Electron launcher
npm run dist:win       # portable .exe + CLI build into dist/
```

Point it at your journal folder from the launcher (**Journal folder**) if it is not in the default
`Saved Games\Frontier Developments\Elite Dangerous`.

### Ports and network modes

|                        | Binds            | Who can reach it                             |
| ---------------------- | ---------------- | -------------------------------------------- |
| `npm run start:client` | `127.0.0.1:7111` | this PC only                                 |
| `npm run start:server` | `0.0.0.0:7111`   | this PC **and every device on your network** |
| desktop app            | `127.0.0.1:7111` | this PC; with **LAN access** on, `0.0.0.0:7111` and your network too |

The desktop app (`.exe`, AppImage) has a **LAN access** switch in the launcher's **Network
settings**: off for a new install, so only this PC can open it; on for an install that already had
it. It applies after a restart.

Server mode exists so you can put the app on a second monitor, a tablet or a phone. It also means
the mutating endpoints (settings, exobiology reset, which system you are viewing) are reachable from
the LAN, so every non-loopback client must present an **access key**:

- the key is minted on first server-mode launch and stored beside your user settings
  (`%LOCALAPPDATA%\ED Exo Compare\edexo-compare-lan-key.txt`);
- the launcher's **Network settings → LAN** links already carry it as `?k=…`; open one on a device
  and it stays paired for a year via a cookie;
- requests from this PC never need it, so nothing about the local experience changes;
- delete the key file to un-pair every device.

Pass `--local` (or `--host 127.0.0.1`) to bind to this PC only, and no key is used at all.

## Development

```
npm test               # vitest over the pure logic (matching, payouts, layout, cache encoding)
npm run lint
npm run typecheck      # client + shared
npm run typecheck:server
npm run typecheck:tests
npm run format
```

### Measuring it

Accuracy is a measurement, not an opinion. The probes run against your own journal cache and the
species database, and print both scenarios — FSS-only and post-DSS — because a number for one of
them alone does not count.

```
npm run probe          # recall, ambiguity, precision, decidability, missing gate
npm run rank-probe     # mean rank, top-1, top-3, calibration buckets
npm run fixture        # regenerate the 20-body golden candidate fixture
```

`missing gate` is the one to watch: bodies where the app offers fewer candidates than the game
itself reports signals. It needs no ground truth to prove, and it should stay at zero.

### The feeder

The species profiles the model reads are built from a local corpus of Spansh exports hydrated
against EDSM. That corpus is a build input and is not in this repository.

```
npm run feeder -- status              # what the corpus holds vs what the app ships
npm run feeder -- import <file.csv>   # the one manual step
npm run feeder -- run [species...]    # hydrate, analyse, install
npm run feeder -- rebuild [species...] # rebuild profiles from packs on disk, no network
npm run feeder -- pack [species...]   # fold loose sample files into per-species archives
```

`EDEXO_PERF=1` turns on the server-side performance log — timers, counters and payload sizes
reported every 30 s. It is a no-op otherwise, so it stays compiled in permanently:
`npm run dev:perf` or `npm run start:client:perf`.

## Layout

```
src/server/     journal merge, species matching, the ranking model, HTTP + WS
src/client/     the React app, and the second screen
src/shared/     types and pure helpers used by both
src/feeder/     corpus → shipped species profiles
scripts/        the feeder CLI and the accuracy probes
data/species/   the species database, one folder per genus
public/         launcher, the transparent HUD overlays, and the privacy policy and terms (legal/)
electron/       launcher window
tests/          vitest suites
docs/archive/   internal planning notes — not tracked, see .gitignore
```

## Credits

Built on these communities' work, none of them affiliated with this project:

- **[Spansh](https://spansh.co.uk)** — the reason it was started, and the corpus every prediction is
  measured against.
- **[EDSM](https://edsm.net)** — body records and system coordinates.
- **[Canonn Research Group](https://canonn.science)** — the published species conditions every gate
  in this app started from.
- **[ED-DSN](https://ed-dsn.net)** — the species photographs.
- **[EDDN](https://github.com/EDCD/EDDN)** (Elite Dangerous Data Network) — other commanders' live
  scans, the test set every prediction is checked against.
- **[EDGalaxyData](https://edgalaxydata.space/EDDN/)** by CMDR Bravada Cadelanne — EDDN's messages
  kept day by day since 2017, for checking against past finds.
- **[EDAstro](https://edastro.com)** — the codex sightings behind the galaxy map's index.

Full attribution in [NOTICE.md](NOTICE.md).

## Licence

Three parts, three licences:

- **Code — MIT.** See [LICENSE](LICENSE).
- **Data — [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/).** The `data/`
  folder and the data tables generated into the code: credit the sources, no commercial use, share
  alike. Part of it is derived from [EDAstro](https://edastro.com)'s content, which carries this
  licence, so the data carries it too. Details, and the EDAstro-derived files, in
  [`data/LICENSE-DATA.txt`](data/LICENSE-DATA.txt). Releases 1.1.0–1.2.7 shipped those files under
  the MIT notice by mistake; the notice applies to them as well.
- **Photographs — Frontier's.** They are screenshots of Elite Dangerous; the game and its artwork
  belong to Frontier Developments and are under Frontier's terms, not either licence here.

If you use the code in something of your own, a credit and a link back — "based on EDEXO-Compare by
Bahuckel, https://bahuckel.com/projects/edexo-compare" — is appreciated; for the code it is a request,
not a term. For the data, credit is part of the licence.

**Every photograph in the app is labelled with where it came from**, and the label is the answer:

- **`Photo by Bahuckel — CMDR <name>`** — contributed. That commander took it themselves and gave it
  to this project knowingly: either the project owner's own, or a commander who photographed a
  species for the project or offered an existing shot in support of it. These are listed by file in
  [`data/species/photo-credits.json`](data/species/photo-credits.json).
- **`Photo from: https://ed-dsn.net/ and its respective owner`** — sourced from the
  [ED-DSN](https://ed-dsn.net) community. Here with ED-DSN's agreement while replacements are
  photographed, and the standing credit for anything not named in that manifest.

So a named commander under an image means its author agreed to it being here; the ED-DSN line is the
default, which is why an image can never quietly pass as contributed. Any rights holder who would
prefer theirs removed can ask and it will be, with no justification needed — see
[NOTICE.md](NOTICE.md).

Elite Dangerous, its artwork and game content remain the property of Frontier Developments; see
the [terms](public/legal/terms.html).
