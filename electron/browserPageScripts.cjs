"use strict";

/*
  The scripts the EDEXO browser runs in its own script worlds on browsed pages (browserTabs.cjs): the cosmetic pass,
  "Remember passwords" (capture and fill), and the Inara pop-up of Colonize. Plain strings with no Electron or main
  process state, kept apart from the main-process code (audit 2026-10-22) because they run in another security world:
  the page's DOM, never its scripts. browserTabs.cjs picks the world each one runs in and re-exports them.
*/

/**
 * Reads the page's class names, ids and links (for the lists' general hiding rules, which match on them), and
 * collapses the frames and images whose request was blocked, as uBlock does: the element goes, not only its
 * content (owner, 2026-10-13: "it only removes its contents").
 */
function cosmeticScript(blocked) {
  return `(() => {
  const blocked = new Set(${JSON.stringify(blocked)});
  let collapsed = 0;
  for (const el of document.querySelectorAll("iframe[src], img[src], embed[src], object[data], video[src]")) {
    const src = el.src || el.data;
    if (src && blocked.has(src)) {
      el.style.setProperty("display", "none", "important");
      collapsed++;
    }
  }
  const classes = new Set(), ids = new Set(), hrefs = new Set();
  const all = document.querySelectorAll("[class], [id], a[href]");
  for (let k = 0; k < all.length && k < 30000; k++) {
    const el = all[k];
    if (el.id) ids.add(el.id);
    if (el.classList) for (const c of el.classList) classes.add(c);
    if (el.tagName === "A") {
      const h = el.getAttribute("href");
      if (h) hrefs.add(h);
    }
  }
  return { classes: [...classes].slice(0, 8000), ids: [...ids].slice(0, 4000), hrefs: [...hrefs].slice(0, 4000), collapsed };
})()`;
}

/*
  "Remember passwords" (owner, 2026-10-16): run in the password world at each page's dom-ready while the option is
  on. It watches, in the capture phase, a form's submit and a click or Enter on a submit-like button in a form or
  beside a filled password field, then reports the password and the best username field (autocomplete="username" or
  "email", else the nearest text or email input before the password) as a console line that starts with the nonce
  the main process made for this page. The page's own scripts run in another world: they cannot read the nonce, so
  they cannot forge a report. It also says whether the page has a visible password field (the toolbar's key).
*/
function passwordCaptureScript(nonce) {
  return `(() => {
  if (globalThis.__pwWatch) return;
  globalThis.__pwWatch = true;
  const N = ${JSON.stringify(nonce)};
  const say = (m) => console.log(N + JSON.stringify(m));
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const isLoginField = (i) =>
    (i.getAttribute("autocomplete") || "").toLowerCase().split(" ").some((w) => w === "username" || w === "email");
  const pwFields = (root) => [...(root || document).querySelectorAll('input[type="password"]')].filter(shown);
  const filled = (root) => pwFields(root).find((x) => x.value);
  const userFor = (pw) => {
    const inputs = [...(pw.form || document).querySelectorAll("input")].filter(shown);
    const auto = inputs.find((i) => i !== pw && isLoginField(i));
    if (auto) return auto;
    for (let k = inputs.indexOf(pw) - 1; k >= 0; k--)
      if (["text", "email", "tel"].includes(inputs[k].type)) return inputs[k];
    return null;
  };
  let last = "";
  const report = (pw) => {
    if (!pw || !pw.value) return;
    const u = userFor(pw);
    const m = { t: "submit", origin: location.origin, username: u ? String(u.value).trim() : "", password: pw.value };
    const key = JSON.stringify([m.username, m.password]);
    if (key === last) return;
    last = key;
    say(m);
  };
  const formOf = (el) => (el && (el.form || (el.closest && el.closest("form")))) || null;
  const near = (el) => {
    const f = formOf(el);
    if (f) return filled(f);
    const all = pwFields().filter((x) => x.value);
    return all.length === 1 ? all[0] : null;
  };
  document.addEventListener("submit", (e) => report(filled(e.target)), true);
  document.addEventListener("click", (e) => {
    const b = e.target && e.target.closest && e.target.closest('button, input[type="submit"], input[type="image"], [role="button"]');
    if (!b || (b.tagName === "BUTTON" && b.type !== "submit" && !formOf(b) && !near(b))) return;
    report(near(b));
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target && e.target.tagName === "INPUT") report(near(e.target));
  }, true);
  let had = null, timer = 0;
  const look = () => {
    timer = 0;
    const has = pwFields().length > 0;
    if (has !== had) say({ t: "field", has: (had = has) });
  };
  look();
  new MutationObserver(() => { if (!timer) timer = setTimeout(look, 500); })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["type", "style", "class", "hidden"] });
})()`;
}

/**
 * Fills a saved login on the page it was saved for, as typed input, in the password world: the key button, or with
 * `auto` on its own when the page shows its password field (only empty fields, the keyboard focus left alone).
 */
