/**
 * The screen marker's readers off the page's thread (readerThread.ts starts it): each message a job (readerJobs.ts)
 * with its pixels handed over, each answer the reading or the error. One job at a time, in order.
 */
import { runReaderJob, type ReaderJob } from "./readerJobs";

self.onmessage = async (e: MessageEvent<{ id: number; job: ReaderJob }>) => {
  const { id, job } = e.data;
  try {
    // Async only for the first job of a kind, which loads its glyph tables (readerJobs.ts).
    self.postMessage({ id, result: await runReaderJob(job) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
