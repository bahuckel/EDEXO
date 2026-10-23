/**
 * Options: Notify me (moved out of OptionsPanels.tsx, audit 2026-10-22).
 */
import { FoldPanel } from "../ui/Fold";
import {
  CARRIER_NOTICE_MIN_FROM_SOL_LY,
  DEFAULT_NOTIFY_PREFS,
  JUMPONIUM_TARGET_MAX,
  NEARBY_JUMPS_MAX,
  NEARBY_JUMPS_MIN,
  NOTABLE_KINDS,
  type CarrierNoticeMode,
  type JumponiumNotifyPrefsDTO,
  type NearbyPrefsDTO,
  type NotifyPrefsDTO,
  type NotifySettingsDTO,
} from "@shared/notices";
import { POI_GROUP_OPTIONS } from "@shared/gecCategories";
import { BODY_FEATURE_GROUPS, BODY_FEATURES } from "@shared/bodyFeatures";
import { CARRIER_SERVICE_OPTIONS } from "@shared/carrierServices";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AFM_REFILLS, INJECTIONS } from "@shared/jumponium";
import { fmtPct } from "@shared/format";
import { DraftNumber } from "./DraftNumber";
import { postSetting } from "./postSetting";

/*
  One fold per kind of notice (owner, 2026-10-13: "a bit text heavy … make everything collapsable per title"): each says
  what is on while folded and keeps its own explanation behind its [?].
*/
function NotifySection({ k, title, summary, help, children }: { k: string; title: string; summary: string; help: ReactNode; children: ReactNode }) {
  return (
    <FoldPanel foldKey={`options-notify-${k}`} defaultOpen={false} className="options-notify-section" title={title} summary={summary} help={help}>
      {children}
    </FoldPanel>
  );
}

/**
 * "Notify me" (guild tester report, 2026-09-30). What lands in the mail icon's list: notable bodies,
 * personal records and notable stellar phenomena. Stored on the server, so the phone and this window
 * follow the same switches. No system notifications and no sound, apart from the opt-in record chime.
 */
