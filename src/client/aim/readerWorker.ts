/**
 * The screen marker's readers off the page's thread (readerThread.ts starts it): each message a job (readerJobs.ts)
 * with its pixels handed over, each answer the reading or the error. One job at a time, in order.
 */
import { runReaderJob, type ReaderJob } from "./readerJobs";

self.onmessage = (e: MessageEvent<{ id: number; job: ReaderJob }>) => {
  const { id, job } = e.data;
  try {
    self.postMessage({ id, result: runReaderJob(job) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
