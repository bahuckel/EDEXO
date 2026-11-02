/**
 * The ship's position from the game's network log, opt-in (plan 1.3.5 R-1, owner 2026-11-01: "option 2 as opt-in").
 *
 * With `VerboseLogging="1"` on its `<Network>` element (AppConfigLocal.xml in the game's product folder; off by
 * default, read when the game starts) the game writes a line like
 *   `{17:05:46GMT 39130.337s} System:"Lyaisa FA-Q d5-664" StarPos:(…)ly Body:1 RelPos:(-2.95e+06,-959778,914984)km Supercruise`
 * : the body it measures the ship from and the offset to it, in km. Measured on the owner's logs (docs/perf
 * _netlog-frame.mts): one line each time that body changes in supercruise, about every 1.2 s in normal flight near a
 * body; the distance matches the journal's orbits, the direction is in the game's axes, which the orbits' frame does
 * not share, so only the body and the distance are used.
 *
 * The same file carries the addresses of other players' machines: only the position lines are matched, and nothing
 * else is read into memory beyond the chunk being scanned or kept.
 *
 * The switch writes the setting into every product folder found (Steam libraries, Epic, Frontier's own launcher) and
 * remembers each file as it was, so switching off puts back exactly what was there unless the file changed since.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { writeFileAtomic } from "./atomicWrite.js";
import { resolveUserSettingsJsonPath } from "./paths.js";
import { SHIP_NEAR_LS, type NetlogStatusDTO } from "../shared/dto/routeSystem.js";

export interface NetlogFix {
  system: string;
  bodyId: number;
  distLs: number;
  mode: "supercruise" | "normal";
  atMs: number;
}

const KM_PER_LS = 299_792.458;
/** A position line; the RelPos numbers as the game prints them (1.2e+06, -959778). */
const LINE =
  /\{(\d\d):(\d\d):(\d\d)GMT [0-9.]+s\} System:"([^"]+)" StarPos:\([^)]*\)ly Body:(\d+) RelPos:\(([-0-9.e+]+),([-0-9.e+]+),([-0-9.e+]+)\)km (\w+)/;

/** One netlog line as a fix; null for any other line. `nowMs` dates the line's UTC clock time. */
export function parseNetlogFix(line: string, nowMs: number): NetlogFix | null {
  const m = LINE.exec(line);
  if (!m) return null;
  const [x, y, z] = [Number(m[6]), Number(m[7]), Number(m[8])];
  if (![x, y, z].every(Number.isFinite)) return null;
  const d = new Date(nowMs);
  let at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(m[1]), Number(m[2]), Number(m[3]));
  // A line from just before midnight read just after it.
  if (at > nowMs + 60_000) at -= 86_400_000;
  return {
    system: m[4]!,
    bodyId: Number(m[5]),
    distLs: Math.hypot(x, y, z) / KM_PER_LS,
    mode: m[9] === "Supercruise" ? "supercruise" : "normal",
    atMs: at,
  };
}

/** Steam's library folders (libraryfolders.vdf's "path" entries), each one's Elite Products folder. */
function steamLibraries(steamDir: string, roots: Set<string>, windows: boolean): void {
  try {
    const vdf = readFileSync(join(steamDir, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
      const lib = windows ? m[1]!.replace(/\\\\/g, "\\") : m[1]!;
      roots.add(join(lib, "steamapps", "common", "Elite Dangerous", "Products"));
    }
  } catch {
    /* no Steam here */
  }
}

/**
 * The game's product folders (each holds EliteDangerous64.exe and its Logs): Steam libraries, Epic, Frontier on
 * Windows; on Linux (Proton, plan 1.3.6 M-1) the libraries of a native, Flatpak or Snap Steam and Heroic's default
 * folder for Epic. `EDEXO_ELITE_PRODUCTS_DIR` names one more Products folder, for any other install.
 */
export function findGameProductDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string[] {
  const roots = new Set<string>();
  if (env.EDEXO_ELITE_PRODUCTS_DIR) roots.add(env.EDEXO_ELITE_PRODUCTS_DIR);
  if (platform === "win32") {
    const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const pf = env.ProgramFiles || "C:\\Program Files";
    roots.add(join(pf86, "Frontier", "Products"));
    roots.add(join(pf, "Frontier", "Products"));
    roots.add(join(env.LOCALAPPDATA || "", "Frontier_Developments", "Products"));
    roots.add(join(pf, "Epic Games", "EliteDangerous", "Products"));
    for (const steam of [join(pf86, "Steam"), join(pf, "Steam")]) steamLibraries(steam, roots, true);
  } else if (platform === "linux") {
    for (const steam of [
      join(home, ".steam", "steam"),
      join(home, ".local", "share", "Steam"),
      join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
      join(home, "snap", "steam", "common", ".local", "share", "Steam"),
    ])
      steamLibraries(steam, roots, false);
    roots.add(join(home, "Games", "Heroic", "EliteDangerous", "Products"));
  }
  const out: string[] = [];
  for (const root of roots) {
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const n of names) if (existsSync(join(root, n, "EliteDangerous64.exe"))) out.push(join(root, n));
  }
  return out;
}

