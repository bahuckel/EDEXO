/**
 * The HUD prefs a client sends, cut down to the known keys with sane bounds; anything else is dropped. A pure
 * function (audit 2026-10-22: it was the body of GameStateStore.setHudPrefs), so it can be tested on its own.
 */
import type { HudPrefsDTO } from "../shared/types.js";
import { isHudSectionKey } from "../shared/hudSections.js";

export function sanitizeHudPrefs(raw: unknown): HudPrefsDTO | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: HudPrefsDTO = {};
  if (r.theme && typeof r.theme === "object") {
    const t = r.theme as Record<string, unknown>;
    const theme: NonNullable<HudPrefsDTO["theme"]> = {};
    if (typeof t.preset === "string" && t.preset.length <= 24) theme.preset = t.preset;
    if (typeof t.accent === "string" && /^#[0-9a-f]{6}$/i.test(t.accent)) theme.accent = t.accent;
    if (typeof t.text === "string" && /^#[0-9a-f]{6}$/i.test(t.text)) theme.text = t.text;
    out.theme = theme;
  }
  if (typeof r.scale === "number" && Number.isFinite(r.scale))
    out.scale = Math.min(2, Math.max(0.5, r.scale));
  if (typeof r.opacity === "number" && Number.isFinite(r.opacity))
    out.opacity = Math.min(1, Math.max(0.1, r.opacity));
  if (r.candOrder === "likelihood" || r.candOrder === "value") out.candOrder = r.candOrder;
  if (typeof r.region === "boolean") out.region = r.region;
  if (typeof r.audio === "boolean") out.audio = r.audio;
  if (typeof r.compact === "boolean") out.compact = r.compact;
  if (typeof r.relevant === "boolean") out.relevant = r.relevant;
  if (r.hudType === "original" || r.hudType === "title" || r.hudType === "elite") out.hudType = r.hudType;
  if (r.credit === "off" || r.credit === "top" || r.credit === "bottom") out.credit = r.credit;
  if (typeof r.nextBoxel === "boolean") out.nextBoxel = r.nextBoxel;
  if (typeof r.czNeeds === "boolean") out.czNeeds = r.czNeeds;
  if (typeof r.czSites === "boolean") out.czSites = r.czSites;
  if (typeof r.czFinished === "boolean") out.czFinished = r.czFinished;
  if (typeof r.tilt === "number" && Number.isFinite(r.tilt)) out.tilt = Math.min(35, Math.max(-35, r.tilt));
  if (r.tiltMode === "turn" || r.tiltMode === "slant") out.tiltMode = r.tiltMode;
  if (typeof r.slant === "number" && Number.isFinite(r.slant))
    out.slant = Math.min(15, Math.max(-15, r.slant));
  if (Array.isArray(r.sections)) {
    out.sections = [];
    for (const n of r.sections) {
      if (isHudSectionKey(n) && !out.sections.includes(n)) out.sections.push(n);
    }
  }
  return out;
}
