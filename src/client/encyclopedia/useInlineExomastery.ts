/**
 * The inline exomastery drawer under a species card: which species it is open for, its data, and its
 * close transition. Moved out of EncyclopediaModal.tsx unchanged (audit 2026-10-22); the modal calls it
 * where this state used to be, so its hooks run in the same order.
 */
import type { EncyclopediaExomasteryPlanetsResponseDTO, EncyclopediaSpeciesRowDTO, SpeciesEntry } from "@shared/types";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EncyclopediaSpawnCompare } from "./types";

const EXO_DRAWER_TRANSITION_MS = 380;

function encyclopediaExomasteryFetchPath(
  genusDir: string,
  speciesEntryId: string,
  opts?: { force?: boolean; focusBodyKey?: string | null },
): string {
  const p = new URLSearchParams();
  if (opts?.force) p.set("force", "1");
  if (opts?.focusBodyKey?.trim()) p.set("focusBodyKey", opts.focusBodyKey.trim());
  const qs = p.toString();
  return `/api/encyclopedia-exomastery/${encodeURIComponent(genusDir)}/${encodeURIComponent(speciesEntryId)}${qs ? `?${qs}` : ""}`;
}

export function useInlineExomastery(
  rows: EncyclopediaSpeciesRowDTO[] | null,
  spawnCompare: EncyclopediaSpawnCompare | null,
) {
  /** Inline exomastery planetary cards inside the encyclopedia list (not a nested modal). */
  const [inlineExo, setInlineExo] = useState<{
    speciesEntryId: string;
    loading: boolean;
    err: string | null;
    data: EncyclopediaExomasteryPlanetsResponseDTO | null;
  } | null>(null);
  const [exoClosing, setExoClosing] = useState(false);
  const [exoDrawerReveal, setExoDrawerReveal] = useState(false);
  const exoCloseTimerRef = useRef<number | null>(null);

  const scheduleCloseExo = useCallback(() => {
    setExoClosing(true);
    if (exoCloseTimerRef.current != null) window.clearTimeout(exoCloseTimerRef.current);
    exoCloseTimerRef.current = window.setTimeout(() => {
      setInlineExo(null);
      setExoClosing(false);
      exoCloseTimerRef.current = null;
    }, EXO_DRAWER_TRANSITION_MS);
  }, []);

  const toggleInlineExomastery = useCallback(
    (entry: SpeciesEntry) => {
      if (exoCloseTimerRef.current != null) {
        window.clearTimeout(exoCloseTimerRef.current);
        exoCloseTimerRef.current = null;
      }
      if (inlineExo?.speciesEntryId === entry.id && !exoClosing) {
        scheduleCloseExo();
        return;
      }
      setExoClosing(false);
      setInlineExo({ speciesEntryId: entry.id, loading: true, err: null, data: null });
      const url = encyclopediaExomasteryFetchPath(entry.genusDataDir, entry.id, {
        focusBodyKey: spawnCompare?.bodyKey,
      });
      void fetch(url)
        .then(async (r) => {
          const j = (await r.json().catch(() => null)) as
            EncyclopediaExomasteryPlanetsResponseDTO | { error?: string } | null;
          const entryId = entry.id;
          setInlineExo((prev) => {
            if (!prev || prev.speciesEntryId !== entryId) return prev;
            if (!r.ok) {
              const msg =
                j && typeof j === "object" && "error" in j && typeof j.error === "string"
                  ? j.error
                  : r.statusText;
              return { ...prev, loading: false, err: msg, data: null };
            }
            if (j && typeof j === "object" && "planets" in j && Array.isArray(j.planets)) {
              return {
                ...prev,
                loading: false,
                err: null,
                data: j as EncyclopediaExomasteryPlanetsResponseDTO,
              };
            }
            return { ...prev, loading: false, err: "Invalid response", data: null };
          });
        })
        .catch((e) => {
          const entryId = entry.id;
          setInlineExo((prev) =>
            prev && prev.speciesEntryId === entryId
              ? {
                  ...prev,
                  loading: false,
                  err: e instanceof Error ? e.message : String(e),
                  data: null,
                }
              : prev,
          );
        });
    },
    [inlineExo?.speciesEntryId, exoClosing, scheduleCloseExo, spawnCompare?.bodyKey],
  );

  const refetchInlineExomastery = useCallback(() => {
    if (!inlineExo || exoClosing || !rows?.length) return;
    const entryId = inlineExo.speciesEntryId;
    const hit = rows.find((r) => r.entry.id === entryId);
    if (!hit) return;
    setInlineExo((p) => (p && p.speciesEntryId === entryId ? { ...p, loading: true, err: null } : p));
    const url = encyclopediaExomasteryFetchPath(hit.entry.genusDataDir, hit.entry.id, {
      force: true,
      focusBodyKey: spawnCompare?.bodyKey,
    });
    void fetch(url)
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as
          EncyclopediaExomasteryPlanetsResponseDTO | { error?: string } | null;
        setInlineExo((prev) => {
          if (!prev || prev.speciesEntryId !== entryId) return prev;
          if (!r.ok) {
            const msg =
              j && typeof j === "object" && "error" in j && typeof j.error === "string"
                ? j.error
                : r.statusText;
            return { ...prev, loading: false, err: msg, data: null };
          }
          if (j && typeof j === "object" && "planets" in j && Array.isArray(j.planets)) {
            return {
              ...prev,
              loading: false,
              err: null,
              data: j as EncyclopediaExomasteryPlanetsResponseDTO,
            };
          }
          return { ...prev, loading: false, err: "Invalid response", data: null };
        });
      })
      .catch((e) => {
        setInlineExo((prev) =>
          prev && prev.speciesEntryId === entryId
            ? {
                ...prev,
                loading: false,
                err: e instanceof Error ? e.message : String(e),
                data: null,
              }
            : prev,
        );
      });
  }, [inlineExo, exoClosing, rows, spawnCompare?.bodyKey]);

  useLayoutEffect(() => {
    let cancelled = false;
    let innerRaf = 0;
    if (!inlineExo || exoClosing) {
      setExoDrawerReveal(false);
      return () => {
        cancelled = true;
      };
    }
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (!cancelled) setExoDrawerReveal(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outerRaf);
      if (innerRaf) cancelAnimationFrame(innerRaf);
    };
  }, [inlineExo, exoClosing]);

  useEffect(() => {
    if (!inlineExo || exoClosing || !exoDrawerReveal) return;
    const sid = inlineExo.speciesEntryId;
    const outer = window.setTimeout(() => {
      document.querySelector(`[data-exo-drawer="${CSS.escape(sid)}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }, 60);
    return () => window.clearTimeout(outer);
    // Deliberately the fields, not the object: re-scroll when the drawer's content changes, not on
    // every re-render that rebuilds `inlineExo` with the same content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inlineExo?.speciesEntryId,
    inlineExo?.loading,
    inlineExo?.data,
    inlineExo?.err,
    exoClosing,
    exoDrawerReveal,
  ]);

  useEffect(() => {
    return () => {
      if (exoCloseTimerRef.current != null) window.clearTimeout(exoCloseTimerRef.current);
    };
  }, []);

  return {
    inlineExo,
    exoClosing,
    exoDrawerReveal,
    scheduleCloseExo,
    toggleInlineExomastery,
    refetchInlineExomastery,
  };
}
