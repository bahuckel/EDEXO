/**
 * The HUD's own section names, in the HUD's order (src/client/hud/main.tsx `ORDER`). One list (audit 2026-10-22):
 * the client, the server's HUD prefs check (server/hudPrefsSanitize.ts) and the CLI each had a copy, and a section
 * missing from the server's was silently dropped from the saved prefs. public/launcher.js, plain JS outside the
 * build, still keeps its own `HUD_SECTION_ORDER`.
 */
export const HUD_SECTION_KEYS = [
  "jump",
  "fss",
  "candidates",
  "distance",
  "datavalue",
  "achievement",
  "notable",
  "colonize",
  "ship",
  "notices",
] as const;

export type HudSectionKey = (typeof HUD_SECTION_KEYS)[number];

export const isHudSectionKey = (v: unknown): v is HudSectionKey =>
  (HUD_SECTION_KEYS as readonly unknown[]).includes(v);
