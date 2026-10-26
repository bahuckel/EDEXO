/*
  What's new: after an update the notes of every release since the version last seen, drawn from a small part of Markdown into elements, never as HTML.
  Split out of public/launcher.js (discuss item 19, 1.3.1).
*/
import { apiUrl } from "./network.js";

/*
  What's new (combined plan, Phase 5): after an update the notes of every release since the
  version last seen, once; closing them marks this version seen (server/whatsNew.ts). The notes
  are GitHub's release notes, drawn here from a small part of Markdown — headings, lists, bold,
  code and links — into elements, never as HTML.
*/
var whatsNewModal = document.getElementById("whatsNewModal");
var whatsNewBody = document.getElementById("whatsNewBody");
var whatsNewTitle = document.getElementById("whatsNewTitle");
var btnWhatsNew = document.getElementById("btnWhatsNew");
var whatsNewPending = false;
var whatsNewPageUrl = "https://github.com/bahuckel/EDEXO/releases";

function notesInline(parent, text) {
  var re = /!\[[^\]]*\]\([^)]*\)|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  var last = 0;
  var m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    last = re.lastIndex;
    var el = null;
    if (m[2]) {
      el = document.createElement("a");
      el.href = m[2];
      el.target = "_blank";
      el.rel = "noopener";
      el.textContent = m[1];
    } else if (m[3]) {
      el = document.createElement("strong");
      el.textContent = m[3];
    } else if (m[4]) {
      el = document.createElement("code");
      el.textContent = m[4];
    }
    if (el) parent.appendChild(el);
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function renderNotes(md, into) {
  var lists = [];
  var para = null;
  var lastLi = null;
  function closeLists() {
    lists = [];
    lastLi = null;
  }
  md.replace(/\r\n/g, "\n").split("\n").forEach(function (line) {
    if (!line.trim()) {
      para = null;
      return;
    }
    var h = /^#{2,4}\s+(.*)$/.exec(line);
    if (h) {
      para = null;
      closeLists();
      var hd = document.createElement("h4");
      notesInline(hd, h[1].replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+[—-]\s*$/, ""));
      into.appendChild(hd);
      return;
    }
    var li = /^(\s*)(\d+\.|[-*])\s+(.*)$/.exec(line);
    if (li) {
      para = null;
      var indent = li[1].length;
      var ordered = /\d/.test(li[2]);
      while (lists.length && lists[lists.length - 1].indent > indent) lists.pop();
      var top = lists[lists.length - 1];
      if (!top || top.indent < indent) {
        var list = document.createElement(ordered ? "ol" : "ul");
        if (top && lastLi) lastLi.appendChild(list);
        else into.appendChild(list);
        lists.push({ indent: indent, el: list });
        top = lists[lists.length - 1];
      }
      lastLi = document.createElement("li");
      notesInline(lastLi, li[3]);
      top.el.appendChild(lastLi);
      return;
    }
    if (lastLi && /^\s/.test(line)) {
      notesInline(lastLi, " " + line.trim());
      return;
    }
    closeLists();
    if (!para) {
      para = document.createElement("p");
      into.appendChild(para);
    } else {
      para.appendChild(document.createTextNode(" "));
    }
    notesInline(para, line.trim());
  });
}

function showWhatsNew(info) {
  if (!whatsNewModal || !whatsNewBody) return;
  whatsNewPending = Boolean(info.pending);
  whatsNewBody.innerHTML = "";
  var rel = info.releases || [];
  whatsNewTitle.textContent = (info.pending ? "Updated to v" : "What's new in v") + info.current;
  whatsNewPageUrl = rel.length ? rel[0].pageUrl : "https://github.com/bahuckel/EDEXO/releases";
  if (!rel.length) {
    var p = document.createElement("p");
    p.textContent =
      "The notes for this version could not be read from GitHub" +
      (info.error ? " (" + info.error + ")" : "") +
      ". They are on the release page.";
    whatsNewBody.appendChild(p);
  }
  rel.forEach(function (r) {
    var v = document.createElement("div");
    v.className = "wn-version";
    v.textContent = "v" + r.version + (r.publishedAt ? " · " + String(r.publishedAt).slice(0, 10) : "");
    whatsNewBody.appendChild(v);
    renderNotes(r.notes, whatsNewBody);
  });
  whatsNewBody.scrollTop = 0;
  whatsNewModal.classList.add("on");
}

function closeWhatsNew() {
  if (whatsNewModal) whatsNewModal.classList.remove("on");
  if (!whatsNewPending) return;
  whatsNewPending = false;
  fetch(apiUrl("/api/app/whats-new/seen"), { method: "POST" }).catch(function () {});
}

function fetchWhatsNew(any) {
  return fetch(apiUrl("/api/app/whats-new" + (any ? "?any=1" : "")), { cache: "no-store" }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
}

/* At start: once the server answers, and after any other card (first run, Linux setup) is closed. */
function loadWhatsNew(tries) {
  fetchWhatsNew(false)
    .then(function (info) {
      if (btnWhatsNew) btnWhatsNew.hidden = false;
      if (!info.pending) return;
      (function waitForOtherCards() {
        if (document.querySelector(".modal-bg.on")) setTimeout(waitForOtherCards, 1500);
        else showWhatsNew(info);
      })();
    })
    .catch(function () {
      if (tries > 0) setTimeout(function () { loadWhatsNew(tries - 1); }, 3000);
    });
}
var whatsNewClose = document.getElementById("whatsNewClose");
var whatsNewPage = document.getElementById("whatsNewPage");

/** What ran when the page loaded, in the order it ran (main.js calls each module's in the file's old order). */
export function start() {
  loadWhatsNew(20);

  if (btnWhatsNew) btnWhatsNew.addEventListener("click", function () {
    fetchWhatsNew(true).then(showWhatsNew).catch(function () {});
  });
  if (whatsNewClose) whatsNewClose.addEventListener("click", closeWhatsNew);
  if (whatsNewPage) whatsNewPage.addEventListener("click", function () { window.open(whatsNewPageUrl, "_blank", "noopener"); });
  if (whatsNewModal) whatsNewModal.addEventListener("click", function (e) { if (e.target === whatsNewModal) closeWhatsNew(); });
}
