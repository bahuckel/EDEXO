/**
 * What electron/preload.cjs exposes to the app's own pages as `window.edexoElectron` (absent in a browser tab, so
 * optional). Used by the launcher's scripts (tsconfig.launcher.json); the React pages keep their own narrow casts.
 * Answers the main process gives without a fixed shape are `BridgeAnswer` (any): the pages check each field they read.
 */

/** An answer or a message with no fixed shape: the page checks each field it reads. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BridgeAnswer = any;

/** A HUD opened, toggled or pointed elsewhere (hudWindows.cjs requestHudOverlaySlot). */
interface EdexoHudOpenResult {
  opened: boolean;
  paths?: string[];
  error?: string;
}

/** `cb` with each message on a channel; the returned function stops it. */
type EdexoListen = (cb: (value: BridgeAnswer) => void) => () => void;

interface EdexoBridge {
  /** The app window with EDEXO's own title bar (main.cjs: no Windows caption). */
  customTitleBar: boolean;
  /** Tab view's windows (tabWindows.cjs). */
  tabs: {
    report(tabs: string[]): void;
    registry(): Promise<Record<string, string[]>>;
    focus(kind: string): Promise<boolean>;
    showInMain(front: string): Promise<boolean>;
    detach(req: { kind: string; x?: number; y?: number }): Promise<boolean>;
    moved(req: { from: string; kind: string }): void;
    windowEmpty(): void;
    dragging(on: boolean): void;
    on(cb: (event: BridgeAnswer) => void): () => void;
  };
  toggleFootOverlay(): Promise<EdexoHudOpenResult>;
  openHudOverlay(opts: { pathname: string; width?: number; height?: number }): Promise<EdexoHudOpenResult>;
  toggleHudOverlay(opts: { pathname: string; width?: number; height?: number }): Promise<EdexoHudOpenResult>;
  setHudOverlay(opts: { pathname: string; width?: number; height?: number }): Promise<EdexoHudOpenResult>;
  closeHudOverlay(opts: { pathname: string }): Promise<{ closed: boolean; paths?: string[] }>;
  /** Where the HUD stack sits, in what order, and its states (hudWindows.cjs `layout`). */
  getHudLayout(): Promise<BridgeAnswer>;
  setHudLayout(opts: Record<string, unknown>): Promise<BridgeAnswer>;
  toggleHudVisibility(opts?: { hidden?: boolean }): Promise<BridgeAnswer>;
  setHudMoveMode(opts: { on: boolean }): Promise<{ moving: boolean }>;
  setAimOverlay(opts: { on: boolean }): Promise<{ on: boolean }>;
  getAimCaptureSource(): Promise<string | null>;
  onAimGameFront: EdexoListen;
  hudDrag(phase: string): Promise<BridgeAnswer>;
  onHudMoveMode: EdexoListen;
  hudChain(dir: "below" | "right"): Promise<BridgeAnswer>;
  hudUnchain(): Promise<BridgeAnswer>;
  onHudChainOffers: EdexoListen;
  /** Close to tray: `{ enabled, available, reason? }`. */
  getTrayPref(): Promise<BridgeAnswer>;
  setTrayPref(opts: { enabled: boolean }): Promise<BridgeAnswer>;
  /** Hardware acceleration (gpuSafeMode.cjs): `{ safeNow, why, safeNext, locked, auto, reason }`. */
  getGraphicsPref(): Promise<BridgeAnswer>;
  setGraphicsPref(opts: { hardware: boolean }): Promise<BridgeAnswer>;
  /** `{ shortcut, registered }`. */
  getHotkeyStatus(): Promise<BridgeAnswer>;
  /** `{ binds, status, actions, groups }` (keybinds.cjs `get`). */
  getKeybinds(): Promise<BridgeAnswer>;
  setKeybinds(next: Record<string, string | null>): Promise<BridgeAnswer>;
  pauseKeybinds(opts: { on: boolean }): Promise<BridgeAnswer>;
  uiAck(r: unknown): void;
  onUiCommand: EdexoListen;
  onHudVisibility: EdexoListen;
  openAppWindow(): Promise<{ opened: boolean; focused?: boolean; error?: string }>;
  openColonizeWindow(): Promise<{ opened: boolean; focused?: boolean; error?: string }>;
  getFootOverlayOpen(): Promise<{ opened: boolean; paths?: string[] }>;
  getHudOverlayState(): Promise<{ paths: string[] }>;
  resizeHudOverlay(opts: { height: number; idle?: boolean; scale?: number }): Promise<{ ok: boolean }>;
  saveTextFile(opts: { defaultName: string; text: string }): Promise<{ saved: boolean; path?: string; error?: string }>;
  pickFolder(opts?: { defaultPath?: string }): Promise<{ path: string | null }>;
  relaunch(): Promise<BridgeAnswer>;
  installUpdate(): Promise<BridgeAnswer>;
  pushHudPrefs(prefs: unknown): void;
  onHudPrefs: EdexoListen;
  /** The EDEXO browser's toolbar (browserTabs.cjs); every answer is checked by the page. */
  browser: Record<string, (...args: BridgeAnswer[]) => BridgeAnswer>;
}

interface Window {
  edexoElectron?: EdexoBridge;
}
