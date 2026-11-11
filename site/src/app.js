// AIDE site — light core. Always runs: text splitting, mode tabs, copy buttons, counters.
// Full mode lazily imports ./full.js (three.js + GSAP + Lenis); lite mode never downloads it.
// Static content only: nothing from the network or the URL is ever rendered as HTML.

import { initLive } from "./live.js";

if ("scrollRestoration" in history) history.scrollRestoration = "manual";
if (!location.hash) window.scrollTo(0, 0);

const root = document.documentElement;
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const mode = window.__aideMode || { lite: false, reason: "" };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ───────────── i18n ─────────────
   Each language is a static page built by scripts/build-pages.mjs, so the HTML is already translated.
   The script only needs its own few strings, which the build embeds as <script type="application/json" id="i18n-js">. */
const LANGS = ["ru", "en", "de", "fr", "es", "pt", "it", "zh", "ja", "ko", "tg"];
const lang = LANGS.includes(window.__aideLang) ? window.__aideLang : "ru";
const JS_RU = {
  "js.copy": "Копировать", "js.copied": "Скопировано", "js.copyFail": "Не вышло", "js.copyOk": "Команда скопирована",
  "js.copyErr": "Не удалось скопировать", "js.liteOn": "Лёгкая версия: вкл", "js.liteOff": "Лёгкая версия: выкл",
  "js.toast": "Включена лёгкая версия для плавности", "js.lang": "Язык",
};
let dict = JS_RU;
try {
  const el = document.getElementById("i18n-js");
  if (el) dict = Object.assign({}, JS_RU, JSON.parse(el.textContent || "{}"));
} catch (e) { /* malformed block: keep Russian strings */ }
const t = (k) => (typeof dict[k] === "string" ? dict[k] : JS_RU[k] || k);
const NUM_LOCALE = { ru: "ru-RU", tg: "ru-RU", en: "en-US", de: "de-DE", fr: "fr-FR", es: "es-ES", pt: "pt-BR", it: "it-IT", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR" };

/* Language menu in the nav */
const langBtn = $(".lang__btn"), langMenu = $("#lang-menu");
if (langBtn && langMenu) {
  const code = $(".lang__code", langBtn);
  if (code) code.textContent = lang.toUpperCase();
  const items = $$("[data-lang]", langMenu);
  items.forEach((b) => { if (b.getAttribute("data-lang") === lang) b.setAttribute("aria-current", "true"); });
  const open = (v, focus) => {
    langMenu.hidden = !v;
    langBtn.setAttribute("aria-expanded", String(v));
    if (v && focus) (items.find((b) => b.hasAttribute("aria-current")) || items[0]).focus();
  };
  langBtn.addEventListener("click", () => open(langMenu.hidden, true));
  langMenu.addEventListener("keydown", (e) => {
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === "Escape") { open(false); langBtn.focus(); }
  });
  document.addEventListener("click", (e) => { if (!langMenu.hidden && !e.target.closest(".lang")) open(false); });
  // Items are real links to the language pages; we only remember the choice for the next visit to the root.
  items.forEach((a) => a.addEventListener("click", () => {
    const next = a.getAttribute("data-lang");
    if (LANGS.includes(next)) { try { localStorage.setItem("aide-lang", next); } catch (e) { /* storage unavailable */ } }
  }));
}

/* ───────────── Text splitting (DOM only, no innerHTML) ───────────── */
function splitLines(el) {
  const groups = [[]];
  Array.from(el.childNodes).forEach((n) => {
    if (n.nodeName === "BR") groups.push([]);
    else groups[groups.length - 1].push(n);
  });
  el.textContent = "";
  groups.forEach((nodes) => {
    const line = document.createElement("span");
    line.className = "line";
    const inner = document.createElement("span");
    nodes.forEach((n) => inner.appendChild(n));
    line.appendChild(inner);
    el.appendChild(line);
  });
}
function splitWords(el) {
  const text = el.textContent.trim().replace(/\s+/g, " ");
  el.textContent = "";
  text.split(" ").forEach((w, i) => {
    if (i) el.appendChild(document.createTextNode(" "));
    const s = document.createElement("span");
    s.className = "word";
    s.textContent = w;
    el.appendChild(s);
  });
}
$$("[data-lines]").forEach(splitLines);
$$("[data-words]").forEach(splitWords);

/* ───────────── Mode tabs in the app mock ───────────── */
const tabs = $$('.modes [role="tab"]');
const pill = $(".modes__pill");
const placePill = (tab) => {
  if (!tab || !pill) return; pill.style.width = tab.offsetWidth + "px"; pill.style.transform = "translateX(" + tab.offsetLeft + "px)"; };