export function NotifyPanel() {
  const [st, setSt] = useState<NotifySettingsDTO | null>(null);
  const p = st?.prefs ?? null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/settings/notify")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.prefs) setSt(j as NotifySettingsDTO);
      })
      .catch(() => {
        /* the panel stays empty */
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback((patch: Partial<Omit<NotifyPrefsDTO, "notable" | "nearby" | "features">> & {
    notable?: Partial<NotifyPrefsDTO["notable"]>;
    features?: Partial<NotifyPrefsDTO["features"]>;
    nearby?: Partial<Omit<NearbyPrefsDTO, "poiGroups">> & { poiGroups?: Partial<NearbyPrefsDTO["poiGroups"]> };
  }) => {
    setBusy(true);
    setMsg(null);
    void postSetting("/api/settings/notify", patch)
      .then((r) => {
        if (!r.ok) {
          setMsg(r.error ?? "Could not change the setting.");
          return;
        }
        const next = r as unknown as NotifySettingsDTO;
        if (next.prefs) setSt(next);
      })
      .finally(() => setBusy(false));
  }, []);

  if (!st || !p) return null;
  const nb = p.nearby;
  const jp = p.jumponium?.tiers ? p.jumponium : DEFAULT_NOTIFY_PREFS.jumponium;
  const poiOn = POI_GROUP_OPTIONS.filter((g) => nb.poiGroups[g.key]).length;
  const notableOn = NOTABLE_KINDS.filter((k) => p.notable[k.key]).length;
  const featuresOn = BODY_FEATURES.filter((f) => p.features?.[f.key]).length;
  const exoOn =
    (p.codexFirst ?? true ? 1 : 0) + (p.codexFirstLowChance ?? true ? 1 : 0) + (p.rareColours ?? true ? 1 : 0);
  const tiersOn = INJECTIONS.filter((i) => jp.tiers[i.tier]);
  const jpAfm = jp.afm ?? { basic: false, standard: false, premium: false };
  const afmOn = AFM_REFILLS.filter((i) => jpAfm[i.tier]);
  const onCount =
    notableOn +
    (p.records ? 1 : 0) +
    (p.nsp ? 1 : 0) +
    (p.codexFirst ?? true ? 1 : 0) +
    (p.rareColours ?? true ? 1 : 0) +
    poiOn +
    (nb.carriers !== "off" ? 1 : 0) +
    featuresOn +
    (jp.on ? 1 : 0) +
    (p.communityGoals ?? true ? 1 : 0);
  const radiusLy = st.jumpLy != null ? Math.round(nb.jumps * st.jumpLy) : null;
  const saveJump = (patch: Partial<JumponiumNotifyPrefsDTO>) => save({ jumponium: { ...jp, ...patch } });

  return (
    <FoldPanel
      foldKey="options-notify"
      defaultOpen={false}
      className="options-meta-block"
      title="Notify me"
      summary={`${onCount} on${p.chime ? " · chime" : ""}`}
      help={
        <p>
          Finds go to the <strong>mail icon</strong> in the top bar (and the HUD&apos;s Notices panel) and stay there
          until you mark them read. Each one names the system and the body. Never a Windows notification; the record
          chime is the only sound. Open a section for what it announces.
        </p>
      }
    >
      <NotifySection
        k="bodies"
        title="Notable bodies"
        summary={`${notableOn} of ${NOTABLE_KINDS.length} on`}
        help={
          <p>
            A new scan of one of these comes to the mail icon. <strong>Green gas giants</strong>: a codex entry confirms
            one, a body on the edGGG catalogue is a known one, and a surface temperature that a known one has makes it
            likely; a K10-Type Anomaly in the system makes every gas giant there possible. Open a gas giant&apos;s
            details to mark it green, or not green, yourself.
          </p>
        }
      >
        <div className="options-notify-grid">
          {NOTABLE_KINDS.map((k) => (
            <label key={k.key} className="options-toggle">
              <input
                type="checkbox"
                checked={p.notable[k.key]}
                disabled={busy}
                onChange={(ev) => save({ notable: { [k.key]: ev.target.checked } })}
              />
              <span>{k.label}</span>
            </label>
          ))}
        </div>
      </NotifySection>

      <NotifySection
        k="features"
        title="Body features"
        summary={featuresOn ? `${featuresOn} on` : "all off"}
        help={
          <p>
            Small bodies, fast orbits, landables with a view, rings and more, each with the figures that make it one.
            Each one you tick shows on the Notable card with the reason, and a new scan of one comes to the mail icon.
            All off until you tick them.
          </p>
        }
      >
        {BODY_FEATURE_GROUPS.map((g) => (
          <div key={g.key}>
            <p className="dim tiny options-notify-sub">{g.label}</p>
            <div className="options-notify-grid">
              {BODY_FEATURES.filter((f) => f.group === g.key).map((f) => (
                <label key={f.key} className="options-toggle" title={f.hint}>
                  <input
                    type="checkbox"
                    checked={p.features?.[f.key] ?? false}
                    disabled={busy}
                    onChange={(ev) => save({ features: { [f.key]: ev.target.checked } })}
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </NotifySection>

      <NotifySection
        k="exobio"
        title="Exobiology"
        summary={`${exoOn} of 3 on`}
        help={
          <>
            <p>
              <strong>Codex first</strong>: a candidate plant on a body in your system that nobody has logged in this
              region yet (EDSM&apos;s codex), the gold [CODEX FIRST]. Kept in the list at 1 % or less, it is tinted red
              with a [?] saying why it is there; off, it goes to the unlikely list like any low row.
            </p>
            <p>
              <strong>Rare colours</strong>: a candidate plant on a body in your system whose colour has been logged in
              10 systems or fewer in the whole galaxy (EDAstro&apos;s codex), the [RARE] mark on its row.
            </p>
          </>
        }
      >
        <div className="options-notify-grid">
          <label className="options-toggle">
            <input
              type="checkbox"
              checked={p.codexFirst ?? true}
              disabled={busy}
              onChange={(ev) => save({ codexFirst: ev.target.checked })}
            />
            <span>Codex first: a plant nobody has logged in the region</span>
          </label>
          <label className="options-toggle">
            <input
              type="checkbox"
              checked={p.codexFirstLowChance ?? true}
              disabled={busy}
              onChange={(ev) => save({ codexFirstLowChance: ev.target.checked })}
            />
            <span>Codex first: keep it in the list at 1 % or less</span>
          </label>
          <label className="options-toggle">
            <input
              type="checkbox"
              checked={p.rareColours ?? true}
              disabled={busy}
              onChange={(ev) => save({ rareColours: ev.target.checked })}
            />
            <span>Rare colours: logged in 10 systems or fewer galaxy-wide</span>
          </label>
        </div>
      </NotifySection>

      <NotifySection
        k="jumponium"
        title="Laboratory"
        summary={
          jp.on
            ? `on · ${[...tiersOn.map((i) => `FSD ${i.name}`), ...afmOn.map((i) => `AFM ${i.name}`)].join(", ") || "nothing ticked"}`
            : "off"
        }
        help={
          <p>
            A scanned landable body in the top tenth of landable bodies for a material of what you tick. FSD
            injections: Basic (carbon, vanadium, germanium), Standard (+ cadmium, niobium), Premium (carbon,
            germanium, arsenic, niobium, yttrium, polonium). AFM refills: Basic (nickel, zinc, chromium, vanadium),
            Standard (tin, manganese, vanadium, molybdenum, zirconium), Premium (zinc, chromium, vanadium, zirconium,
            tellurium, ruthenium). Carbon, nickel, chromium and manganese are on most bodies and never announced.
            With &quot;only what I am short of&quot;, only materials you hold fewer of than the number set. The
            galaxy map&apos;s Laboratory tab shows what you hold.
          </p>
        }
      >
        <div className="options-notify-grid">
          <label className="options-toggle">
            <input type="checkbox" checked={jp.on} disabled={busy} onChange={(ev) => saveJump({ on: ev.target.checked })} />
            <span>Announce rich bodies</span>
          </label>
        </div>
        <p className="dim tiny options-notify-sub">FSD injections (jumponium)</p>
        <div className="options-notify-grid">
          {INJECTIONS.map((i) => (
            <label key={i.tier} className="options-toggle">
              <input
                type="checkbox"
                checked={jp.tiers[i.tier]}
                disabled={busy || !jp.on}
                onChange={(ev) => saveJump({ tiers: { ...jp.tiers, [i.tier]: ev.target.checked } })}
              />
              <span>
                {i.name} <span className="dim">{i.bonus}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="dim tiny options-notify-sub">AFM refills</p>
        <div className="options-notify-grid">
          {AFM_REFILLS.map((i) => (
            <label key={i.tier} className="options-toggle">
              <input
                type="checkbox"
                checked={jpAfm[i.tier]}
                disabled={busy || !jp.on}
                onChange={(ev) => saveJump({ afm: { ...jpAfm, [i.tier]: ev.target.checked } })}
              />
              <span>
                {i.name} {i.bonus ? <span className="dim">{i.bonus}</span> : null}
              </span>
            </label>
          ))}
        </div>
        <div className="options-notify-grid">
          <label className="options-toggle">
            <input
              type="checkbox"
              checked={jp.onlyShort}
              disabled={busy || !jp.on}
              onChange={(ev) => saveJump({ onlyShort: ev.target.checked })}
            />
            <span>
              Only what I am short of: under{" "}
              <DraftNumber
                className="options-inline-num"
                min={1}
                max={JUMPONIUM_TARGET_MAX}
                value={jp.target}
                disabled={!jp.on || !jp.onlyShort}
                onCommit={(target) => saveJump({ target })}
                ariaLabel="Short of: under this many aboard"
              />{" "}
              aboard
            </span>
          </label>
        </div>
      </NotifySection>

      <NotifySection
        k="records"
        title="Personal records"
        summary={p.records ? `on${p.chime ? " · chime" : ""}` : "off"}
        help={
          <p>
            The largest and the smallest radius of every star type and planet class you have scanned. Your journals
            set the starting records quietly; only a record you break from now on is announced. A star that broke one
            glows gold on the system card, and a planet gets a medal.
          </p>
        }
      >
        <div className="options-notify-grid">
          <label className="options-toggle">
            <input type="checkbox" checked={p.records} disabled={busy} onChange={(ev) => save({ records: ev.target.checked })} />
            <span>Personal records (largest / smallest)</span>
          </label>
          <label className="options-toggle">
            <input
              type="checkbox"
              checked={p.chime}
              disabled={busy || !p.records}
              onChange={(ev) => save({ chime: ev.target.checked })}
            />
            <span>Chime when a record falls (this PC only)</span>
          </label>
        </div>
      </NotifySection>

      <NotifySection
        k="cg"
        title="Community goals"
        summary={p.communityGoals ?? true ? "on" : "off"}
        help={
          <p>
            A notice when a new Community Goal starts: where to sign up, the objective, when it ends, how far along it
            is and its rewards. The app asks Frontier&apos;s public list once an hour while this is on; the request
            carries nothing about you.
          </p>
        }
      >
        <div className="options-notify-grid">
          <label className="options-toggle">
            <input
              type="checkbox"
              checked={p.communityGoals ?? true}
              disabled={busy}
              onChange={(ev) => save({ communityGoals: ev.target.checked })}
            />
            <span>New Community Goals</span>
          </label>
        </div>
      </NotifySection>

      <NotifySection
        k="nsp"
        title="Stellar phenomena"
        summary={[p.nsp ? "in the system" : "", nb.nsp ? "nearby" : ""].filter(Boolean).join(" · ") || "off"}
        help={
          <p>
            Notable stellar phenomena in the system you are in (an FSS signal, then its type from the codex), and,
            with EDAstro&apos;s codex file downloaded, the ones within your Nearby radius.
          </p>
        }
      >
        <div className="options-notify-grid">
          <label className="options-toggle">
            <input type="checkbox" checked={p.nsp} disabled={busy} onChange={(ev) => save({ nsp: ev.target.checked })} />
            <span>In the system I am in</span>
          </label>
        </div>
        <p className="dim tiny options-notify-sub">Nearby, from EDAstro&apos;s codex</p>
        <NspDownload on={nb.nsp} busy={busy} onToggle={(v) => save({ nearby: { nsp: v } })} />
      </NotifySection>

      <NotifySection
        k="nearby"
        title="Nearby"
        summary={`${nb.jumps} jumps · ${poiOn} POI group${poiOn === 1 ? "" : "s"} · carriers ${nb.carriers === "off" ? "off" : nb.carriers === "every" ? "all" : "by service"}`}
        help={
          <p>
            After each jump, points of interest and carriers within that many of your average jumps (your last
            twenty, or the ship&apos;s range until you have flown a few). Each point of interest is announced once.
            Carriers only count out in the black, over {CARRIER_NOTICE_MIN_FROM_SOL_LY.toLocaleString()} ly from Sol,
            and their position is only as fresh as EDAstro&apos;s last sighting — the notice says how old it is. Both
            use the lists you downloaded in the Points of interest and Carriers panels.
          </p>
        }
      >
        <div className="options-focus-grid">
          <label htmlFor="notify-jumps">Within</label>
          <span>
            <DraftNumber
              id="notify-jumps"
              min={NEARBY_JUMPS_MIN}
              max={NEARBY_JUMPS_MAX}
              value={nb.jumps}
              onCommit={(jumps) => save({ nearby: { jumps } })}
            />{" "}
            <span className="dim">
              jumps{radiusLy != null ? ` ≈ ${radiusLy.toLocaleString()} ly` : " (range known after your first jump)"}
            </span>
          </span>
        </div>
        <p className="dim tiny options-notify-sub">
          Points of interest{st.poiDataReady ? "" : " — download the list in Points of interest first"}
        </p>
        <div className="options-notify-grid">
          {POI_GROUP_OPTIONS.map((g) => (
            <label key={g.key} className="options-toggle" title={g.hint}>
              <input
                type="checkbox"
                checked={nb.poiGroups[g.key]}
                disabled={busy}
                onChange={(ev) => save({ nearby: { poiGroups: { [g.key]: ev.target.checked } } })}
              />
              <span>{g.label}</span>
            </label>
          ))}
        </div>
        <p className="dim tiny options-notify-sub">
          Carriers, beyond {CARRIER_NOTICE_MIN_FROM_SOL_LY.toLocaleString()} ly from Sol
          {st.carrierDataReady ? "" : " — download the list in Carriers first"}
        </p>
        <div className="options-focus-grid">
          <label htmlFor="notify-carriers">Announce</label>
          <select
            id="notify-carriers"
            className="options-inline-select"
            value={nb.carriers}
            disabled={busy}
            onChange={(ev) => save({ nearby: { carriers: ev.target.value as CarrierNoticeMode } })}
          >
            <option value="off">no carriers</option>
            <option value="every">every carrier</option>
            <option value="services">only carriers with a service below</option>
          </select>
        </div>
        {nb.carriers === "services" ? (
          <div className="options-notify-grid">
            {CARRIER_SERVICE_OPTIONS.map((o) => (
              <label key={o.key} className="options-toggle" title={o.hint}>
                <input
                  type="checkbox"
                  checked={nb.carrierServices.includes(o.key)}
                  disabled={busy}
                  onChange={(ev) =>
                    save({
                      nearby: {
                        carrierServices: ev.target.checked
                          ? [...nb.carrierServices, o.key]
                          : nb.carrierServices.filter((k) => k !== o.key),
                      },
                    })
                  }
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        ) : null}
      </NotifySection>

      {/* Review F-5.10: see (and hear, with the chime on) what a find looks like, without waiting for one. */}
      <div className="options-oneline options-notify-test">
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => {
            setMsg(null);
            void postSetting("/api/notices/test", {}).then((r) => {
              setMsg(r.ok ? null : (r.error ?? "Could not send the test notice."));
              setTestSent(r.ok);
            });
          }}
        >
          Send a test notice
        </button>
        {testSent ? (
          <span className="dim tiny">Sent: look at the mail icon in the top bar{p.chime ? " (the chime plays)" : ""}.</span>
        ) : null}
      </div>
      {msg ? <p className="options-error">{msg}</p> : null}
    </FoldPanel>
  );
}

interface NspStatus {
  haveData: boolean;
  rowCount: number;
  systemCount: number;
  fetchedAtMs: number | null;
  running: boolean;
  bytesDone: number;
  bytesTotal: number | null;
  error: string | null;
  cooldownMsRemaining: number;
  sizeLabel: string;
  plantRegions?: boolean;
}

/*
  The NSP list is EDAstro's whole codex file, 855 MB, read as it arrives and kept as a few MB of
  phenomena (server/edastroNsp.ts). Opt-in and said up front (owner, 2026-09-30): the button names
  the size, and nothing downloads until it is pressed.
*/
function NspDownload({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: (v: boolean) => void }) {
  const [st, setSt] = useState<NspStatus | null>(null);
  const load = useCallback(() => {
    void fetch("/api/nsp/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.status) setSt(j.status as NspStatus);
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!st?.running) return;
    const t = window.setInterval(load, 1000);
    return () => window.clearInterval(t);
  }, [st?.running, load]);
  const start = (force: boolean) => {
    void fetch("/api/nsp/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.status) setSt(j.status as NspStatus);
      })
      .catch(() => {});
  };
  if (!st) return null;
  const mb = (b: number) => `${Math.round(b / 1_000_000).toLocaleString()} MB`;
  return (
    <div className="options-nsp">
      <label className="options-toggle">
        <input type="checkbox" checked={on} disabled={busy || !st.haveData} onChange={(ev) => onToggle(ev.target.checked)} />
        <span>
          Phenomena nearby
          {st.haveData
            ? ` — ${st.systemCount.toLocaleString()} systems known`
            : " — download the list first"}
        </span>
      </label>
      {st.running ? (
        <p className="dim tiny">
          Downloading and sorting: {mb(st.bytesDone)}
          {st.bytesTotal ? ` of ${mb(st.bytesTotal)} (${fmtPct(Math.floor((100 * st.bytesDone) / st.bytesTotal))})` : ""}. Only the
          phenomena, green gas giant reports and which plants were logged in which region are kept.
        </p>
      ) : (
        <p className="options-nsp__row">
          <button type="button" className="btn-top-toggle" onClick={() => start(st.haveData && st.cooldownMsRemaining > 0)}>
            {st.haveData ? "Refresh" : "Download"} NSP data ({st.sizeLabel})
          </button>
          <span className="dim tiny">
            {st.haveData && st.plantRegions === false
              ? "Refresh once to also check [CODEX FIRST] against EDAstro's plant finds (this one download is in full)."
              : st.haveData && st.fetchedAtMs
                ? `Last fetched ${new Date(st.fetchedAtMs).toLocaleDateString()}. A refresh only downloads again if EDAstro changed the file.`
                : `EDAstro's whole codex file, straight from EDAstro. Kept on this PC: the phenomena, green gas giant reports and which plants each region has, a few MB.`}
          </span>
        </p>
      )}
      {st.error ? <p className="options-error">{st.error}</p> : null}
    </div>
  );
}
