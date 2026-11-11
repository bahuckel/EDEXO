/**
 * The launcher's IPC (electron/launcherIpc.cjs; review 2026-11-07 §7, code review E): what opens, moves or hides HUDs
 * and switches the tray or the screen marker answers the launcher's own page only. Every caller is a launcher script;
 * another page of the app, or a frame inside one, gets the current state back and changes nothing.
 */
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { registerLauncherIpc } = require("../electron/launcherIpc.cjs") as {
  registerLauncherIpc: (deps: Record<string, unknown>, icon: unknown) => void;
};

function setup() {
  const handle = new Map<string, (evt: unknown, opts?: unknown) => unknown>();
  const launcher = { webContents: { id: 1 }, isDestroyed: () => false };
  const huds = {
    paths: () => [],
    request: vi.fn(async () => ({ opened: true, paths: ["/x"] })),
    close: vi.fn(() => ({ closed: true, paths: [] })),
    layout: vi.fn(() => ({ saved: true })),
    setLayout: vi.fn(() => ({ changed: true })),
    toggleVisibility: vi.fn(() => true),
    setMoveMode: vi.fn(() => true),
  };
  const aim = { set: vi.fn(() => true), captureSource: () => null, setReader: () => {} };
  const appWindows = { openAppUiWindow: vi.fn(() => ({ opened: true })), openColonizeWindow: vi.fn(() => ({ opened: true })) };
  const setCloseToTray = vi.fn();
  registerLauncherIpc(
    {
      electron: { app: {}, dialog: {}, ipcMain: { handle: (ch: string, fn: never) => handle.set(ch, fn), on: () => {} }, BrowserWindow: {} },
      huds,
      aim,
      appWindows,
      keybinds: {},
      trayControl: {},
      quitFlow: {},
      tray: { closeToTray: () => false, setCloseToTray, trayAvailability: () => ({}) },
      graphics: {},
      gpuSafeDir: "",
      hotkey: { get: () => false, set: () => {} },
      getRuntime: () => null,
      getMainWindow: () => launcher,
    },
    null,
  );
  return { handle, launcher, huds, aim, setCloseToTray, appWindows };
}

describe("launcher IPC senders", () => {
  const calls: [string, unknown][] = [
    ["edexo:open-hud-overlay", { pathname: "/hud-overlay.html" }],
    ["edexo:toggle-hud-overlay", { pathname: "/hud-overlay.html" }],
    ["edexo:set-hud-overlay", { pathname: "/hud-overlay.html" }],
    ["edexo:close-hud-overlay", { pathname: "/hud-overlay.html" }],
    ["edexo:set-hud-layout", { a: 1 }],
    ["edexo:toggle-hud-visibility", { hidden: true }],
    ["edexo:set-hud-move-mode", { on: true }],
    ["edexo:toggle-foot-overlay", undefined],
    ["edexo:set-aim-overlay", { on: true }],
    ["edexo:set-tray-pref", { enabled: true }],
    // Review 2026-11-10 D6: the launcher's two window buttons.
    ["edexo:open-app-window", undefined],
    ["edexo:open-colonize-window", undefined],
  ];

  it("changes nothing for a page that is not the launcher", async () => {
    const t = setup();
    const stranger = { sender: { id: 2 } };
    for (const [ch, opts] of calls) await t.handle.get(ch)!(stranger, opts);
    expect(t.huds.request).not.toHaveBeenCalled();
    expect(t.huds.close).not.toHaveBeenCalled();
    expect(t.huds.setLayout).not.toHaveBeenCalled();
    expect(t.huds.toggleVisibility).not.toHaveBeenCalled();
    expect(t.huds.setMoveMode).not.toHaveBeenCalled();
    expect(t.aim.set).not.toHaveBeenCalled();
    expect(t.setCloseToTray).not.toHaveBeenCalled();
    expect(t.appWindows.openAppUiWindow).not.toHaveBeenCalled();
    expect(t.appWindows.openColonizeWindow).not.toHaveBeenCalled();
  });

  it("does what the launcher asks", async () => {
    const t = setup();
    const own = { sender: t.launcher.webContents };
    for (const [ch, opts] of calls) await t.handle.get(ch)!(own, opts);
    expect(t.huds.request).toHaveBeenCalledTimes(4);
    expect(t.huds.close).toHaveBeenCalledTimes(1);
    expect(t.huds.setLayout).toHaveBeenCalledWith({ a: 1 });
    expect(t.huds.toggleVisibility).toHaveBeenCalledWith(true);
    expect(t.huds.setMoveMode).toHaveBeenCalledWith(true);
    expect(t.aim.set).toHaveBeenCalledWith(true);
    expect(t.setCloseToTray).toHaveBeenCalledWith(true);
    expect(t.appWindows.openAppUiWindow).toHaveBeenCalledTimes(1);
    expect(t.appWindows.openColonizeWindow).toHaveBeenCalledTimes(1);
  });
});