function passwordFillScript(origin, username, password, auto = false) {
  return `(() => {
  if (location.origin !== ${JSON.stringify(origin)}) return false;
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const isLoginField = (i) =>
    (i.getAttribute("autocomplete") || "").toLowerCase().split(" ").some((w) => w === "username" || w === "email");
  const pw = [...document.querySelectorAll('input[type="password"]')].find(shown);
  if (!pw) return false;
  const inputs = [...(pw.form || document).querySelectorAll("input")].filter(shown);
  let user = inputs.find((i) => i !== pw && isLoginField(i));
  if (!user)
    for (let k = inputs.indexOf(pw) - 1; k >= 0 && !user; k--)
      if (["text", "email", "tel"].includes(inputs[k].type)) user = inputs[k];
  const AUTO = ${auto ? "true" : "false"};
  if (AUTO && pw.value) return false;
  /*
    Filled on its own only into fields a person can see (1.2.19 review): a third-party script on the login page could
    add a hidden password field (transparent, 1 px, off-screen) and read what the auto-fill puts there. The key
    button, a person's choice, still fills the field the page shows.
  */
  const plainlyVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 10) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (parseFloat(cs.opacity) < 0.1 || cs.visibility === "hidden" || cs.display === "none") return false;
    }
    return true;
  };
  if (AUTO && !plainlyVisible(pw)) return false;
  if (AUTO && user && !plainlyVisible(user)) user = null;
  const put = (el, v) => {
    if (AUTO && el.value) return;
    if (!AUTO) el.focus();
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const u = ${JSON.stringify(username)};
  if (user && u) put(user, u);
  put(pw, ${JSON.stringify(password)});
  return true;
})()`;
}

/**
 * What "EDEXO — Read" takes from the Inara page the commander has open, as it is on screen: the results table,
 * the near-star box and the commodity picked in the form. Nothing is fetched, clicked or changed.
 */
function inaraReadScript() {
  return `(() => {
  const table = document.querySelector("#DataTables_Table_0") ||
    document.querySelector("table.dataTable, table.tablesortercollapsed, table.tablesorter");
  const near = document.querySelector('input[name="ps1"]');
  const pick = document.querySelector('select[name="pa1[]"]');
  const commodities = pick ? Array.from(pick.selectedOptions || []).map((o) => (o.textContent || "").trim()).filter(Boolean) : [];
  return { table: table ? table.outerHTML : "", near: near ? String(near.value || "").trim() : "", commodities };
})()`;
}

/**
 * The pop-up on an Inara commodity search opened from EDEXO (owner, 2026-10-22: "put a pop-up in the page, EDEXO
 * themed, with Read and Cancel"). Drawn in its own shadow root, so the page's styles neither reach nor read it; its
 * buttons report as a console line that starts with the nonce the main process made for this page (only this world
 * knows it). `__edexoInaraSay(text, ok)` puts the result in it.
 */
function inaraOfferScript(nonce) {
  return `(() => {
  const N = ${JSON.stringify(nonce)};
  const say = (m) => console.log(N + JSON.stringify(m));
  document.getElementById("edexo-inara-offer")?.remove();
  const host = document.createElement("div");
  host.id = "edexo-inara-offer";
  host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = \`<style>
    .box{width:340px;padding:14px 16px;background:#0e0b0a;color:#ffe6cf;border:1px solid #ff8a1f;
      font:14px/1.4 Bahnschrift,"Segoe UI",system-ui,sans-serif;box-shadow:0 18px 48px rgba(0,0,0,.7);
      clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))}
    .h{font-size:12px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#ff8a1f;margin-bottom:8px;
      padding-bottom:6px;background:linear-gradient(90deg,#ff8a1f 0 34%,rgba(255,138,31,.22) 70%,transparent) bottom left/100% 1px no-repeat}
    .h b{color:#ffb060}
    .t{margin:0 0 12px}.t.ok{color:#9fe4ff}.t.bad{color:#ff9c88}
    .r{display:flex;gap:8px;justify-content:flex-end}
    button{font:700 12px Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;
      padding:8px 14px;border:1px solid #ffb060;color:#ffe6cf;background:rgba(14,12,10,.94);
      clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}
    button.go{background:linear-gradient(180deg,#ffb060,#ff8a1f 60%,#f2760f);color:#07060a}
    button:disabled{opacity:.5;cursor:default}
  </style>
  <div class="box" role="dialog" aria-label="EDEXO Colonize">
    <div class="h">EDEXO <b>Colonize</b></div>
    <p class="t">Read the sellers this search shows into Colonize? Only this page is read.</p>
    <div class="r"><button type="button" class="no">Cancel</button><button type="button" class="go">EDEXO — Read</button></div>
  </div>\`;
  const text = root.querySelector(".t");
  const go = root.querySelector(".go");
  const no = root.querySelector(".no");
  go.addEventListener("click", () => {
    go.disabled = true;
    text.className = "t";
    text.textContent = "Reading…";
    say({ t: "read" });
  });
  no.addEventListener("click", () => {
    host.remove();
    say({ t: "cancel" });
  });
  globalThis.__edexoInaraSay = (msg, ok) => {
    text.className = ok ? "t ok" : "t bad";
    text.textContent = String(msg);
    if (ok) {
      go.remove();
      no.textContent = "Close";
    } else go.disabled = false;
  };
  (document.body || document.documentElement).appendChild(host);
})()`;
}

module.exports = {
  cosmeticScript,
  passwordCaptureScript,
  passwordFillScript,
  inaraReadScript,
  inaraOfferScript,
};
