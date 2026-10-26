/**
 * The HUD's colour presets: the cockpit colours people actually use, each an accent and a pale text tint of it
 * (theme.ts derives the rest). Apart from theme.ts so the launcher's swatches use the same list (1.3.1).
 */
export const PRESETS: Record<string, { accent: string; text: string }> = {
  orange: { accent: "#ff8a1f", text: "#ffe6cf" },
  amber: { accent: "#ffb020", text: "#fff0cc" },
  red: { accent: "#ff4a3a", text: "#ffd9d4" },
  magenta: { accent: "#ff4fd8", text: "#ffd6f5" },
  purple: { accent: "#b46bff", text: "#e9d9ff" },
  blue: { accent: "#4fa8ff", text: "#d6e9ff" },
  cyan: { accent: "#3fe0e0", text: "#d2fbfb" },
  green: { accent: "#5fe07a", text: "#d9f8de" },
  lime: { accent: "#c8f04a", text: "#f1fbd2" },
  white: { accent: "#e8e8f0", text: "#ffffff" },
};
