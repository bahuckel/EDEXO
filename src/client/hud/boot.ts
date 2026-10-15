/*
  Mounts the HUD sections a page names (Phase 6: a module, not an inline script, which a Content-Security-Policy
  without 'unsafe-inline' does not run). A single-section page says which on <body data-sections="distance">; the
  merged HUD names none and reads its query string.
*/
import { HUD } from "./main";

const mount = HUD.mount as (names: string[]) => HTMLElement;
const fromUrl = HUD.sectionsFromUrl as () => string[];
const named = document.body.dataset.sections;
mount(named ? named.split(",") : fromUrl());
