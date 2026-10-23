/**
 * A site's own plan rules and "systems per material" (discuss item 1, owner 2026-10-23; shared/colonize/
 * projectSettings.ts). Each control starts at "as the plan" and only what is set here is stored; one plan serves
 * every site, so a rule set here tightens the plan for all of them (the Haul plan names the site that did).
 */
import { useState } from "react";
import { Select } from "../../ui/Select";
import type { ProjectSettings, SiteRules } from "../../../shared/colonize/projectSettings";
import type { MinLandingPad } from "../../../shared/colonize/stationFilter";
import { BTN } from "./ui";

type Pick3 = "plan" | "on" | "off";
const PADS: { value: MinLandingPad | "plan"; label: string }[] = [
  { value: "plan", label: "As the plan" },
  { value: "any", label: "Any" },
  { value: "M", label: "M or L" },
  { value: "L", label: "L only" },
];
const ONOFF: { value: Pick3; label: string }[] = [
  { value: "plan", label: "As the plan" },
  { value: "on", label: "Yes" },
  { value: "off", label: "No" },
];
const pick3 = (v: boolean | undefined): Pick3 => (v === undefined ? "plan" : v ? "on" : "off");
const from3 = (v: Pick3): boolean | undefined => (v === "plan" ? undefined : v === "on");

export function SiteRulesForm({
  label,
  settings,
  onChange,
}: {
  label: string;
  settings: ProjectSettings | undefined;
  onChange: (next: ProjectSettings | null) => void;
}) {
  const rules = settings?.rules ?? {};
  // Typed fields save on leaving them, like the hub.
  const [ly, setLy] = useState(rules.maxDistanceLy ?? "");
  const [cap, setCap] = useState(settings?.maxSystemsPerMaterial ?? "");
  const save = (patch: Partial<SiteRules>, nextCap = settings?.maxSystemsPerMaterial) => {
    const merged: SiteRules = { ...rules, ...patch };
    for (const k of Object.keys(merged) as (keyof SiteRules)[]) if (merged[k] === undefined || merged[k] === "") delete merged[k];
    onChange({ rules: merged, maxSystemsPerMaterial: nextCap });
  };
  const any = Object.keys(rules).length > 0 || !!settings?.maxSystemsPerMaterial;
  return (
    <div className="cz-site-rules" role="group" aria-label={`${label}: its own plan rules`}>
      <span className="cz-label">This site's rules</span>
      <span className="cz-field">
        <span className="cz-dim">Pad</span>
        <Select<MinLandingPad | "plan">
          ariaLabel={`${label}: landing pad`}
          value={rules.minLandingPad ?? "plan"}
          options={PADS}
          onChange={(v) => save({ minLandingPad: v === "plan" ? undefined : v })}
        />
      </span>
      <label className="cz-field">
        <span className="cz-dim">Within</span>
        <input
          className="cz-input"
          inputMode="numeric"
          size={4}
          value={ly}
          placeholder="plan"
          aria-label={`${label}: sellers within (ly)`}
          onChange={(e) => setLy(e.target.value.replace(/[^\d.]/g, ""))}
          onBlur={() => save({ maxDistanceLy: ly || undefined })}
        />
        <span className="cz-dim">ly</span>
      </label>
      <span className="cz-field">
        <span className="cz-dim">Planet ports</span>
        <Select<Pick3>
          ariaLabel={`${label}: planet ports`}
          value={pick3(rules.showPlanetary)}
          options={ONOFF}
          onChange={(v) => save({ showPlanetary: from3(v) })}
        />
      </span>
      <span className="cz-field">
        <span className="cz-dim">Carriers that sell</span>
        <Select<Pick3>
          ariaLabel={`${label}: other commanders' carriers`}
          value={rules.excludeFleetCarriers === undefined ? "plan" : rules.excludeFleetCarriers ? "off" : "on"}
          options={ONOFF}
          onChange={(v) => save({ excludeFleetCarriers: v === "plan" ? undefined : v === "off" })}
        />
      </span>
      <label className="cz-field">
        <span className="cz-dim">Systems per material</span>
        <input
          className="cz-input"
          inputMode="numeric"
          size={3}
          value={cap}
          placeholder="plan"
          aria-label={`${label}: seller systems to find per material`}
          onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={() => save({}, cap || undefined)}
        />
      </label>
      {any ? (
        <button
          type="button"
          className={BTN}
          onClick={() => {
            setLy("");
            setCap("");
            onChange(null);
          }}
        >
          As the plan
        </button>
      ) : null}
    </div>
  );
}
