/**
 * "This changed" pushes for the pages that used to ask on a timer (R2, owner 2026-10-24: "include those two R2
 * items in 1.3.0").
 *
 * The galaxy map's route and ship, its own-carrier badges, the Neutron drawer's live route and ship, the sector map's
 * commander position and the streamer view's settings were each read every 1 to 30 s while open, ~2 KB a time, most
 * of them unchanged. A page now opens one small socket (`/ws?channel=events`, client/serverChanges.ts), says which
 * topics it shows, and is told when one of them changes; it reads the endpoint then, and only then.
 *
 * A topic is the endpoint's own answer: the route module registers the function that builds it, and a change is a
 * different digest of that answer. So nothing has to remember to announce a change - a journal line, a POST from
 * another window or a file the game rewrote all show up the same way. Checked after every state push and on a slow
 * timer, and only for topics some open page asked for.
 */
import { createHash } from "node:crypto";

export type ChangeTopicReader = () => unknown;

export class ChangeTopics {
  private readonly readers = new Map<string, ChangeTopicReader>();
  private readonly digests = new Map<string, string>();

  /** Register what a topic is (the route module's answer for its endpoint). A later call replaces it. */
  watch(topic: string, read: ChangeTopicReader): void {
    this.readers.set(topic, read);
    this.digests.delete(topic);
  }

  has(topic: string): boolean {
    return this.readers.has(topic);
  }

  /**
   * Which of `topics` read differently from the last check. A topic's first check only sets its baseline (the page
   * reads it when it subscribes); a reader that throws is skipped this time.
   */
  changed(topics: Iterable<string>): string[] {
    const out: string[] = [];
    for (const topic of topics) {
      const read = this.readers.get(topic);
      if (!read) continue;
      let digest: string;
      try {
        digest = createHash("sha1")
          .update(JSON.stringify(read()) ?? "")
          .digest("base64");
      } catch {
        continue;
      }
      const prev = this.digests.get(topic);
      this.digests.set(topic, digest);
      if (prev !== undefined && prev !== digest) out.push(topic);
    }
    return out;
  }

  /** A topic nobody watches any more: its baseline goes, so a page that subscribes later starts fresh. */
  forget(topic: string): void {
    this.digests.delete(topic);
  }
}
