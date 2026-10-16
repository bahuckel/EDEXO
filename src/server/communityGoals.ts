/**
 * Community Goals (owner, 2026-10-16: "a notice with full info when a new CG starts").
 *
 * Frontier's own public list, the one its website reads: `api.orerve.net/2.0/website/initiatives/list`. No key, no
 * login, nothing about the commander in the request. Asked once shortly after start and then hourly, only while
 * Options → Notify me → Community goals is on; each goal is announced once, ever (the notices' `seen` list).
 *
 * The answer is `{ activeInitiatives: [...] }`, each with `id`, `title`, `expiry` ("2025-08-21 10:00:00", UTC),
 * `market_name`, `starsystem_name`, `activityType`, `objective`, `target_qty`, `qty` (strings) and `news`, whose
 * text carries the rewards (the shape as served in August 2025; an empty list when no goal runs).
 */

export const COMMUNITY_GOALS_URL = "https://api.orerve.net/2.0/website/initiatives/list?lang=en";
export const COMMUNITY_GOALS_INTERVAL_MS = 60 * 60 * 1000;
export const COMMUNITY_GOALS_FIRST_DELAY_MS = 30 * 1000;

export interface CommunityGoal {
  id: string;
  title: string;
  system: string;
  station: string;
  /** ISO UTC, or null when Frontier's date could not be read. */
  expiry: string | null;
  objective: string;
  activity: string;
  /** Progress towards the top tier, 0-100, or null when the numbers are missing. */
  progressPct: number | null;
  /** The reward lines of the news text ("- 1x of each class 5 and 6 cargo rack …"), at most four. */
  rewards: string[];
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

function expiryIso(raw: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(raw);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function rewardLines(news: string): string[] {
  const out: string[] = [];
  for (const line of news.split(/\r?\n/)) {
    const m = /^\s*[-•*]\s+(.+?)\s*$/.exec(line);
    if (m && m[1]) out.push(m[1]);
    if (out.length >= 4) break;
  }
  return out;
}

/** Frontier's list, read defensively: an entry without an id, a title or a system is left out. */
export function parseCommunityGoals(raw: unknown): CommunityGoal[] {
  const list = raw && typeof raw === "object" ? (raw as { activeInitiatives?: unknown }).activeInitiatives : null;
  if (!Array.isArray(list)) return [];
  const out: CommunityGoal[] = [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const id = str(r.id);
    const title = str(r.title);
    const system = str(r.starsystem_name);
    if (!id || !title || !system) continue;
    const target = Number(str(r.target_qty));
    const qty = Number(str(r.qty));
    out.push({
      id,
      title,
      system,
      station: str(r.market_name),
      expiry: expiryIso(str(r.expiry)),
      objective: str(r.objective) || str(r.target_commodity_list),
      activity: str(r.activityType),
      progressPct:
        Number.isFinite(target) && target > 0 && Number.isFinite(qty) ? Math.min(100, Math.round((qty / target) * 100)) : null,
      rewards: rewardLines(str(r.news)),
    });
  }
  return out;
}

/** The notice's words: where, what, until when, how far along, and what it pays. */
export function communityGoalNoticeText(g: CommunityGoal): string {
  const where = g.station ? `${g.station}, ${g.system}` : g.system;
  const parts = [`Sign up at ${where}.`];
  if (g.objective) parts.push(`Objective: ${g.objective}.`);
  if (g.expiry) parts.push(`Ends ${g.expiry.slice(0, 16).replace("T", " ")} UTC.`);
  if (g.progressPct != null) parts.push(`${g.progressPct} % of the top target so far.`);
  if (g.rewards.length) parts.push(`Rewards: ${g.rewards.map((r) => r.replace(/[.;\s]+$/, "")).join("; ")}.`);
  return parts.join(" ");
}

export interface CommunityGoalPoller {
  /** Asks now, outside the schedule. Resolves with the goals read, or null when the request failed. */
  pollNow(): Promise<CommunityGoal[] | null>;
  stop(): void;
}

export function startCommunityGoalPoller(o: {
  enabled: () => boolean;
  onGoals: (goals: CommunityGoal[]) => void;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  intervalMs?: number;
  firstDelayMs?: number;
}): CommunityGoalPoller {
  const fetchImpl = o.fetchImpl ?? fetch;
  let busy = false;
  const pollNow = async (): Promise<CommunityGoal[] | null> => {
    if (busy) return null;
    busy = true;
    try {
      const res = await fetchImpl(COMMUNITY_GOALS_URL, {
        headers: { Accept: "application/json", ...(o.userAgent ? { "User-Agent": o.userAgent } : {}) },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return null;
      const goals = parseCommunityGoals(await res.json());
      o.onGoals(goals);
      return goals;
    } catch {
      // Offline, or Frontier's site down: the next hour asks again.
      return null;
    } finally {
      busy = false;
    }
  };
  const tick = () => {
    if (o.enabled()) void pollNow();
  };
  const first = setTimeout(tick, o.firstDelayMs ?? COMMUNITY_GOALS_FIRST_DELAY_MS);
  const timer = setInterval(tick, o.intervalMs ?? COMMUNITY_GOALS_INTERVAL_MS);
  first.unref?.();
  timer.unref?.();
  return {
    pollNow,
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
