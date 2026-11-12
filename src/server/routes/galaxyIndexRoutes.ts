/*
  The galaxy index download with the stations, neutron stars and jumponium: /api/galaxy/index (split out of
  galaxyRoutes.ts, plan 2026-11-10 Phase 7.2; registered from it in the same order).
*/
import type express from "express";
import { localOnly } from "../lanAuth.js";
import type { HttpServerOptions } from "../httpServerTypes.js";
import { clearGalaxyPoints } from "../galaxyPoints.js";
import { clearTileIndex } from "../galaxyTiles.js";
import { clearBioIndexCache } from "../bioIndex.js";
import { clearGalaxyCatalogueCache, clearGalaxySystemValues } from "../galaxyValueSearch.js";
import { clearSystemTraits } from "../galaxyTraits.js";
import { downloadGalaxyIndex, galaxyIndexStatus, probeGalaxyIndexSize } from "../galaxyIndexFiles.js";
import { downloadStations, probeStationsRelease, stationsStatus } from "../stationsIndex.js";
import { downloadNeutrons, neutronsStatus, probeNeutronsRelease } from "../neutronIndex.js";
import { downloadJumponium, jumponiumIndexStatus, probeJumponiumRelease } from "../jumponiumIndex.js";

export function registerGalaxyIndexRoutes(app: express.Express, opts: HttpServerOptions): void {
  /**
   * The galaxy index as a separate download (plan 4.2, 2026-10-04): whether it is here, how big the
   * download is, and its progress; POST starts it. Builds leave the files out.
   */
  /*
    One download for the map's data (owner, 2026-10-13: "combined index"): the galaxy index, then the stations and
    the neutron stars, each from the same release. Their own tabs still offer them alone; the status says what
    is missing and what the whole download weighs.
  */
  const extrasStatus = () => {
    const st = stationsStatus();
    const nt = neutronsStatus();
    const jp = jumponiumIndexStatus();
    // Due: not here, or the release has another build (its count differs) — what the download fetches.
    return {
      stations: {
        present: st.present,
        due: !st.present || (st.release != null && st.release.stations !== st.stations),
        downloading: st.downloading,
        error: st.error,
        bytes: st.release?.bytes ?? null,
      },
      neutrons: {
        present: nt.present,
        due: !nt.present || (nt.release != null && nt.release.neutrons !== nt.neutrons),
        downloading: nt.downloading,
        error: nt.error,
        bytes: nt.release?.bytes ?? null,
      },
      jumponium: {
        present: jp.present,
        due: !jp.present || (jp.release != null && jp.release.bodies !== jp.bodies),
        downloading: jp.downloading,
        error: jp.error,
        bytes: jp.release?.bytes ?? null,
      },
    };
  };
  const combinedStatus = () => {
    const st = galaxyIndexStatus();
    const ex = extrasStatus();
    const missing = [ex.stations, ex.neutrons, ex.jumponium].filter((x) => x.due);
    const extraBytes = missing.reduce((a, x) => a + (x.bytes ?? 0), 0);
    // Progress of whichever part is coming down.
    const downloading =
      st.downloading ??
      (ex.stations.downloading ? { name: "stations.bin.gz", ...ex.stations.downloading } : null) ??
      (ex.neutrons.downloading ? { name: "neutrons.bin.gz", ...ex.neutrons.downloading } : null) ??
      (ex.jumponium.downloading ? { name: "laboratory.bin.gz", ...ex.jumponium.downloading } : null);
    return {
      ...st,
      downloading,
      error: st.error ?? ex.stations.error ?? ex.neutrons.error ?? ex.jumponium.error,
      extras: ex,
      // The whole download is under way (between two parts nothing is coming down for a moment).
      busy: combinedRunning,
      extrasMissing: missing.length,
      extraBytes,
      downloadBytes: st.downloadBytes != null ? st.downloadBytes + extraBytes : null,
    };
  };
  let indexProbedAt = 0;
  app.get("/api/galaxy/index", async (_req, res) => {
    const st = galaxyIndexStatus();
    // The release's sizes (HEAD requests): every ten minutes at most while unknown, and again after an hour, so a
    // release published while the app runs lights the update buttons (owner, 2026-11-01).
    const since = Date.now() - indexProbedAt;
    if (((st.downloadBytes == null || st.updateAvailable == null) && since > 600_000) || since > 3_600_000) {
      indexProbedAt = Date.now();
      await Promise.all([probeGalaxyIndexSize(), probeStationsRelease(), probeNeutronsRelease(), probeJumponiumRelease()]);
    }
    res.json(combinedStatus());
  });
  let combinedRunning = false;
  app.post("/api/galaxy/index/download", localOnly, (req, res) => {
    // `{ extrasOnly: true }`: the index is current, only the stations and neutron stars are missing.
    const extrasOnly = (req.body as { extrasOnly?: unknown } | undefined)?.extrasOnly === true;
    if (!combinedRunning) {
      combinedRunning = true;
      void (async () => {
        try {
          if (!extrasOnly)
            await downloadGalaxyIndex(() => {
              clearBioIndexCache();
              clearSystemTraits();
              clearGalaxyPoints();
              clearTileIndex();
              clearGalaxyCatalogueCache();
              clearGalaxySystemValues();
            });
          // Each only when not here or newer on the release (review 1.2.16: both came down again every time).
          const ex = extrasStatus();
          if (ex.stations.due) await downloadStations(() => opts.scheduleBroadcast?.());
          if (ex.neutrons.due) await downloadNeutrons(() => opts.scheduleBroadcast?.());
          if (ex.jumponium.due) await downloadJumponium(() => opts.scheduleBroadcast?.());
        } finally {
          combinedRunning = false;
        }
      })();
    }
    res.json({ ok: true });
  });
}
