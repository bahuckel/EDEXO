/**
 * Boxels (shared/boxel.ts; guild tester report, 2026-09-30; owner's redo, 2026-10-05: "I tried using
 * it and it isn't easy, reliable and functional" — plan in docs/plan-05102026-boxels.md).
 *
 * A full-window screen laid out like My discoveries: a side menu of every saved boxel (a search over
 * them, a tick per boxel = "in the table"), and one table of every system of every ticked boxel, -0 up
 * to its end — which you have flown, what the galaxy index has there, and the next one to fly.
 *
 * Current boxel saves the boxel you are in (to the last system number typed, else to the highest one
 * anyone knows) and ticks it. Skip and the cut (×) on a row correct a saved boxel, as before; the table
 * and the side menu re-read the journals after every jump, so the ticks follow you.
 */
import { tabListKeyDown } from "./ui/Tabs";
import { withTransition } from "./motion";
import { showPickedSystem } from "./tabs/tabStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoxelTableDTO, BoxelTableRowDTO, PreviousBoxelDTO, SavedBoxelDTO } from "@shared/boxel";
import type { BoxelLookupStatus } from "@shared/boxel";
import { boxelDone, parseBoxel } from "@shared/boxel";
import { useModal } from "./ui/useModal";
import { useToast } from "./ui/feedback";
import { isBool, isNum, oneOf, usePersistedState } from "./usePersistedState";
import { Table, type Column } from "./ui/DataTable";
import { fuzzyRankAny } from "./fuzzyMatch";
import { Select } from "./ui/Select";
import { BoxelLookingFor, BoxelMassCodeHelp, GoldenTag } from "./BoxelAdvice";
import { LoadingNote, RefreshBar } from "./ui/Loading";
import { useMediaQuery } from "./ui/Menu";
import {
  BOXEL_FILTER_KINDS,
  boxelFilterSuggestions,
  boxelRowFilter,
  NOTABLE_SHORT,
  type BoxelFilterKind,
} from "./boxelFilter";
import {
  isIncluded,
  json,
  NOTABLE_LABEL,
  PREV_PAGE,
  PREV_RANGES,
  STAR_LABEL,
  type SideTab,
} from "./boxel/boxelLabels";
import { boxelColumns } from "./boxel/boxelColumns";
import { BoxelOrderLine } from "./boxel/BoxelOrderLine";
import { BoxelSideActions } from "./boxel/BoxelSideActions";
import { BoxelFlyingStrip } from "./boxel/BoxelFlyingStrip";
import { RollingNumber } from "./ui/RollingNumber";
import { usePresence } from "./ui/usePresence";

/*
  The labels and helpers and the table's columns live in boxel/ since the audit of 2026-10-22; the
  window-width check is ui/Menu's useMediaQuery (this file had its own copy).
*/