const SETTING = 'VerboseLogging="1"';
const NEW_FILE = `<?xml version="1.0" encoding="UTF-8" ?>\n<AppConfig>\n\t<Network ${SETTING} />\n</AppConfig>\n`;

/** AppConfigLocal.xml's text with the setting on; null when it is already on or the file cannot be read as one. */
export function withVerboseLogging(text: string | null): string | null {
  if (text == null) return NEW_FILE;
  const net = /<Network\b[^>]*>/.exec(text);
  if (net) {
    if (net[0].includes(SETTING)) return null;
    const tag = /VerboseLogging="[^"]*"/.test(net[0])
      ? net[0].replace(/VerboseLogging="[^"]*"/, SETTING)
      : net[0].replace("<Network", `<Network ${SETTING}`);
    return text.slice(0, net.index) + tag + text.slice(net.index + net[0].length);
  }
  const end = text.lastIndexOf("</AppConfig>");
  if (end < 0) return null;
  return `${text.slice(0, end)}\t<Network ${SETTING} />\n${text.slice(end)}`;
}

/** What the switch wrote: each file as it was before (null: there was none) and as written. */
type Changed = { file: string; before: string | null; after: string };
type Saved = { on: boolean; changed: Changed[] };

const prefsPath = () => join(dirname(resolveUserSettingsJsonPath()), "netlog-position.json");
function loadSaved(): Saved {
  try {
    const j = JSON.parse(readFileSync(prefsPath(), "utf8")) as Partial<Saved>;
    return { on: j.on === true, changed: Array.isArray(j.changed) ? j.changed : [] };
  } catch {
    return { on: false, changed: [] };
  }
}

const readText = (f: string): string | null => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
};

export interface NetlogPosition {
  fix(): NetlogFix | null;
  /** The last fix within SHIP_NEAR_LS of its body: the body the ship was last near. */
  near(): NetlogFix | null;
  status(): NetlogStatusDTO;
  setOn(on: boolean): NetlogStatusDTO;
  dispose(): void;
}

/** Bytes read back from the end of a log on first opening it: the session's latest position is near the end. */
const TAIL_BYTES = 256 * 1024;

