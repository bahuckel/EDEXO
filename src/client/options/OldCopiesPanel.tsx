/**
 * Options › Devices and journals › Old copies (discuss item 24, owner 2026-10-23): the one-off copies kept in the app's
 * data folder before a rebuild or a migration (server/oldCopies.ts), with their sizes, and one button that removes them
 * after a second click. Never automatic.
 */
import { useEffect, useState } from "react";
import { FoldPanel } from "../ui/Fold";

interface OldCopy {
  path: string;
  bytes: number;
  modified: string;
}

const size = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${Math.round(b / 1e6).toLocaleString("en-US")} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;

export function OldCopiesPanel() {
  const [list, setList] = useState<{ files: OldCopy[]; bytes: number } | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    void fetch("/api/old-copies", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { files: OldCopy[]; bytes: number } | null) => j && setList(j))
      .catch(() => undefined);
    return () => ac.abort();
  }, []);

  const remove = async () => {
    if (!list) return;
    setBusy(true);
    try {
      const r = await fetch("/api/old-copies/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: list.files.map((f) => f.path) }),
      });
      const j = (await r.json()) as { removed: string[]; skipped: string[]; files: OldCopy[]; bytes: number };
      setNote(
        `Removed ${j.removed.length} cop${j.removed.length === 1 ? "y" : "ies"}${j.skipped.length ? `; ${j.skipped.length} could not be removed (in use?)` : ""}.`,
      );
      setList({ files: j.files, bytes: j.bytes });
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <FoldPanel
      foldKey="options-old-copies"
      defaultOpen={false}
      className="options-meta-block"
      title="Old copies"
      summary={list ? (list.files.length ? `${list.files.length} · ${size(list.bytes)}` : "none") : "…"}
    >
      <p className="dim" style={{ marginTop: 0 }}>
        Copies the app kept in its data folder before a rebuild or a migration, in case one went wrong. Nothing uses
        them; your backups are elsewhere and are not touched.
      </p>
      {list?.files.length ? (
        <>
          <ul className="options-old-copies">
            {list.files.map((f) => (
              <li key={f.path}>
                <code>{f.path}</code> <span className="dim">{size(f.bytes)} · {f.modified.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
          {armed ? (
            <p className="options-oneline">
              <button type="button" className="btn-top-neutral" disabled={busy} onClick={() => void remove()}>
                {busy ? "Removing…" : `Remove all ${list.files.length} (${size(list.bytes)})`}
              </button>
              <button type="button" className="btn-top-toggle" onClick={() => setArmed(false)}>
                Keep them
              </button>
            </p>
          ) : (
            <p className="options-oneline">
              <button type="button" className="btn-top-neutral" onClick={() => setArmed(true)}>
                Remove old copies…
              </button>
            </p>
          )}
        </>
      ) : list ? (
        <p className="dim">None.</p>
      ) : null}
      {note ? <p className="dim">{note}</p> : null}
    </FoldPanel>
  );
}
