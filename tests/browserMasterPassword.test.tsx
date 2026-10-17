/**
 * @vitest-environment jsdom
 *
 * The browser's master password rows and the key button's unlock (1.2.19, src/client/BrowserMasterPassword.tsx):
 * set asks the new password twice, a locked store offers Unlock, the chip unlocks from the toolbar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MasterPasswordSettings, UnlockLoginsChip } from "../src/client/BrowserMasterPassword";
import { BrowserPrivacyPanel } from "../src/client/BrowserPrivacyPanel";
import type { BrowserState } from "../src/client/BrowserScreen";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Type into a controlled input the way React sees it. */
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
const flush = () => act(async () => {});

/** The browser state every call answers with; the components only hand it back to their caller. */
const state = {} as BrowserState;

function api() {
  return {
    masterUnlock: vi.fn(async (p: string) =>
      p === "right one" ? { ok: true, state } : { error: "Wrong master password.", state },
    ),
    masterLock: vi.fn(async () => ({ ok: true, state })),
    masterSet: vi.fn(async (_p: string, _c?: string) => ({ ok: true, state })),
    masterRemove: vi.fn(async (_c: string) => ({ ok: true, state })),
  };
}

describe("master password settings", () => {
  it("set: the two new passwords must match, then it calls set without a current one", async () => {
    const a = api();
    act(() => root.render(<MasterPasswordSettings master={{ set: false, unlocked: false }} savedCount={2} api={a} after={() => {}} />));
    act(() => button("Set a master password").click());
    const [next, again] = [...host.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    act(() => {
      type(next!, "abcdefgh");
      type(again!, "abcdefgX");
    });
    act(() => button("Set").click());
    await flush();
    expect(a.masterSet).not.toHaveBeenCalled();
    expect(host.textContent).toContain("The two new passwords differ.");
    act(() => type(again!, "abcdefgh"));
    act(() => button("Set").click());
    await flush();
    expect(a.masterSet).toHaveBeenCalledWith("abcdefgh", undefined);
  });

  it("locked: says how many logins it hides, and a wrong password shows the error", async () => {
    const a = api();
    const after = vi.fn();
    act(() => root.render(<MasterPasswordSettings master={{ set: true, unlocked: false }} savedCount={3} api={a} after={after} />));
    expect(host.textContent).toContain("Locked: 3 saved logins cannot be read");
    const input = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    act(() => type(input, "nope"));
    act(() => button("Unlock").click());
    await flush();
    expect(a.masterUnlock).toHaveBeenCalledWith("nope");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Wrong master password.");
    expect(after).toHaveBeenCalled();
  });

  it("unlocked: Lock now, and Remove asks for the current password", async () => {
    const a = api();
    act(() => root.render(<MasterPasswordSettings master={{ set: true, unlocked: true }} savedCount={1} api={a} after={() => {}} />));
    act(() => button("Lock now").click());
    await flush();
    expect(a.masterLock).toHaveBeenCalled();
    act(() => button("Remove…").click());
    const current = host.querySelector<HTMLInputElement>('input[aria-label="Current master password"]')!;
    act(() => type(current, "right one"));
    act(() => button("Remove").click());
    await flush();
    expect(a.masterRemove).toHaveBeenCalledWith("right one");
  });
});

describe("the key button while locked", () => {
  it("opens an unlock field and closes once unlocked", async () => {
    const a = api();
    act(() => root.render(<UnlockLoginsChip count={1} unlock={a.masterUnlock} />));
    act(() => button(" Unlock logins").click());
    const input = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    act(() => type(input, "right one"));
    act(() => button("Unlock").click());
    await flush();
    expect(a.masterUnlock).toHaveBeenCalledWith("right one");
    expect(host.querySelector('input[type="password"]')).toBeNull();
  });
});

describe("Privacy & Security view (owner, 2026-10-17)", () => {
  it("lists the three options, each [?] unfolds its own explanation, Back returns", () => {
    const st = {
      keepCache: false,
      rememberPasswords: true,
      passwords: { available: true, reason: null, saved: [], savedCount: 0, master: { set: false, unlocked: false }, never: [] },
    };
    const r = async () => ({ ok: true, state: st });
    const onBack = vi.fn();
    const panelApi = { ...api(), setKeepCache: r, setRememberPasswords: r, passwordDelete: r, passwordDeleteAll: r, passwordNeverRemove: r };
    act(() =>
      root.render(
        <BrowserPrivacyPanel st={st} api={panelApi as never} setSt={() => {}} onBack={onBack} />,
      ),
    );
    const titles = [...host.querySelectorAll(".ebr-privacy__title")].map((e) => e.textContent);
    expect(titles).toEqual(["Keep page cache", "Remember passwords", "Master password · off"]);
    const helps = [...host.querySelectorAll<HTMLButtonElement>(".fold-help-btn")];
    expect(helps).toHaveLength(3);
    expect(host.querySelector(".ebr-privacy__help")).toBeNull();
    act(() => helps[2]!.click());
    expect(host.querySelectorAll(".ebr-privacy__help")).toHaveLength(1);
    expect(host.querySelector(".ebr-privacy__help")!.textContent).toMatch(/never stored/);
    expect(button("Set a master password").className).toContain("btn-top-neutral");
    act(() => button("‹ Back").click());
    expect(onBack).toHaveBeenCalled();
  });
});

describe("beside the address bar (owner's test, 2026-10-17: Set reloaded the page and saved nothing)", () => {
  it("Set and Enter run the master password and never submit the address bar's form", async () => {
    const a = api();
    const address = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    // The toolbar as BrowserScreen draws it: a row whose only form is the address.
    act(() =>
      root.render(
        <div className="ebr-bar">
          <form onSubmit={address}>
            <input aria-label="Address" />
          </form>
          <MasterPasswordSettings master={{ set: false, unlocked: false }} savedCount={1} api={a} after={() => {}} />
        </div>,
      ),
    );
    act(() => button("Set a master password").click());
    const [next, again] = [...host.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    act(() => {
      type(next!, "abcdefgh");
      type(again!, "abcdefgh");
    });
    act(() => button("Set").click());
    await flush();
    expect(a.masterSet).toHaveBeenCalledWith("abcdefgh", undefined);
    expect(address).not.toHaveBeenCalled();
  });

  it("the browser toolbar is no longer one form around its menus", () => {
    const src = readFileSync(path.join(process.cwd(), "src/client/BrowserScreen.tsx"), "utf8");
    expect(src).toContain('<div className="ebr-bar">');
    expect(src).not.toContain('<form className="ebr-bar"');
  });
});