const currentTab = () => tabs.find((t) => t.getAttribute("aria-selected") === "true");
function selectTab(tab, focus) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(t.getAttribute("aria-controls"));
    panel.hidden = !on;
    panel.classList.toggle("is-on", on);
  });
  placePill(tab);
  if (focus) tab.focus();
}
tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => selectTab(tab, false));
  tab.addEventListener("keydown", (e) => {
    const map = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 };
    if (e.key in map) { e.preventDefault(); selectTab(tabs[map[e.key]], true); }
  });
});
placePill(currentTab());
window.addEventListener("resize", () => placePill(currentTab()));
if (document.fonts) document.fonts.ready.then(() => placePill(currentTab()));

/* ───────────── Copy buttons ───────────── */
const status = $("#copy-status");
$$(".copy").forEach((btn) => {
  btn.addEventListener("click", () => {
    const text = btn.getAttribute("data-copy") || "";
    const done = (ok) => {
      btn.textContent = ok ? t("js.copied") : t("js.copyFail");
      btn.classList.toggle("is-done", ok);
      status.textContent = ok ? t("js.copyOk") : t("js.copyErr");
      setTimeout(() => { btn.textContent = t("js.copy"); btn.classList.remove("is-done"); }, 1800);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    else done(false);
  });
});

/* ───────────── Counters (IntersectionObserver + rAF, no libraries) ───────────── */
const fmt = (n) => Math.round(n).toLocaleString(NUM_LOCALE[lang] || "ru-RU");
const counterIO = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    counterIO.unobserve(en.target);
    const el = en.target, end = Number(el.getAttribute("data-count"));
    const dur = end > 100 ? 1600 : 1100, t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(end * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}, { rootMargin: "0px 0px -10% 0px" }) : null;
$$("[data-count]").forEach((el) => {
  if (!Number.isFinite(Number(el.getAttribute("data-count")))) return;
  if (counterIO && !reduce) { el.textContent = fmt(0); counterIO.observe(el); }
});

/* ───────────── Footer mode switch ───────────── */
const modeBtn = $("#mode-toggle");
function syncModeBtn() {
  if (!modeBtn) return;
  const lite = root.classList.contains("lite");
  modeBtn.textContent = lite ? t("js.liteOn") : t("js.liteOff");
  modeBtn.setAttribute("aria-pressed", String(lite));
}
if (modeBtn) {
  syncModeBtn();
  modeBtn.addEventListener("click", () => { if (window.aideLite) window.aideLite(!root.classList.contains("lite")); });
}

/* ───────────── Lite mode: plain scroll, cheap CSS reveals ───────────── */
let liteStarted = false;
function startLite() {
  if (liteStarted) return;
  liteStarted = true;
  root.classList.add("lite");
  syncModeBtn();

  const bar = $(".progress span");
  let queued = false;
  const update = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (bar) bar.style.transform = "scaleY(" + (max > 0 ? window.scrollY / max : 0) + ")";
  };
  window.addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  update();

  if (reduce || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
  }, { rootMargin: "0px 0px -8% 0px" });
  $$(".kicker, .display, .chapter__text, .stats, .modes-list, .chapter__ui, .window, .mate, .review, .num, .spec, .cmd").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return; // already on screen: leave visible
    el.classList.add("rv");
    io.observe(el);
  });
}

function toast(text) {
  const t = document.createElement("p");
  t.className = "toast mono";
  t.setAttribute("role", "status");
  t.textContent = text;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 4200);
}

initLive();

/* ───────────── Boot ───────────── */
const hasScene = !!$("#gl"); // docs and changelog pages: no 3D, no scroll scenes — plain static pages
if (!hasScene) {
  // nothing to start
} else if (mode.lite) {
  startLite();
} else {
  import("./full.js").then(({ start }) => {
    let teardown = null;
    const onSlow = (fps, simulated) => {
        if (liteStarted) return;
        // The 3D is too heavy here: drop to lite in place and remember it for next visits.
        if (!simulated) { try { localStorage.setItem("aide-lite-auto", "1"); } catch (e) { /* storage unavailable */ } }
        const anchor = $$("main > section, main > div > section").find((s) => s.getBoundingClientRect().bottom > window.innerHeight * 0.3);
        if (teardown) teardown();
        window.__aideMode = { lite: true, reason: (simulated ? "имитация: " : "") + "низкий FPS (" + fps + " кадр/с)" };
        startLite();
        if (anchor) window.scrollTo(0, anchor.offsetTop);
        console.info("AIDE: включён лёгкий режим — " + window.__aideMode.reason + ". aideLite(false) — вернуть полный.");
        toast(t("js.toast"));
    };
    teardown = start({ reduce, probe: !mode.manual, onSlow: (fps) => onSlow(fps, false) });
    window.addEventListener("aide:slow", (e) => onSlow((e.detail && e.detail.fps) || 12, true));
  }).catch(() => startLite());
}
