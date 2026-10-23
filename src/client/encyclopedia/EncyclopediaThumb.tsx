/**
 * A species card's photograph and its region mark (moved out of EncyclopediaModal.tsx, audit 2026-10-22).
 */
import { useEffect, useRef } from "react";
import { BUILTIN_PLACEHOLDER_URL } from "@shared/photoPlaceholder";
import { rarityTierInfo, type RegionalRarity } from "@shared/speciesRarity";
import { speciesPhotoVariant } from "../speciesPhotoVariant";

/** Whether the species is recorded in the commander's region, and how rare it is there. */
export function RegionMark({ region, r }: { region: string; r: RegionalRarity | null }) {
  if (!r) return null;
  if (!r.found)
    return <span className="ency-region-mark ency-region-mark--none">Not recorded in {region}</span>;
  const t = r.tier ? rarityTierInfo(r.tier) : null;
  return (
    <span
      className="ency-region-mark"
      style={t ? { color: t.colour } : undefined}
      title={`Recorded in ${r.count.toLocaleString()} system${r.count === 1 ? "" : "s"} of ${region}`}
    >
      In {region}
      {t ? ` · ${t.label}` : ""}
    </span>
  );
}

// The placeholder URL is shared with the server, which writes it — see shared/photoPlaceholder.
const BUILTIN_PLACEHOLDER = BUILTIN_PLACEHOLDER_URL;

/**
 * Species thumbnail.
 *
 * Deliberately plain: every row requests its thumbnail immediately.
 *
 * The original 56 MB burst of full-size artwork is what made deferred loading necessary, and that
 * problem is gone — thumbnails are 320 px WebP at ~6 KB (the whole list is ~650 KB), and the photo
 * route is async with cached directory lookups. Both deferral mechanisms tried here failed in the
 * real window instead: `loading="lazy"` never evaluates inside this freshly-mounted scroll
 * container until the user physically scrolls, and an IntersectionObserver depends on the same
 * rendering lifecycle. At the Electron window's 548x768 that left 108 rows with one thumbnail in
 * the viewport and zero requests fired — every row looked broken.
 *
 * A failed load is retried once with a cache-busting query before falling back to the placeholder,
 * so a transient hiccup does not leave "no photo on disk" artwork behind.
 */
export function EncyclopediaThumb({
  photoUrl,
  displayName,
  className = "encyclopedia-species-img encyclopedia-species-img--thumb",
  size = "thumb",
}: {
  photoUrl: string;
  displayName: string;
  className?: string;
  /** "card" for the field-guide banner: 1024 px (~44 KB) — the 320 px thumbnail looked dull there. */
  size?: "thumb" | "card";
}) {
  const retriedRef = useRef(false);
  useEffect(() => {
    retriedRef.current = false;
  }, [photoUrl]);

  /** A WebP variant (320 px ~6 KB, 1024 px ~44 KB) rather than the original (~600 KB average). */
  const thumbUrl = speciesPhotoVariant(photoUrl, size);

  return (
    <img
      src={thumbUrl}
      alt=""
      width={104}
      height={88}
      decoding="async"
      className={className}
      onError={(ev) => {
        const el = ev.target as HTMLImageElement;
        if (!retriedRef.current && !photoUrl.includes(BUILTIN_PLACEHOLDER)) {
          retriedRef.current = true;
          el.src = `${thumbUrl}${thumbUrl.includes("?") ? "&" : "?"}retry=1`;
          return;
        }
        el.src = BUILTIN_PLACEHOLDER;
      }}
      title={`Click for full-size illustration of ${displayName}`}
    />
  );
}
