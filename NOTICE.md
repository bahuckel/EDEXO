# Notice, credits and third-party material

EDEXO-Compare is MIT licensed. **The MIT licence covers the source code and the data this project
produced itself. It does not cover the species photographs, and it does not cover Elite Dangerous
game content.** See "Species photographs" below, which is the part still being resolved.

---

## Standing on other people's work

This project would not exist without these communities, none of which are affiliated with it and none
of which have endorsed it.

### Spansh — [spansh.co.uk](https://spansh.co.uk)

Where this project started. Spansh's Exomastery planning dumps showed that "which species can live on
this body" is a question data can answer; they were the project's first data and, for its first months,
its only data. The species profiles the ranking model reads are still built from Spansh exports, and the
genus chances (`data/exomastery/genus-prior.json`) are counted from the DSS genus lists of the 2.8 million
bio bodies in Spansh's galaxy dump. (Since October 2026 the predictions are measured against a year of
EDDN finds, below.) The list of
systems Frontier populated, which the app ships to tell the Bubble from player colonies, comes from
Spansh's system search (`is_colonised`); `scripts/build-developer-systems.mjs` rebuilds it. The galaxy
map's star and body filters read `data/galaxy/system-traits.bin.gz`, each system's star classes and
planet types from Spansh's galaxy dump (`scripts/build-system-traits.ts`; downloaded with the galaxy
index from the `galaxy-index` release). Since 1.2.16 the galaxy map's stations (`stations.bin`, from Spansh's
`galaxy_stations.json.gz`: names, types, pads, services) and the neutron route planner's neutron stars
(`neutrons.bin`, from Spansh's galaxy dump, each with its nearest scoopable star) and the Laboratory bodies
(`laboratory.bin`: the top 1 % of landable bodies for each of the thirteen FSD injection and AFM refill
elements, from the materials in Spansh's galaxy dump) are built from Spansh's dumps too and downloaded from the
same release.

### EDSM — [edsm.net](https://edsm.net)

Body records: gravity, temperature, pressure, atmosphere, volcanism and orbital geometry for the
bodies in the corpus, plus the system coordinates that place them. Queried through the public API at
one request per 1.5 s and cached, so a re-run costs EDSM nothing.

Codex data provided by EDSM: `data/codex/edsm-codex-regions.json` (the Encyclopedia's Codex map) is
drawn from EDSM's nightly codex dump (16.2 million sightings, 2018–2026) — per galactic region, a few
systems covering every codex entry EDSM has there, with the entries it has for each. The same dump,
matched against Spansh's bodies, is how the plant colour rules were checked on 119,657 bodies.
`data/rarity/species-rarity.json` is from the same dump: per species, how many systems EDSM's codex
has it in, galaxy-wide and per region — the rarity tiers and the region check read it.

### EDAstro — [edastro.com](https://edastro.com), by CMDR Orvidius

EDAstro's content is licensed under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/).
Part of this project's data is derived from it, which is why the project's data carries the same
licence ([`data/LICENSE-DATA.txt`](data/LICENSE-DATA.txt)). The EDAstro-derived files:

- `data/exomastery/region-species.json` — how often each species is recorded per region, from
  EDAstro's `codex-data.csv`;
- `data/exomastery/sector-map.json` — sector names from EDAstro's sector list;
- `data/exomastery/spatial-catalogue.json` — nebula coordinates (`nebulae-coordinates.csv`) and
  Guardian sites (`edsmPOI.csv`);
- `data/rarity/extra/edastro-codex-*.json` — the species–system pairs EDSM's dump does not have,
  added to the rarity counts;
- `data/rarity/body-share.json` — the rarity tiers, from the Spansh galaxy dump's bodies with EDSM's
  and EDAstro's codex;
- `src/shared/nspModelData.ts` — region and star-type averages for the phenomena prediction;
- `data/galaxy/bio-index.bin` — the galaxy map's index of systems with recorded biology: the species
  EDAstro's `codex-data.csv` has in each system, joined with the systems Spansh's galaxy dump shows
  with biological signals (a separate download from the app's `galaxy-index` release; not in this
  repository);
- `data/exomastery/genus-body-split.json` — per Sinuous Tubers and Brain Tree species, counts of
  planet type, volcanism, temperature band and atmosphere on the Spansh galaxy dump's bodies where
  EDSM's and EDAstro's codex log exactly one species of the genus in the system;
- `data/exomastery/genus-prior.json` — how often each genus is found on bodies of each planet type,
  signal count, atmosphere, temperature band, pressure band, gravity band, host star class and volcanism,
  counted from the DSS genus lists in the Spansh galaxy dump.

Releases 1.1.0 to 1.2.7 shipped these under the MIT notice by mistake; they were always under
CC BY-NC-SA 3.0. Data the app downloads from EDAstro on the user's machine (phenomena, carriers,
points of interest, galactic records) stays EDAstro's and is not part of any release.

### EDDN — the Elite Dangerous Data Network ([EDCD](https://github.com/EDCD/EDDN))

Species sightings that commanders' tools send to EDDN (organic scans and codex entries), recorded by
the owner's own listener and added to the corpus the species profiles are built from (2026-10-01:
4,743 sightings across 89 species). EDDN is a live stream for players to share game data with tools;
it carries no licence of its own. Thanks to every commander and tool author who uploads.

### EDDN archive — [EDGalaxyData](https://edgalaxydata.space/EDDN/), by CMDR Bravada Cadelanne

A day-by-day archive of the messages EDDN relays, kept since 2017 and free to download — EDGalaxyData,
run by CMDR Bravada Cadelanne ([EDCodex entry](https://edcodex.info/?m=tools&entry=491)). No licence or
terms are stated for it. This project uses it for research: a year of scans, codex entries, FSS body
signals and organic scans (2025-10 to 2026-10) to check the green gas giant catalogue and the species
predictions against other commanders' finds, with each body's conditions. The app also ships
tables measured on it: `data/exomastery/eddn-temperature-range.json` (the temperatures each species really
reaches), `colour-star-never.json` (colour stars a species is never found under), `measured-exclusions.json`
(conditions a species is never found in), `outlier-register.json` and the Encyclopedia's bands
(`species-bands.json`). Anything derived from it
that this project ships is part of the project's data and is under the data licence (CC BY-NC-SA 3.0,
[`data/LICENSE-DATA.txt`](data/LICENSE-DATA.txt)), unless CMDR Bravada Cadelanne states other terms,
in which case theirs apply. Thank you for keeping it running.

### Canonn Research Group — [canonn.science](https://canonn.science)

The app can send your discoveries to Canonn's research archive, off unless you switch it on. This
project did not start from Canonn — it started from Spansh's dumps, and its developer came across Canonn
much later — and its species rules do not come from Canonn's published conditions. Two things of
Canonn's were used afterwards as a check: its Bioforge figures, against the Bacterium tela rule, and its
codex reference list, when the colour variants' names were rebuilt from the game's own codex in
September 2026. Thank you for both.

### ED-DSN — [ed-dsn.net](https://ed-dsn.net)

The species photographs. Commanders flew to these places, landed, and photographed the organism, and
that is not a small thing to have done ninety-seven times.

The colour-variant tables in `data/species/eddsn-colour-variants.json` were transcribed from the same
site — which species reads its colour off the parent star and which off a material on the body, and
what each key maps to. Community knowledge rather than a proprietary dataset, and checked against
this commander's own journals before it was wired in, but ED-DSN is where it was read from and typing
several hundred rows by hand was the alternative.

Credited by link to the network rather than by commander name, at ED-DSN's request and ours: the
photographs were taken on an expedition years ago and a significant number of those commanders can no
longer be reached, so naming some and not others would be worse than naming none.

---

## Species photographs

`data/species/<genus>/<genus>_photos/` holds 180 images of Elite Dangerous exobiology (each also
present as a cropped card and thumbnail, so 540 files). **150 of them were contributed by commanders
of the Bahuckel clan and by the Stellar Exobiologists Guild**; the remaining 30 are sourced from the ED-DSN community, are **not covered by
this project's MIT licence** and are not this project's to sublicense.

### Telling them apart, in the app and on disk

**Every photograph the app displays carries a credit, and the credit says which of the two it is.**
There is no unlabelled image.

| what you see under the photograph                              | what it means                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`Photo by Bahuckel — CMDR <name>`**                          | Contributed. That commander took it themselves, in their own game, and gave it to this project knowingly — either the project owner's own, or a commander who photographed a species for the project or offered an existing shot in support of it. |
| **`Photo by Stellar Exobiologists Guild`**                     | Contributed by the guild, whose commanders took them in their own game and gave them to this project knowingly.                                                                                                                                    |
| **`Photo from: https://ed-dsn.net/ and its respective owner`** | Sourced from the ED-DSN community. Not this project's, not MIT, and here with ED-DSN's agreement while replacements are photographed.                                                                                                              |

A named commander under an image is therefore a positive statement about where it came from and that
its author agreed to it being here. The ED-DSN line is the standing default, applied to anything not
named in the manifest, so an image can never be silently treated as contributed.

The contributed photographs are listed in `data/species/photo-credits.json`, which names the
commander against each file:

| commander                                     | images |
| --------------------------------------------- | ------ |
| Bahuckel — CMDR FALrenica (the project owner) | 139    |
| Bahuckel — CMDR PhoEniXDFA                    | 6      |
| Stellar Exobiologists Guild                   | 5      |

Each contributor took the photographs themselves and gave them to this project knowingly. That is
the difference from the ED-DSN set below, and it is the whole reason the manifest exists: an image
credited to the wrong person is the one mistake this area of the project cannot make.

These replace the ED-DSN images, which are there mainly as placeholders. Anything not listed in the
manifest is ED-DSN's and carries the standing credit below. **Once a species has a contributed
photograph, ED-DSN's of that same species is removed from the tree** — 66 were retired this way — so
the borrowed images shrink as contributed ones arrive. They are also **variant** photographs — the
exact colour a body grows — which is what lets a card show the plant you are about to walk up to
rather than one of its siblings.

Two rights sit in each image and neither belongs to this project:

- the game artwork, which is Frontier Developments';
- the capture itself, which belongs to the commander who took it.

### What has and has not been agreed

ED-DSN's owner was asked directly, told what the images are used for, and **agreed that this project
may keep them for now**, until replacements exist. That is the agreement of the network that
curates them, and it is what this project has.

It is deliberately not described as a licence. The photographs were taken on an expedition years ago
and a significant number of those commanders are no longer reachable, so most of the individual
authors have neither granted nor refused anything — and nobody else can grant it for them. The images
are therefore here with the curator's agreement and without the authors', which is stated plainly
rather than papered over.

### They are being replaced

ED-DSN and this project are organising an expedition to photograph each species afresh, with
commanders who agree up front that their images may be used here. Those images will replace the ones
in this folder. Until then these stand in.

**If any rights holder would prefer their image not be here, it will be removed on request** — open
an issue or contact the maintainer, and no justification is needed.

## Elite Dangerous

Elite Dangerous is © Frontier Developments plc. Elite Dangerous, its logos, artwork, game content and
the names of the species catalogued here are Frontier's property, used here as fan work under
Frontier's fan-content terms. This project is not affiliated with, endorsed by, or connected to
Frontier Developments.

## Galaxy region data

`data/exomastery/region-map.json` is from
[EliteDangerousRegionMap](https://github.com/klightspeed/EliteDangerousRegionMap) by Ben Peddell,
redistributed under its MIT licence — full text in `data/exomastery/region-map.LICENSE.txt`.

## The EDEXO browser's blocking

The desktop app ships `resources/edexo/browser-adblock.cjs`, a bundle of Ghostery's
[adblocker](https://github.com/ghostery/adblocker) (`@ghostery/adblocker`, `-content`,
`-extended-selectors`, `@ghostery/url-parser`) and its `@remusao/*` helpers, all **MPL-2.0**, unmodified;
their source is at that link and on npm, and the MPL-2.0 text is at
[mozilla.org/MPL/2.0](https://www.mozilla.org/MPL/2.0/). It also contains `tldts-experimental` (MIT).

The filter lists are not shipped: the browser downloads them from their publishers when it is first
opened — [EasyList and EasyPrivacy](https://easylist.to) (GPL-3.0 / CC BY-SA 3.0),
[uBlock Origin's lists](https://github.com/uBlockOrigin/uAssets) (GPL-3.0), and uBlock Origin's scriptlet
library as Ghostery packages it (GPL-3.0). This project is not affiliated with any of them.

## Runtime dependencies

`express` (MIT) and `ws` (MIT), and the browser's blocking bundle above. Everything else in
`package.json` is a development dependency and is not redistributed with the application.
