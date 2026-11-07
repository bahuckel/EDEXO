# Edexo Inara scrape (Chrome)

Manual helper: open an Inara buy-search link from EDEXO's Colonize window (a material nobody sells nearby has an **Inara** button). In the top Inara nav (next to Elite:Dangerous / Starfield), use **EDEXO Colonize:** → **Scrape info**.

## Install

1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → this `chrome-extension` folder

## Where scrapes go

`Downloads\EdexoColonize\inara`, always — there is no folder to choose. The app watches that folder
on its own, in addition to the folder set under Colonize → Sources → Inara imports.

The extension writes through Chrome's own download machinery, which cannot leave the download
directory. Before 0.3.0 it kept a `FileSystemDirectoryHandle` in IndexedDB so it could write to a
folder you picked — but a content script shares storage with the page it runs on, so that handle
sat in inara.cz's database where any script on the site could have used it to write into a folder
the app imports without asking. Hence the fixed path.

If Chrome is set to **Ask where to save each file**, it will ask; point it at that folder or turn
the setting off for scraping.

## Use

1. In the app Build tab, click **Inara** next to a remaining material (near the **construction** system).
2. Wait until Inara shows stations for **that** commodity.
3. Click **Scrape info** in the EDEXO cluster in Inara’s top nav.
4. The app picks the file up and merges the stations into the local buy index.