export function BoxelScreen({
  onClose,
  currentSystem,
  dScan = null,
  revision = 0,
  copied: lastCopied = null,
}: {
  onClose: () => void;
  currentSystem: string | null;
  /** The main screen's D-Scan line: the system on screen shows exactly these figures. */
  dScan?: { systemName: string; found: number; total: number } | null;
  /** Snapshot `boxelsRevision`: a route, a target, a run or a copy changed what the lists show. */
  revision?: number;
  /** What a jump or a boxel key last put on the clipboard. */
  copied?: { name: string; at: string; run: boolean } | null;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const toast = useToast();
  const here = currentSystem ? parseBoxel(currentSystem) : null;

  const [saved, setSaved] = useState<SavedBoxelDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** "Copy after each jump" (server/savedBoxels.ts); null until the list has been read. */
  const [autoCopy, setAutoCopy] = useState<boolean | null>(null);
  /** The probe text just copied, for the chip's "copied" look. */
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  const copyText = (text: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(text),
      () => setCopied(null),
    );
  /** The ticked boxels; null until he ticks anything (then: the current boxel, else the newest). */
  const [included, setIncluded] = usePersistedState<string[] | null>("boxel.included", null, isIncluded);
  const [sideQuery, setSideQuery] = useState("");
  // "Add a boxel: paste any system of it" (review P1): the one field of the top row.
  const [addInput, setAddInput] = useState("");
  /*
    The side menu's three lists (owner, 2026-10-05: "Sidebar can get quite large … a button switch
    between saved, fully explored and history on the top").
  */
  const [sideTab, setSideTab] = usePersistedState<SideTab>(
    "boxel.sideTab",
    "saved",
    oneOf("saved", "explored", "history"),
  );
  const showPrevious = sideTab === "history";
  // The side menu folds away to the left (owner, 2026-10-05: "< and > arrows … animated drawer").
  const [sideOpen, setSideOpen] = usePersistedState("boxel.sideOpen", true, isBool);
  // The [?] beside the close button: the mass code tables (owner, 2026-10-05).
  const [helpOpen, setHelpOpen] = usePersistedState("boxel.helpOpen", false, isBool);
  const massHelp = usePresence(helpOpen);
  const [prevDays, setPrevDays] = usePersistedState("boxel.previousDays", 30, isNum);
  const [previous, setPrevious] = useState<PreviousBoxelDTO[] | null>(null);
  /** History's total for the range and search, and whether a page is on its way. */
  const [prevTotal, setPrevTotal] = useState<number | null>(null);
  const [prevLoading, setPrevLoading] = useState(false);
  const prevGen = useRef(0);
  const prevMore = useRef<HTMLDivElement | null>(null);
  const [lookup, setLookup] = useState<BoxelLookupStatus | null>(null);
  const [cutAsk, setCutAsk] = useState<{ id: string; n: number } | null>(null);
  const [table, setTable] = useState<BoxelTableDTO | null>(null);
  // The boxels the table on screen belongs to: other boxels ticked, it is old until theirs lands.
  const [tableFor, setTableFor] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "n", dir: 1 });
  const [filterKind, setFilterKind] = usePersistedState<BoxelFilterKind>(
    "boxel.filterKind",
    "body",
    oneOf("system", "body", "star", "species"),
  );
  const [filterQuery, setFilterQuery] = useState("");
  const [notFlownOnly, setNotFlownOnly] = usePersistedState("boxel.notFlownOnly", false, isBool);

  const call = useCallback(async (init?: RequestInit, path = "/api/boxels") => {
    try {
      const r = await fetch(path, init);
      const j = (await r.json()) as {
        items?: SavedBoxelDTO[];
        id?: string;
        error?: string;
        autoCopyNext?: boolean;
      };
      if (j.items) setSaved(j.items);
      if (typeof j.autoCopyNext === "boolean") setAutoCopy(j.autoCopyNext);
      setError(r.ok ? null : (j.error ?? r.statusText));
      return r.ok ? j : null;
    } catch {
      setError("The app's server could not be reached.");
      return null;
    }
  }, []);

  // After every jump, route, target, copy or run change: the side menu and the table read again.
  useEffect(() => void call(), [currentSystem, revision, call]);

  const ids = useMemo(() => {
    if (!saved) return [];
    const known = new Set(saved.map((b) => b.id));
    if (included) return included.filter((id) => known.has(id));
    const first = saved.find((b) => b.current) ?? saved[0];
    return first ? [first.id] : [];
  }, [saved, included]);
  const idsKey = ids.join(",");

  const idsNow = useRef(idsKey);
  idsNow.current = idsKey;
  const loadTable = useCallback(() => {
    if (!idsKey) {
      setTable(null);
      setTableFor("");
      return;
    }
    void fetch(`/api/boxels/table?ids=${encodeURIComponent(idsKey)}`)
      .then(async (r) => {
        const j = (await r.json()) as BoxelTableDTO & { error?: string };
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        // A slow answer for boxels no longer ticked must not replace the newer one.
        if (idsKey !== idsNow.current) return;
        setTable(j);
        setTableFor(idsKey);
      })
      .catch((e: unknown) => {
        if (idsKey !== idsNow.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setTableFor(idsKey);
      });
  }, [idsKey]);
  // Other boxels ticked and theirs not in yet (a re-read after a jump keeps the same boxels: no sign).
  const tableStale = !!table && tableFor !== idsKey;

  useEffect(loadTable, [loadTable, saved]);
  // Every scan on the main screen re-reads the table (notables, biology) and the side menu's counts.
  const scanKey = dScan ? `${dScan.systemName}|${dScan.found}|${dScan.total}` : "";
  const firstScan = useRef(true);
  useEffect(() => {
    if (firstScan.current) {
      firstScan.current = false;
      return;
    }
    void call();
  }, [scanKey, call]);

  /*
    Look up (plan Q1): the boxel's systems from Spansh, pages five seconds apart. Polled while it
    runs; the table is read again as it goes and when it ends.
  */
  const lookupCall = useCallback(async (init?: RequestInit, path = "/api/boxels/lookup") => {
    try {
      const r = await fetch(path, init);
      const j = (await r.json()) as { status?: BoxelLookupStatus | null; error?: string };
      setLookup(j.status ?? null);
      if (!r.ok && j.error) setError(j.error);
    } catch {
      /* the next poll */
    }
  }, []);
  useEffect(() => void lookupCall(), [lookupCall]);
  const running = !!lookup?.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      void lookupCall();
      loadTable();
    }, 2_500);
    return () => {
      clearInterval(t);
      // The side menu too: a look-up that found systems past the end has extended the boxel.
      void call();
      loadTable();
    };
  }, [running, lookupCall, loadTable, call]);
  const lookUpBoxel = (b: SavedBoxelDTO) =>
    void lookupCall({ method: "POST" }, `/api/boxels/${encodeURIComponent(b.id)}/lookup`);

  const tick = (id: string, on: boolean) => {
    const set = new Set(ids);
    if (on) set.add(id);
    else set.delete(id);
    setIncluded([...set]);
  };
  const only = (id: string) => setIncluded([id]);

  /*
    Save a boxel by any of its systems, flown or not (the name alone says the boxel, owner 2026-10-05), to the highest
    system anyone recorded, or to `end` (a saved boxel's own row sets it: review P1), and tick it.
  */
  const addBoxel = (system: string, end: number | null = null) => {
    void call({
      method: "POST",
      headers: json,
      body: JSON.stringify({ system, end }),
    }).then((j) => {
      if (!j?.id) return;
      setAddInput("");
      if (!ids.includes(j.id)) setIncluded([j.id, ...ids]);
    });
  };
  // What Add saves: the system pasted, else (the field empty) the boxel you are in.
  const typed = parseBoxel(addInput.trim());
  const addTarget = typed ? addInput.trim() : !addInput.trim() && here ? currentSystem : null;
  const addWhat = typed ?? (addTarget ? here : null);

  /*
    History (owner, 2026-10-05; paged 2026-10-06: "go through the journal log from newest to oldest …
    a loading circle appears and moves down as older systems are loaded"): every boxel flown through,
    newest first, a page at a time — the first when the tab opens (and after each jump, save or search),
    the next when the list is scrolled to its end. The search runs on the server, over all of them.
  */
  const prevQuery = showPrevious ? sideQuery.trim() : "";
  const loadPrevious = useCallback(
    (reset: boolean) => {
      const gen = reset ? ++prevGen.current : prevGen.current;
      const offset = reset ? 0 : (previousRef.current?.length ?? 0);
      setPrevLoading(true);
      const q = new URLSearchParams({
        days: String(prevDays),
        offset: String(offset),
        limit: String(PREV_PAGE),
      });
      if (prevQuery) q.set("q", prevQuery);
      void fetch(`/api/boxels/previous?${q}`)
        .then((r) => r.json() as Promise<{ items?: PreviousBoxelDTO[]; total?: number }>)
        .then((j) => {
          if (gen !== prevGen.current) return;
          setPrevious((had) => [...(reset ? [] : (had ?? [])), ...(j.items ?? [])]);
          setPrevTotal(j.total ?? null);
        })
        .catch(() => gen === prevGen.current && reset && setPrevious([]))
        .finally(() => gen === prevGen.current && setPrevLoading(false));
    },
    [prevDays, prevQuery],
  );
  const previousRef = useRef<PreviousBoxelDTO[] | null>(null);
  previousRef.current = previous;
  useEffect(() => {
    if (!showPrevious) return;
    const t = window.setTimeout(() => loadPrevious(true), prevQuery ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [showPrevious, loadPrevious, prevQuery, saved, currentSystem]);
  // The end of the list in view: the next page.
  const prevHasMore = previous != null && prevTotal != null && previous.length < prevTotal;
  useEffect(() => {
    const el = prevMore.current;
    if (!el || !prevHasMore || prevLoading) return;
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) loadPrevious(false);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [prevHasMore, prevLoading, loadPrevious, previous]);
  const keep = (p: PreviousBoxelDTO) =>
    void call({
      method: "POST",
      headers: json,
      body: JSON.stringify({ system: p.lastSystem, end: null }),
    }).then((j) => {
      if (j?.id && !ids.includes(j.id)) setIncluded([j.id, ...ids]);
    });

  const patch = (id: string, body: Record<string, unknown>) =>
    call(
      { method: "PATCH", headers: json, body: JSON.stringify(body) },
      `/api/boxels/${encodeURIComponent(id)}`,
    );
  const remove = (id: string) => {
    void call({ method: "DELETE" }, `/api/boxels/${encodeURIComponent(id)}`).then(() =>
      setIncluded(ids.filter((x) => x !== id)),
    );
  };

  /*
    Open (owner, 2026-10-05): a system you flew opens in EDEXO from your journals; one you did not is
    looked up on Spansh (keyless and unthrottled, where EDSM allows about 360 requests an hour) and
    shown the same way — by the id64 a Look up kept, else by a name search.
  */
  const view = async (systemAddress: number, starSystem: string) => {
    await fetch("/api/ui/view-system", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ systemAddress, starSystem }),
    });
    showPickedSystem(onClose);
  };
  const openRow = (r: BoxelTableRowDTO) => {
    if (r.systemAddress != null)
      void view(r.systemAddress, r.name).catch(() => toast.error("The app's server could not be reached."));
    else void open(r.name);
  };
  const open = async (system: string) => {
    try {
      const r = await fetch(`/api/system/spansh-search?q=${encodeURIComponent(system)}`);
      const j = (await r.json()) as { systems?: { systemAddress: number; starSystem: string }[] };
      const hit = (j.systems ?? []).find((s) => s.starSystem.toLowerCase() === system.toLowerCase());
      if (!hit) {
        toast.error(`${system}: nobody has logged it on Spansh yet — it may be undiscovered.`);
        return;
      }
      await view(hit.systemAddress, hit.starSystem);
    } catch {
      toast.error("Spansh could not be reached.");
    }
  };

  const byId = useMemo(() => new Map((saved ?? []).map((b) => [b.id, b])), [saved]);
  const looked = useMemo(() => new Map((table?.lookups ?? []).map((l) => [l.boxelId, l])), [table]);
  /*
    The highest system per boxel known to exist: a cut (×) is offered only after it, since the boxel always
    lists as far as he has flown (owner, 2026-10-05), as far as a route he plotted goes, and as far as a Spansh
    look-up found (review 2026-11-05: a cut below those came straight back).
  */
  const knownMax = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of table?.rows ?? [])
      if (r.flown || r.onRoute || r.from === "lookup" || r.from === "route") m.set(r.boxelId, Math.max(m.get(r.boxelId) ?? -1, r.n));
    return m;
  }, [table]);
  const order = useMemo(() => new Map(ids.map((id, i) => [id, i])), [ids]);
  const columns = useMemo<Column<BoxelTableRowDTO>[]>(
    () => boxelColumns({ byId, order, knownMax, openRow, patch, setCutAsk }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byId, order, knownMax],
  );
  // A phone gets cards, titled by the system (owner, 2026-10-05: the redo works on a phone too).
  const narrow = useMediaQuery("(max-width: 760px)");
  const shownColumns = useMemo(
    () => (narrow ? [columns[1]!, columns[0]!, ...columns.slice(2)] : columns),
    [narrow, columns],
  );

  // Searched on the server (it searches every boxel, not only the pages read so far).
  const prevShown = previous ?? [];
  const sideShown = useMemo(() => {
    const q = sideQuery.trim();
    const mine = (saved ?? []).filter((b) => (sideTab === "explored") === boxelDone(b));
    if (!q) return mine;
    return mine.filter((b) => fuzzyRankAny([b.boxel, b.sector, b.lastSystem], q) != null);
  }, [saved, sideQuery, sideTab]);
  const exploredCount = (saved ?? []).filter(boxelDone).length;

  const ticked = ids.map((id) => byId.get(id)).filter((b): b is SavedBoxelDTO => !!b);
  const lead = ticked.find((b) => b.current) ?? ticked[0] ?? null;
  /*
    The system on the main screen reads its D-Scan line as it stands (owner, 2026-10-05: "it stays at
    5/24 … it should get the same data as the main screen"): the server has no system map for it.
  */
  /*
    By its figures, not the object: every snapshot (about once a second) brings a new dScan object, and
    keyed on that the whole table was rebuilt, filtered, sorted and drawn again each time — a quarter
    of a second for one 1,867-system boxel, the "unresponsive" Boxels screen (owner, 2026-10-06).
  */
  const dScanName = dScan?.systemName.toLowerCase() ?? null;
  const dScanFound = dScan?.found ?? 0;
  const dScanTotal = dScan?.total ?? 0;
  const allRows = useMemo(() => {
    const rows = table?.rows ?? [];
    if (dScanName == null) return rows;
    return rows.map((r) =>
      r.flown && r.name.toLowerCase() === dScanName
        ? { ...r, bodies: { scanned: dScanFound, total: dScanTotal } }
        : r,
    );
  }, [table, dScanName, dScanFound, dScanTotal]);
  const rows = useMemo(() => {
    const keep = boxelRowFilter(filterKind, filterQuery);
    return allRows.filter((r) => keep(r) && (!notFlownOnly || (!r.flown && !r.skipped)));
  }, [allRows, filterKind, filterQuery, notFlownOnly]);
  const suggestions = useMemo(() => boxelFilterSuggestions(filterKind, allRows), [filterKind, allRows]);
  /** The summary's counts: flown, skipped, and known from elsewhere (the split for its tooltip). */
  const sources = useMemo(() => {
    const n = (keep: (r: BoxelTableRowDTO) => boolean) => allRows.filter(keep).length;
    const index = n((r) => !r.flown && r.from === "index");
    const spansh = n((r) => !r.flown && r.from === "lookup");
    const routes = n((r) => !r.flown && !!r.onRoute);
    const gaps = n((r) => !r.flown && !!r.gap);
    const parts = [
      [index, "in the galaxy index"],
      [spansh, "from Spansh"],
      [routes, "on your routes (plotted or targeted, not flown)"],
      [gaps, "exist unrecorded (a higher system is known; mass codes a–g number without gaps)"],
    ] as const;
    return {
      flown: n((r) => r.flown),
      skipped: n((r) => !r.flown && !!r.skipped),
      elsewhere: n((r) => !r.flown && (r.from === "index" || r.from === "lookup" || r.from === "route" || !!r.onRoute || !!r.gap)),
      split: parts.filter(([k]) => k > 0).map(([k, what]) => `${k.toLocaleString()} ${what}`).join("\n") || "Nothing known beyond your own journals",
    };
  }, [allRows]);
  /*
    The same element while its inputs stand, so a snapshot that changes nothing in the table (one comes
    about every second in game) does not draw its rows again (owner, 2026-10-06).
  */
  const emptyText = table ? (allRows.length ? "No systems match." : "No systems.") : "Reading…";
  const tableEl = useMemo(
    () => (
      <Table
        rows={rows}
        columns={shownColumns}
        layout={narrow ? "cards" : "list"}
        sort={sort}
        onSort={(key) =>
          setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
        }
        rowKey={(r) => `${r.boxelId}:${r.n}`}
        csvName="boxels"
        empty={emptyText}
        resetKey={`${idsKey}|${filterKind}|${filterQuery}|${notFlownOnly}`}
      />
    ),
    [rows, shownColumns, narrow, sort, emptyText, idsKey, filterKind, filterQuery, notFlownOnly],
  );
  const kindDef = BOXEL_FILTER_KINDS.find((k) => k.value === filterKind)!;

  return (
    // In the backdrop only so the header's own layout rule (`.top > :not(.modal-backdrop)`) leaves it be.
    <div className="modal-backdrop" role="presentation">
      <div ref={dialogRef} className="boxel-screen" role="dialog" aria-modal="true" aria-label="Boxels">
        <header className="modal-head boxel-screen__head">
          <h3 className="boxel-screen__title">Boxels</h3>
          {/*
            One field (review P1, owner 2026-11-05): "Current boxel", "Plan" and "Last system #" overlapped. Any system
            of a boxel adds it, flown or not; empty, Add takes the boxel you are in. Its end is set on its own row (⋯).
          */}
          <form
            className="boxel-current"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (addTarget) addBoxel(addTarget);
            }}
          >
            <input
              className="carriers-search__input boxel-add__input"
              value={addInput}
              placeholder="Add a boxel: paste any system of it"
              aria-label="Add a boxel: any system name in it, flown or not"
              onChange={(ev) => setAddInput(ev.target.value)}
            />
            <button
              type="submit"
              className="fdb-chip fdb-chip--on"
              disabled={!addTarget}
              title={
                addWhat
                  ? `Save ${addWhat.boxel} in ${addWhat.sector} and show it`
                  : addInput.trim()
                    ? "Type a system with a boxel name (sector, letters, mass code and number)"
                    : "You are in a system with a catalogue name, which belongs to no boxel: paste a system of the boxel"
              }
            >
              {addWhat ? `Add ${addWhat.boxel}${typed ? "" : " (you are here)"}` : "Add"}
            </button>
          </form>
          <button
            type="button"
            className={`fold-help-btn boxel-help-btn${helpOpen ? " fold-help-btn--on" : ""}`}
            onClick={() => setHelpOpen(!helpOpen)}
            aria-expanded={helpOpen}
            title={helpOpen ? "Hide the mass code tables" : "What do the mass codes hold?"}
          >
            ?
          </button>
          <button type="button" className="modal-close" onClick={() => withTransition(onClose)} aria-label="Close">
            ×
          </button>
        </header>
        {massHelp.mounted ? <BoxelMassCodeHelp closing={massHelp.closing} /> : null}
        <BoxelLookingFor here={here} onSave={addBoxel} />

        <div className={`boxel-screen__body${sideOpen ? "" : " boxel-screen__body--folded"}`}>
          <aside
            className="boxel-side"
            aria-label="Your boxels"
            inert={!sideOpen}
            // History's next page when scrolled near its end (the observer below does the same).
            onScroll={(ev) => {
              const el = ev.currentTarget;
              if (
                showPrevious &&
                prevHasMore &&
                !prevLoading &&
                el.scrollTop + el.clientHeight >= el.scrollHeight - 160
              )
                loadPrevious(false);
            }}
          >
            <div className="boxel-side__tabs" role="tablist" aria-label="Which boxels" onKeyDown={(ev) => tabListKeyDown(ev, { follow: true })}>
              {(
                [
                  // Review P4 (owner, 2026-11-05): fully explored ones are saved too, so "Saved" said too little.
                  ["saved", "To fly", saved ? saved.length - exploredCount : null],
                  ["explored", "Done", saved ? exploredCount : null],
                  ["history", "Flown through", showPrevious ? prevTotal : null],
                ] as const
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={sideTab === k}
                  tabIndex={sideTab === k ? 0 : -1}
                  className={`disc-tab${sideTab === k ? " disc-tab--on" : ""}`}
                  onClick={() => setSideTab(k)}
                >
                  {label}
                  {n != null ? <span className="dim tiny"> {n.toLocaleString()}</span> : null}
                </button>
              ))}
            </div>
            <input
              type="search"
              className="my-exo-search-input boxel-side__search"
              placeholder={showPrevious ? "Search the boxels you flew through…" : "Search your boxels…"}
              value={sideQuery}
              onChange={(ev) => setSideQuery(ev.target.value)}
            />
            {showPrevious ? null : !saved ? (
              <LoadingNote className="tiny" label="Reading…" />
            ) : saved.length === 0 ? (
              <p className="dim tiny">
                No boxels yet. Paste a system such as Eol Prou AB-C d1-23 in <strong>Add a boxel</strong>, or press{" "}
                <strong>Add</strong> while you are in one.
              </p>
            ) : sideShown.length === 0 ? (
              <p className="dim tiny">
                {sideTab === "explored"
                  ? "None yet: a boxel moves here when every system is flown or skipped."
                  : sideQuery.trim()
                    ? "No saved boxel matches."
                    : "Every saved boxel is done."}
              </p>
            ) : (
              <ul className="boxel-side__list">
                {sideShown.map((b) => {
                  const on = ids.includes(b.id);
                  const done = boxelDone(b);
                  return (
                    <li
                      key={b.id}
                      className={`boxel-side__item${on ? " boxel-side__item--on" : ""}${done ? " boxel-side__item--done" : ""}`}
                    >
                      <label className="boxel-side__tick">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(ev) => tick(b.id, ev.target.checked)}
                          aria-label={`Show ${b.boxel} in ${b.sector} in the table`}
                        />
                      </label>
                      <button
                        type="button"
                        className="boxel-side__name"
                        title="Show only this boxel"
                        onClick={() => only(b.id)}
                      >
                        <strong>{b.boxel}</strong> <span className="dim">{b.sector}</span>
                        {b.current ? <span className="boxel-side__here">you are here</span> : null}
                        {b.run ? (
                          <span
                            className="boxel-side__here"
                            title="Boxel run: after every jump its next system is on the clipboard (F7 finishes it)"
                          >
                            run
                          </span>
                        ) : null}
                        <GoldenTag boxel={b.boxel} />
                      </button>
                      <span
                        className="boxel-side__bar"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={b.total}
                        aria-valuenow={b.flown + b.skipped.length}
                        aria-label={`${b.flown} of ${b.total} flown`}
                      >
                        <span style={{ width: `${((b.flown + b.skipped.length) / b.total) * 100}%` }} />
                      </span>
                      <span className="boxel-side__count dim tiny">
                        {b.flown} / {b.total} flown
                        {b.skipped.length ? ` · ${b.skipped.length} skipped` : ""}
                        {" · "}
                        <span className={b.notable ? "boxel-notable" : undefined}>{b.notable} notable</span>
                        {b.endKnown ? <span title="You checked in the galaxy map that the next system does not exist"> · ends at -{b.end}</span> : null}
                      </span>
                      <span className="boxel-side__actions boxel-side__actions--menu">
                        <BoxelSideActions
                          b={b}
                          lookedAt={looked.get(b.id)}
                          lookupRunning={running}
                          copied={copied}
                          onCopy={copyText}
                          onLookUp={() => lookUpBoxel(b)}
                          onPatch={(body) => void patch(b.id, body)}
                          onSetEnd={(n) => addBoxel(b.lastSystem, n)}
                          onDelete={() => remove(b.id)}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <section className="boxel-prev" aria-label="Boxels you flew through">
              {showPrevious ? (
                <>
                  <div className="boxel-prev__range" role="group" aria-label="Last visit within">
                    {PREV_RANGES.map((r) => (
                      <button
                        key={r.days}
                        type="button"
                        className={`disc-chip${prevDays === r.days ? " disc-chip--on" : ""}`}
                        aria-pressed={prevDays === r.days}
                        onClick={() => setPrevDays(r.days)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  {!previous ? (
                    <p className="dim tiny">Reading your journals…</p>
                  ) : prevShown.length === 0 ? (
                    <p className="dim tiny">No boxels flown in that time.</p>
                  ) : (
                    <ul className="boxel-side__list">
                      {prevShown.map((p) => (
                        <li key={p.prefix} className="boxel-side__item boxel-prev__item">
                          <span className="boxel-prev__name">
                            <strong>{p.boxel}</strong> <span className="dim">{p.sector}</span>
                          </span>
                          <span className="boxel-side__count dim tiny">
                            {p.flown} flown, up to -{p.highest}
                            {p.lastVisit ? ` · last ${p.lastVisit.slice(0, 10)}` : ""}
                          </span>
                          {p.notables.length || p.rareStars.length || p.species.length ? (
                            <span className="boxel-notables boxel-prev__why">
                              {p.notables.map((x) => (
                                <span key={x.kind} className="boxel-notable" title={NOTABLE_LABEL[x.kind]}>
                                  {NOTABLE_SHORT[x.kind]}
                                  {x.n != null && x.n > 1 ? ` ×${x.n}` : ""}
                                </span>
                              ))}
                              {p.rareStars.map((k) => (
                                <span key={k} className="bm-tag" title={STAR_LABEL[k] ?? k}>
                                  {k}
                                </span>
                              ))}
                              {p.species.length ? (
                                <span className="dim" title={p.species.join(", ")}>
                                  {p.species.length} species
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                          <span className="boxel-side__actions">
                            {p.saved ? (
                              <span className="dim tiny">saved</span>
                            ) : (
                              <button
                                type="button"
                                className="fdb-chip"
                                title="Save it to your boxels, for a return"
                                onClick={() => keep(p)}
                              >
                                Keep
                              </button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {prevHasMore || prevLoading ? (
                    <div ref={prevMore} className="boxel-loading" role="status">
                      <span className="boxel-loading__spin" aria-hidden="true" /> Loading
                      {prevTotal != null && previous
                        ? ` · ${previous.length.toLocaleString()} of ${prevTotal.toLocaleString()}`
                        : ""}
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          </aside>
          <button
            type="button"
            className="boxel-drawer"
            aria-expanded={sideOpen}
            aria-label={sideOpen ? "Hide your boxels" : "Show your boxels"}
            title={sideOpen ? "Hide the side menu" : "Show the side menu"}
            onClick={() => setSideOpen(!sideOpen)}
          >
            <span aria-hidden>{sideOpen ? "‹" : "›"}</span>
          </button>

          <main className="boxel-main">
            {error ? <p className="fdb-empty">{error}</p> : null}
            {ticked.length ? (
              // Review P7 (owner, 2026-11-05): nine pieces were one line; the sources' split is in the tooltip.
              <div className="fdb-summary">
                <span>
                  <strong>{ticked.length === 1 ? ticked[0]!.boxel : `${ticked.length} boxels`}</strong>
                  {ticked.length === 1 ? ` in ${ticked[0]!.sector}` : ""}
                </span>
                <span title={sources.split}>
                  <strong>
                    <RollingNumber text={sources.flown.toLocaleString()} />
                  </strong> / {allRows.length.toLocaleString()} flown
                  {sources.skipped ? ` · ${sources.skipped.toLocaleString()} skipped` : ""}
                  {sources.elsewhere ? ` · ${sources.elsewhere.toLocaleString()} known elsewhere` : ""}
                </span>
              </div>
            ) : null}
            {lead ? (
              <BoxelFlyingStrip
                lead={lead}
                several={ticked.length > 1}
                run={(saved ?? []).find((b) => b.run) ?? null}
                lastCopied={lastCopied}
                autoCopy={autoCopy}
                onAutoCopy={(on) =>
                  void call({ method: "POST", headers: json, body: JSON.stringify({ autoCopyNext: on }) }, "/api/boxels/options")
                }
                onPatch={(id, body) => void patch(id, body)}
              />
            ) : null}
            {lead?.shortest && lead.order ? <BoxelOrderLine b={lead} /> : null}
            {lookup && (lookup.running || lookup.note) ? (
              <p className="boxel-lookup-status" role="status">
                {lookup.running ? (
                  <>
                    Looking up <strong>{lookup.boxel}</strong> on Spansh: {lookup.systems.toLocaleString()}{" "}
                    systems in {lookup.pages} page{lookup.pages === 1 ? "" : "s"}…{" "}
                    <button
                      type="button"
                      className="fdb-chip"
                      onClick={() => void lookupCall({ method: "DELETE" })}
                    >
                      Stop
                    </button>
                  </>
                ) : (
                  <span className="dim">
                    {lookup.boxel}: {lookup.note}
                  </span>
                )}
              </p>
            ) : null}
            {table?.common.length ? (
              <p className="boxel-common">
                <span className="dim">Recorded most: </span>
                {table.common.map((c) => (
                  <span key={c.name} className="bm-tag">
                    {c.name} · {c.systems}
                  </span>
                ))}
              </p>
            ) : null}
            {table?.noIndex ? (
              <p className="dim tiny">No galaxy index on this machine: only your own journals were read.</p>
            ) : null}
            {cutAsk
              ? (() => {
                  const b = byId.get(cutAsk.id);
                  if (!b) return null;
                  const n = cutAsk.n;
                  const after = b.end - n;
                  // Offered only after the last system known to exist (knownMax), so nothing flown is cut.
                  return (
                    <div className="boxel-cut" role="alertdialog" aria-label="Delete from here">
                      <span>
                        Delete{" "}
                        <strong>
                          {b.boxel} -{n}
                        </strong>
                        {after > 0 ? ` and the ${after.toLocaleString()} after it` : ""}? The boxel will end
                        at -{n - 1}.
                      </span>
                      <span className="boxel-cut__actions">
                        <button
                          type="button"
                          className="fdb-chip boxel-del"
                          onClick={() => {
                            setCutAsk(null);
                            void patch(b.id, { cutFrom: n });
                          }}
                        >
                          Delete from -{n}
                        </button>
                        <button type="button" className="fdb-chip" onClick={() => setCutAsk(null)}>
                          Cancel
                        </button>
                      </span>
                    </div>
                  );
                })()
              : null}
            {ticked.length ? (
              <div className="boxel-filter" role="search">
                <Select
                  ariaLabel="What the search looks at"
                  className="boxel-filter__kind"
                  value={filterKind}
                  options={BOXEL_FILTER_KINDS.map((k) => ({ value: k.value, label: k.label }))}
                  onChange={(v) => setFilterKind(v)}
                />
                <input
                  type="search"
                  className="my-exo-search-input boxel-filter__input"
                  placeholder={`${kindDef.label}: ${kindDef.hint}`}
                  aria-label={`Filter by ${kindDef.label.toLowerCase()}`}
                  list={suggestions.length ? "boxel-filter-suggest" : undefined}
                  value={filterQuery}
                  onChange={(ev) => setFilterQuery(ev.target.value)}
                />
                {suggestions.length ? (
                  <datalist id="boxel-filter-suggest">
                    {suggestions.map((x) => (
                      <option key={x} value={x} />
                    ))}
                  </datalist>
                ) : null}
                <button
                  type="button"
                  className={`disc-chip${notFlownOnly ? " disc-chip--on" : ""}`}
                  aria-pressed={notFlownOnly}
                  onClick={() => setNotFlownOnly(!notFlownOnly)}
                >
                  Not flown yet
                </button>
                <span className="dim tiny">
                  {rows.length === allRows.length
                    ? `${allRows.length.toLocaleString()} systems`
                    : `${rows.length.toLocaleString()} of ${allRows.length.toLocaleString()}`}
                </span>
              </div>
            ) : null}
            {!saved && !error ? (
              <LoadingNote label="Reading your boxels…" />
            ) : ticked.length && !table && !error ? (
              <LoadingNote
                label="Reading the systems in this boxel…"
                detail="Every system in it, with the galaxy index and what your journals know of each."
              />
            ) : ticked.length ? (
              <>
                <RefreshBar active={tableStale} />
                <div className={`boxel-table-slot${tableStale ? " is-refreshing" : ""}`} aria-busy={tableStale}>
                  {tableEl}
                </div>
              </>
            ) : saved?.length ? (
              <p className="dim disc-empty">Tick a boxel in the side menu to list its systems.</p>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
