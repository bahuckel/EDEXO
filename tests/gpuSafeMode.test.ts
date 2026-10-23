/**
 * Safe graphics mode (L1, Linux ticket T-MVFLSBPM-E5DC): which starts run without the GPU, when a crash turns it on,
 * and the remembered flag.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const gpu = require("../electron/gpuSafeMode.cjs") as {
  GPU_SAFE_FILE: string;
  GPU_RETRY_ARG: string;
  readGpuSafe(dir: string): { on: boolean; auto: boolean; reason: string; at: string } | null;
  writeGpuSafe(dir: string, rec: object): boolean;
  clearGpuSafe(dir: string): void;
  graphicsMode(o: { env: Record<string, string | undefined>; argv: string[]; flag: object | null }): {
    safe: boolean;
    why: string | null;
    addSwitches: boolean;
  };
  shouldSwitchToSafe(o: {
    platform: string;
    details: { type?: string; reason?: string } | null;
    sinceStartMs: number;
    safe: boolean;
    argv: string[];
  }): boolean;
};

describe("graphicsMode", () => {
  it("uses the GPU unless the flag, the env or the commander's own switch says otherwise", () => {
    expect(gpu.graphicsMode({ env: {}, argv: ["edexo"], flag: null })).toEqual({ safe: false, why: null, addSwitches: false });
    expect(gpu.graphicsMode({ env: {}, argv: ["edexo"], flag: { on: true } })).toEqual({ safe: true, why: "flag", addSwitches: true });
    expect(gpu.graphicsMode({ env: { EDEXO_SAFE_GRAPHICS: "1" }, argv: ["edexo"], flag: null })).toMatchObject({
      safe: true,
      why: "env",
    });
    // His own --disable-gpu: already off, nothing to add.
    expect(gpu.graphicsMode({ env: {}, argv: ["edexo", "--disable-gpu"], flag: { on: true } })).toEqual({
      safe: true,
      why: "argv",
      addSwitches: false,
    });
  });
});

describe("shouldSwitchToSafe", () => {
  const base = {
    platform: "linux",
    details: { type: "GPU", reason: "crashed" },
    sinceStartMs: 4_000,
    safe: false,
    argv: ["edexo"],
  };
  it("switches on a Linux GPU crash at start (the ticket)", () => {
    expect(gpu.shouldSwitchToSafe(base)).toBe(true);
    expect(gpu.shouldSwitchToSafe({ ...base, details: { type: "GPU", reason: "launch-failed" } })).toBe(true);
  });
  it("leaves every other case alone", () => {
    expect(gpu.shouldSwitchToSafe({ ...base, platform: "win32" })).toBe(false);
    expect(gpu.shouldSwitchToSafe({ ...base, sinceStartMs: 120_000 })).toBe(false);
    expect(gpu.shouldSwitchToSafe({ ...base, safe: true })).toBe(false);
    expect(gpu.shouldSwitchToSafe({ ...base, argv: ["edexo", gpu.GPU_RETRY_ARG] })).toBe(false);
    expect(gpu.shouldSwitchToSafe({ ...base, details: { type: "Utility", reason: "crashed" } })).toBe(false);
    expect(gpu.shouldSwitchToSafe({ ...base, details: { type: "GPU", reason: "clean-exit" } })).toBe(false);
    expect(gpu.shouldSwitchToSafe({ ...base, details: null })).toBe(false);
  });
});

describe("the remembered flag", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "edexo-gpu-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes, reads and clears; a broken or 'off' file reads as none", () => {
    expect(gpu.readGpuSafe(dir)).toBeNull();
    expect(gpu.writeGpuSafe(dir, { auto: true, reason: "GPU process crashed (exit 139) at start", at: "2026-10-23T12:00:00Z" })).toBe(true);
    expect(gpu.readGpuSafe(dir)).toEqual({
      on: true,
      auto: true,
      reason: "GPU process crashed (exit 139) at start",
      at: "2026-10-23T12:00:00Z",
    });
    gpu.clearGpuSafe(dir);
    expect(gpu.readGpuSafe(dir)).toBeNull();
    writeFileSync(path.join(dir, gpu.GPU_SAFE_FILE), "{ not json");
    expect(gpu.readGpuSafe(dir)).toBeNull();
    writeFileSync(path.join(dir, gpu.GPU_SAFE_FILE), JSON.stringify({ on: false }));
    expect(gpu.readGpuSafe(dir)).toBeNull();
  });
});
