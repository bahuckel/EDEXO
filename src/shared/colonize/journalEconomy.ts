/**
 * Journal economy symbols → a readable phrase. Moved here from `supply/colonyProfiles.ts`, whose
 * colony-archetype weighting outlived the Supply advisor it served; this was the only part still used.
 */
const ECONOMY_SLUG_HINT: Record<string, string> = {
  /** Journal symbol stems */
  agri: "Agricultural",
  agricultural: "Agricultural",
  agriculture: "Agricultural",
  colony: "Colony",
  extraction: "Extraction",
  refinery: "Refinery",
  industrial: "Industrial",
  military: "Military",
  hightech: "HighTech",
  terraform: "Terraforming",
  terraforming: "Terraforming",
  tourism: "Tourism",
  service: "Service",
  prison: "Prison",
  repair: "Repair",
  rescue: "Service",
  fleetcarrier: "FleetCarrier",
  carrier: "FleetCarrier",
  /** Engineer docks — tech-adjacent */
  engineer: "HighTech",
  damaged: "",
};

/**
 * Turn journal blobs (`$economy_Refinery;`, `$economy_Agri_name;`) or localization tokens into a canonical phrase for matching.
 */
function normalizeStationEconomyJournalValue(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  let work = s;
  if (work.startsWith("$")) {
    work = work.slice(1).replace(/;$/u, "").trim();
    const m = /\beconomy_([A-Za-z0-9_]+)(?:_name)?\b/i.exec(work)
      ?? /^([A-Za-z0-9_]+)(?:_name)?$/i.exec(work);
    if (m) {
      const slug = m[1]!.replace(/_/g, "").toLowerCase();
      if (slug in ECONOMY_SLUG_HINT) return ECONOMY_SLUG_HINT[slug]!;
      /** Unknown `economy_Foo` — title-case heuristic "Foo Bar" */
      return m[1]!
        .split(/_+/u)
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(" ");
    }
    work = work.replace(/_name$/i, "").replace(/_/g, " ").trim();
    return work;
  }
  return s;
}

/**
 * Build one human-readable phrase for the docked station's economy from journal
 * `Economy_Localised`, `StationEconomy(_Localised)`, and `StationEconomies[]`.
 */
export function buildStationEconomyPhrase(j: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();

  const push = (s: string) => {
    const t = s.trim();
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    parts.push(t);
  };

  const stationEconPrimary =
    typeof j.Economy_Localised === "string"
      ? j.Economy_Localised.trim()
      : typeof j.StationEconomy_Localised === "string"
        ? j.StationEconomy_Localised.trim()
        : typeof j.SystemEconomy_Localised === "string"
          ? j.SystemEconomy_Localised.trim()
          : "";

  let rawPrimaryNorm = "";
  if (typeof j.StationEconomy === "string" && j.StationEconomy.trim())
    rawPrimaryNorm = normalizeStationEconomyJournalValue(j.StationEconomy.trim());
  else if (typeof j.Economy === "string" && j.Economy.trim())
    rawPrimaryNorm = normalizeStationEconomyJournalValue(j.Economy.trim());

  const symPrimary = stationEconPrimary || rawPrimaryNorm;

  if (symPrimary) push(symPrimary);

  const arr = j.StationEconomies;
  if (Array.isArray(arr)) {
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      let loc =
        typeof r.Name_Localised === "string"
          ? r.Name_Localised.trim()
          : typeof r.Name_Localized === "string"
            ? (r.Name_Localized as string).trim()
            : "";
      if (!loc && typeof r.Name === "string" && r.Name.trim()) loc = normalizeStationEconomyJournalValue(r.Name.trim());
      push(loc || "");
    }
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}
