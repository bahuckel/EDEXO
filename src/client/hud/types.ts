/*
  What the HUD reads off a snapshot: the HUD channel's slice of AppSnapshot (server/wsChannels.ts), every field
  optional because a page can be fed a partial one (the phone before its first frame, previews, tests).
*/
import type { AppSnapshot, BodyComputed } from "@shared/types";

/** A body as the HUD channel sends it (slimBodyForHud): priced footfall and the unfilled signals ride along. */
export type HudBody = BodyComputed & {
  footfall?: "unwalked" | "walked" | "unknown";
  unknownPlants?: { genus?: string | null; maybeBacterium?: boolean }[];
};

export type HudSnapshot = Omit<Partial<AppSnapshot>, "bodies" | "exoOverlayFocusBody"> & {
  bodies?: HudBody[];
  exoOverlayFocusBody?: HudBody | null;
  /** An older server's name for shipRegion. */
  currentRegion?: { name: string } | null;
  port?: number;
};

/** The radar's frame (ExoLiveDTO): the two fields it draws, at the Status.json poll rate. */
export interface HudExoLive {
  exoOrganicOverlay?: HudSnapshot["exoOrganicOverlay"];
  exoMinimap?: HudSnapshot["exoMinimap"];
}
