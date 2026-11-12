/* What the galaxy routes answer with: binary bodies and the "no index" 404 (plan 2026-11-10 Phase 7.2). */
import type express from "express";

export const sendBinary = (res: express.Response, buf: Buffer) => {
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.send(buf);
};
export const noIndex = (res: express.Response) =>
  res.status(404).json({ ok: false, error: "No galaxy index in this build." });
