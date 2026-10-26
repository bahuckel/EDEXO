/*
  Key binds: Electron registers them globally (electron/keybinds.cjs); recording one pauses the others.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {

  /*
    Key binds (owner, 2026-10-02): Electron registers them globally (electron/keybinds.cjs). Recording
    a bind pauses the current ones, or a key that is already bound would never reach this page.
  */
  (function () {
    var ee = window.edexoElectron;
    var btn = document.getElementById("btnKeybinds");
    var modal = document.getElementById("keybindsModal");
    var rowsEl = document.getElementById("kbRows");
    var msgEl = document.getElementById("kbMsg");
    var closeBtn = document.getElementById("kbClose");
    if (!ee || typeof ee.getKeybinds !== "function" || !btn || !modal || !rowsEl) return;
    btn.hidden = false;
    var state = null;
    var recording = null;
    var STATUS = {
      ok: "",
      off: "Off.",
      taken: "Another program already uses this key, so it does nothing here. Pick another.",
      duplicate: "Already bound to another action above.",
      invalid: "Not a key this app can bind.",
      // Registered only while Elite is in front, so the key keeps working in every other program.
      standby: "Works while Elite is in front; other programs keep the key.",
    };
    function pretty(acc) {
      if (!acc) return "None";
      return acc.replace(/^CommandOrControl\+|^CmdOrCtrl\+/, "Ctrl+").replace(/Control/g, "Ctrl").replace(/\+/g, " + ");
    }
    var CODE = { Space: "Space", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Enter: "Return",
      NumpadEnter: "Return", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home",
      End: "End", PageUp: "PageUp", PageDown: "PageDown", NumpadDecimal: "numdec", NumpadAdd: "numadd",
      NumpadSubtract: "numsub", NumpadMultiply: "nummult", NumpadDivide: "numdiv", Minus: "-", Equal: "=",
      BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".",
      Slash: "/", Backquote: "`" };
    function keyOf(ev) {
      var c = ev.code || "";
      if (/^Key[A-Z]$/.test(c)) return c.slice(3);
      if (/^Digit[0-9]$/.test(c)) return c.slice(5);
      if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c;
      if (/^Numpad[0-9]$/.test(c)) return "num" + c.slice(6);
      return CODE[c] || null;
    }
    // Which sections are open, kept for the next time (a convenience: closed when it cannot be read).
    var OPEN_KEY = "edexo.kbGroupsOpen";
    function readOpen() {
      try {
        var v = JSON.parse(localStorage.getItem(OPEN_KEY) || "[]");
        return Array.isArray(v) ? v : [];
      } catch (e) {
        return [];
      }
    }
    function writeOpen(list) {
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(list));
      } catch (e) {
        /* not kept */
      }
    }
    function isWarn(code) {
      return code === "taken" || code === "duplicate" || code === "invalid";
    }
    /*
      One folding section per group (owner, 2026-10-06: "key-binds in launcher under collapsible
      categories"), in electron/keybinds.cjs GROUPS order. A closed section lists its keys; one with a
      key that does not work opens by itself.
    */
    function render() {
      rowsEl.innerHTML = "";
      var keys = Object.keys(state.actions);
      var groups = (state.groups || []).slice();
      keys.forEach(function (k) {
        var g = state.actions[k].group || "Other";
        if (groups.indexOf(g) < 0) groups.push(g);
      });
      var open = readOpen();
      groups.forEach(function (g) {
        var inGroup = keys.filter(function (k) { return (state.actions[k].group || "Other") === g; });
        if (!inGroup.length) return;
        var warn = inGroup.some(function (k) { return isWarn(state.status[k]); });
        var det = document.createElement("details");
        det.className = "kb-group";
        det.open = warn || open.indexOf(g) >= 0 || inGroup.indexOf(recording) >= 0;
        var sum = document.createElement("summary");
        var title = document.createElement("span");
        title.textContent = g;
        var list = document.createElement("span");
        list.className = "kb-group__keys" + (warn ? " kb-group__keys--warn" : "");
        list.textContent = inGroup.map(function (k) { return pretty(state.binds[k]); }).join(" · ");
        sum.appendChild(title);
        sum.appendChild(list);
        det.appendChild(sum);
        var grid = document.createElement("div");
        grid.className = "kb-rows";
        det.appendChild(grid);
        det.addEventListener("toggle", function () {
          var now = readOpen().filter(function (x) { return x !== g; });
          if (det.open) now.push(g);
          writeOpen(now);
        });
        rowsEl.appendChild(det);
        inGroup.forEach(function (k) { renderRow(grid, k); });
      });
    }
    function renderRow(grid, k) {
      {
        var a = state.actions[k];
        var label = document.createElement("span");
        label.textContent = a.label;
        var key = document.createElement("button");
        key.type = "button";
        key.className = "btn-mini kb-key";
        key.textContent = recording === k ? "Press the keys… (Esc cancels)" : pretty(state.binds[k]);
        key.setAttribute("aria-pressed", recording === k ? "true" : "false");
        key.title = "Click, then press the key or combination";
        key.addEventListener("click", function () { startRecording(k); });
        var def = document.createElement("button");
        def.type = "button";
        def.className = "btn-mini";
        def.textContent = "Default";
        def.title = "Back to " + pretty(a.default);
        def.addEventListener("click", function () { save(k, null); });
        var off = document.createElement("button");
        off.type = "button";
        off.className = "btn-mini";
        off.textContent = "Off";
        off.addEventListener("click", function () { save(k, ""); });
        var st = document.createElement("p");
        var code = state.status[k] || "off";
        st.className = "kb-status" + (isWarn(code) ? " kb-status--warn" : "");
        st.textContent = STATUS[code] || "";
        grid.appendChild(label);
        grid.appendChild(key);
        grid.appendChild(def);
        grid.appendChild(off);
        if (st.textContent) grid.appendChild(st);
      }
    }
    function load() {
      return ee.getKeybinds().then(function (r) { state = r; render(); }).catch(function () {});
    }
    function save(k, value) {
      var next = {};
      next[k] = value;
      return ee.setKeybinds(next).then(function (r) { state = r; recording = null; render(); }).catch(function () {});
    }
    function stopRecording() {
      if (!recording) return;
      recording = null;
      window.removeEventListener("keydown", onKey, true);
      void ee.pauseKeybinds({ on: false }).then(function (r) { if (r) state = r; render(); });
    }
    function startRecording(k) {
      if (recording) stopRecording();
      recording = k;
      if (msgEl) msgEl.textContent = "";
      void ee.pauseKeybinds({ on: true });
      window.addEventListener("keydown", onKey, true);
      render();
    }
    function onKey(ev) {
      if (!recording) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === "Escape" && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) {
        stopRecording();
        return;
      }
      if (/^(Control|Alt|Shift|Meta|OS)$/.test(ev.key)) return; // wait for the key itself
      var key = keyOf(ev);
      if (!key) {
        if (msgEl) msgEl.textContent = "That key cannot be bound; try another.";
        return;
      }
      var parts = [];
      if (ev.ctrlKey) parts.push("Control");
      if (ev.altKey) parts.push("Alt");
      if (ev.shiftKey) parts.push("Shift");
      if (ev.metaKey) parts.push("Super");
      parts.push(key);
      if (parts.length > 3) {
        if (msgEl) msgEl.textContent = "Up to three keys: two of Ctrl, Alt, Shift and one key.";
        return;
      }
      var k = recording;
      window.removeEventListener("keydown", onKey, true);
      save(k, parts.join("+"));
    }
    function open() {
      modal.classList.add("on");
      void load();
    }
    function close() {
      stopRecording();
      modal.classList.remove("on");
    }
    btn.addEventListener("click", open);
    if (closeBtn) closeBtn.addEventListener("click", close);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
  })();
}
