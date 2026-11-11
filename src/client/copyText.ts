/**
 * Text onto the clipboard, on this PC and on the phone. The phone reaches the app over plain HTTP, where browsers give
 * no Clipboard API (secure contexts only), so every Copy button there did nothing and said nothing (review 2026-11-10
 * F6). There a hidden text field is selected and copied the old way, which needs the click that called this.
 */
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.top = "0";
  field.style.opacity = "0";
  document.body.appendChild(field);
  try {
    field.select();
    // The only copy plain HTTP allows.
    if (!document.execCommand("copy")) throw new Error("The browser refused to copy.");
  } finally {
    field.remove();
  }
}
