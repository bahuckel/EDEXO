// @vitest-environment jsdom
/**
 * Review 2026-11-10 F6: the phone reaches the app over plain HTTP, where browsers give no Clipboard API, and every Copy
 * button there did nothing. copyText falls back to selecting a hidden text field and copying it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../src/client/copyText";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("uses the Clipboard API where the page is secure", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyText("Sol");
    expect(writeText).toHaveBeenCalledWith("Sol");
  });

  it("over plain HTTP, copies a selected hidden field and leaves nothing behind", async () => {
    vi.stubGlobal("isSecureContext", false);
    let selected = "";
    const exec = vi.fn(() => {
      selected = (document.activeElement as HTMLTextAreaElement | null)?.value ?? document.querySelector("textarea")?.value ?? "";
      return true;
    });
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    await copyText("Colonia");
    expect(exec).toHaveBeenCalledWith("copy");
    expect(selected).toBe("Colonia");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("says so when the browser refuses", async () => {
    vi.stubGlobal("isSecureContext", false);
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    await expect(copyText("x")).rejects.toThrow();
  });
});
