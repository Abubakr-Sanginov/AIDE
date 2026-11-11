// AIDE site — picks "full" or "lite" before first paint (loaded as a tiny blocking script in <head>).
// Lite = no WebGL, no smooth scroll, no scroll-scrubbed scenes, no heavy chunk download.
// Console: aideLite(true) / aideLite(false) / aideLite("auto") / aideLite("test") / aideLite()
(function () {
  "use strict";
  var KEY = "aide-lite";          // manual override: "1" lite, "0" full
  var AUTO = "aide-lite-auto";    // remembered result of the FPS probe
  var root = document.documentElement;

  function store(fn) { try { return fn(window.localStorage); } catch (e) { return null; } }

  function webglInfo() {
    try {
      var c = document.createElement("canvas");
      var gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return { ok: false, soft: false };
      var dbg = gl.getExtension("WEBGL_debug_renderer_info");
      var name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
      var lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      return { ok: true, soft: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) };
    } catch (e) { return { ok: false, soft: false }; }
  }

  function decide() {
    var q = /[?&]lite=(1|0)\b/.exec(window.location.search);
    if (q) return { lite: q[1] === "1", reason: "параметр ?lite=" + q[1], manual: true };
    var manual = store(function (s) { return s.getItem(KEY); });
    if (manual === "1") return { lite: true, reason: "включено вручную (aideLite)", manual: true };
    if (manual === "0") return { lite: false, reason: "выключено вручную (aideLite)", manual: true };

    var n = navigator, conn = n.connection || {};
    if (conn.saveData) return { lite: true, reason: "включена экономия трафика" };
    if (/^(slow-2g|2g)$/.test(conn.effectiveType || "")) return { lite: true, reason: "медленная сеть (" + conn.effectiveType + ")" };
    var mem = n.deviceMemory, cores = n.hardwareConcurrency;
    if (mem && mem <= 2) return { lite: true, reason: "мало памяти (" + mem + " ГБ)" };
    if (cores && cores <= 2) return { lite: true, reason: "мало ядер процессора (" + cores + ")" };
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (coarse && mem && mem <= 4 && cores && cores <= 4) return { lite: true, reason: "слабое мобильное устройство" };
    if (store(function (s) { return s.getItem(AUTO); }) === "1") return { lite: true, reason: "низкий FPS при прошлом визите" };
    var gl = webglInfo();
    if (!gl.ok) return { lite: true, reason: "нет WebGL" };
    if (gl.soft) return { lite: true, reason: "программная отрисовка WebGL" };
    return { lite: false, reason: "устройство справляется" };
  }

  var mode = decide();
  window.__aideMode = mode;
  if (mode.lite) root.classList.add("lite");

  /* Language. Every language has its own static page: / (ru), /en/, /de/ … built by scripts/build-pages.mjs.
     On a language page the language is fixed by the page. On the Russian root we send people to the page
     they chose before, or (first visit) to their browser language — but never crawlers, so the root stays indexable. */
  var LANGS = ["ru", "en", "de", "fr", "es", "pt", "it", "zh", "ja", "ko", "tg"];
  var pageLang = root.getAttribute("data-page-lang");
  var lang = pageLang && LANGS.indexOf(pageLang) >= 0 ? pageLang : "ru";
  function wanted() {
    var q = /[?&]lang=([a-z]{2})\b/.exec(window.location.search);
    if (q && LANGS.indexOf(q[1]) >= 0) return q[1];
    var saved = store(function (s) { return s.getItem("aide-lang"); });
    if (saved && LANGS.indexOf(saved) >= 0) return saved;
    if (navigator.webdriver || /bot|crawl|spider|slurp|lighthouse|preview/i.test(navigator.userAgent)) return "ru";
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i]).toLowerCase().split("-")[0];
      if (LANGS.indexOf(code) >= 0) return code;
    }
    return "en";
  }
  if (!pageLang) {
    var w = wanted();
    if (w !== "ru") {
      // Same page in the other language: /docs/ → /en/docs/. data-page-path is the page folder ("" for the home page).
      var page = (root.getAttribute("data-page-path") || "").replace(/[^a-z0-9/-]/gi, "");
      var up = new Array(page.split("/").filter(Boolean).length + 1).join("../");
      var here = window.location.href.split(/[?#]/)[0].replace(/index\.html$/, "");
      root.classList.add("i18n-pending");
      window.location.replace(new URL(up + w + "/" + page, here).href + window.location.hash);
    }
  }
  window.__aideLang = lang;

  window.aideLite = function (v) {
    if (v === undefined) {
      console.info("AIDE: сейчас " + (window.__aideMode.lite ? "лёгкий" : "полный") + " режим — " + window.__aideMode.reason + ".\n" +
        "  aideLite(true)   — включить лёгкий режим\n" +
        "  aideLite(false)  — принудительно полный режим\n" +
        "  aideLite(\"auto\") — снова определять автоматически\n" +
        "  aideLite(\"test\") — имитировать низкий FPS: переключиться в лёгкий режим на лету, без перезагрузки");
      return window.__aideMode.lite;
    }
    if (v === "test") {
      if (window.__aideMode.lite) { console.info("AIDE: уже лёгкий режим. Сначала aideLite(false)."); return true; }
      window.dispatchEvent(new CustomEvent("aide:slow", { detail: { fps: 12 } }));
      return "имитация низкого FPS";
    }
    if (v === "auto") store(function (s) { s.removeItem(KEY); s.removeItem(AUTO); });
    else store(function (s) { s.setItem(KEY, v ? "1" : "0"); });
    window.location.reload();
    return "перезагрузка…";
  };

  console.info("AIDE: " + (mode.lite ? "лёгкий" : "полный") + " режим (" + mode.reason + "). Наберите aideLite() для справки.");
})();