export function createNetlogPosition(opts: { pollMs?: number; findDirs?: () => string[] } = {}): NetlogPosition {
  const findDirs = opts.findDirs ?? (() => findGameProductDirs());
  let saved = loadSaved();
  let dirs: string[] = [];
  let failed = false;
  let last: NetlogFix | null = null;
  let lastNear: NetlogFix | null = null;
  let file: string | null = null;
  let offset = 0;
  let rest = "";
  let lastList = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** The newest netLog among the product folders (the folder played last). */
  const newestLog = (): string | null => {
    let best: { f: string; m: number } | null = null;
    for (const d of dirs) {
      let names: string[];
      try {
        names = readdirSync(join(d, "Logs"));
      } catch {
        continue;
      }
      for (const n of names) {
        if (!/^netLog\..*\.log$/.test(n)) continue;
        const f = join(d, "Logs", n);
        try {
          const m = statSync(f).mtimeMs;
          if (!best || m > best.m) best = { f, m };
        } catch {
          /* gone */
        }
      }
    }
    return best?.f ?? null;
  };

  const tick = () => {
    const now = Date.now();
    // A new game session starts a new log: look again every 10 s.
    if (!file || now - lastList > 10_000) {
      lastList = now;
      const f = newestLog();
      if (f && f !== file) {
        file = f;
        offset = Math.max(0, statSync(f).size - TAIL_BYTES);
        rest = "";
      }
    }
    if (!file) return;
    let size: number;
    // Lines carry a clock time only: dated on the day the log was last written, not today (code review 2026-11-02: an
    // old session's log read at start looked newer than the journal).
    let dayRefMs = now;
    try {
      const st = statSync(file);
      size = st.size;
      dayRefMs = Math.min(now, st.mtimeMs);
    } catch {
      file = null;
      return;
    }
    if (size < offset) offset = 0;
    if (size === offset) return;
    const fd = openSync(file, "r");
    try {
      const len = Math.min(size - offset, 4 * 1024 * 1024);
      const buf = Buffer.alloc(len);
      // A short read while the game appends: take what came, the rest next tick (code review 2026-11-02).
      const got = readSync(fd, buf, 0, len, offset);
      if (got <= 0) return;
      offset += got;
      const lines = (rest + buf.toString("utf8", 0, got)).split("\n");
      rest = lines.pop() ?? "";
      if (rest.length > 64 * 1024) rest = "";
      for (const l of lines) {
        if (!l.includes("RelPos:")) continue;
        const f = parseNetlogFix(l, dayRefMs);
        if (!f) continue;
        last = f;
        if (f.distLs <= SHIP_NEAR_LS) lastNear = f;
      }
    } finally {
      closeSync(fd);
    }
  };

  const start = () => {
    dirs = findDirs();
    if (timer || !dirs.length) return;
    timer = setInterval(() => {
      try {
        tick();
      } catch {
        /* a locked or vanished log: the next tick tries again */
      }
    }, opts.pollMs ?? 1000);
    timer.unref?.();
    try {
      tick();
    } catch {
      /* as above */
    }
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    last = null;
    lastNear = null;
    file = null;
  };

  const persist = () => {
    try {
      writeFileAtomic(prefsPath(), `${JSON.stringify(saved, null, 2)}\n`, "utf8");
    } catch {
      /* kept for this run */
    }
  };

  const status = (): NetlogStatusDTO => {
    const folder = file ? dirname(dirname(file)) : (dirs[0] ?? null);
    if (!saved.on) return { on: false, state: "off", folder: null };
    if (failed) return { on: true, state: "failed", folder };
    if (!dirs.length) return { on: true, state: "no-game", folder: null };
    return { on: true, state: last ? "reading" : "waiting", folder };
  };

  const setOn = (on: boolean): NetlogStatusDTO => {
    failed = false;
    if (on) {
      dirs = findDirs();
      for (const d of dirs) {
        const f = join(d, "AppConfigLocal.xml");
        const before = readText(f);
        const after = withVerboseLogging(before);
        if (after == null) continue;
        try {
          writeFileAtomic(f, after, "utf8");
          if (!saved.changed.some((c) => c.file === f)) saved.changed.push({ file: f, before, after });
        } catch {
          failed = true;
        }
      }
      saved.on = true;
      persist();
      start();
    } else {
      // Put back what the switch changed, where nobody has changed the file since.
      const kept: Changed[] = [];
      for (const c of saved.changed) {
        if (readText(c.file) !== c.after) continue;
        try {
          if (c.before == null) unlinkSync(c.file);
          else writeFileAtomic(c.file, c.before, "utf8");
        } catch {
          kept.push(c);
        }
      }
      saved = { on: false, changed: kept };
      persist();
      stop();
    }
    return status();
  };

  if (saved.on) {
    start();
    // Switched on in an earlier run: a settings file still without the setting was never written (EPERM under Program
    // Files) or was put back since; "waiting" would ask for a game restart that cannot help (code review 2026-11-02).
    failed = dirs.some((d) => withVerboseLogging(readText(join(d, "AppConfigLocal.xml"))) != null);
  }
  return { fix: () => last, near: () => lastNear, status, setOn, dispose: stop };
}
