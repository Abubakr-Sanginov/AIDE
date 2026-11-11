// Live demos on the page: an agent run replay, a code search over a tiny index, a phone/desktop switcher.
// All text comes from the (already translated) markup; the script only toggles classes and attributes.
// Nothing from the network or the URL is read or rendered.

const q1 = (s, r = document) => r.querySelector(s);
const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function agent(card) {
  const me = q1(".msg--me", card), steps = qa(".step", card), fin = q1(".demo__final", card);
  const btn = q1("[data-run]", card), againEl = q1("[data-again]", card);
  const again = againEl ? againEl.textContent : btn.textContent;
  let token = 0;
  const wait = (ms, mine) => new Promise((res) => setTimeout(() => res(mine === token), reduce ? 0 : ms));
  const reset = () => [me, fin, ...steps].forEach((el) => el.classList.remove("is-on", "run", "done"));
  btn.addEventListener("click", async () => {
    const mine = ++token;
    reset();
    btn.disabled = true;
    me.classList.add("is-on");
    if (!(await wait(500, mine))) return;
    for (const s of steps) {
      s.classList.add("is-on", "run");
      if (!(await wait(750, mine))) return;
      s.classList.replace("run", "done");
      if (!(await wait(180, mine))) return;
    }
    fin.classList.add("is-on");
    btn.textContent = again;
    btn.disabled = false;
  });
}

// Words of a query: lower case, split on non-letters and on camelCase humps.
function words(text) {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-zа-яё0-9]+/i).filter(Boolean);
}

function search(card) {
  const input = q1(".demo__input", card), list = q1(".hits", card), none = q1(".hits__none", card);
  const hits = qa("[data-hit]", list).map((el, i) => ({ el, i, words: words(el.getAttribute("data-w") + " " + q1("b", el).textContent) }));
  const run = () => {
    const q = words(input.value);
    let shown = 0;
    const scored = hits.map((h) => {
      if (!q.length) return { ...h, score: 0, on: true };
      const hit = q.filter((t) => h.words.some((w) => w === t || (t.length > 2 && w.startsWith(t)))).length;
      return { ...h, score: hit / q.length, on: hit > 0 };
    });
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    for (const h of scored) {
      h.el.hidden = !h.on;
      h.el.style.setProperty("--score", String(h.score));
      list.appendChild(h.el);
      if (h.on) shown++;
    }
    none.hidden = shown > 0;
  };
  input.addEventListener("input", run);
  qa(".demo__chips button", card).forEach((b) => b.addEventListener("click", () => { input.value = b.getAttribute("data-q") || ""; run(); }));
  run();
}

function device(card) {
  const stage = q1(".stage", card), page = q1(".stage__page", card), size = q1("[data-size]", card);
  const tabs = qa(".demo__tabs button", card);
  let w = 390, h = 844;
  const fit = () => {
    const availW = stage.clientWidth - 24, availH = stage.clientHeight - 24;
    if (availW <= 0 || availH <= 0) return;
    const s = Math.min(1, availW / w);
    page.style.width = w + "px";
    page.style.height = availH / s + "px"; // a peek at the top of the page at this scale
    page.style.transform = "translateX(-50%) scale(" + s + ")";
  };
  tabs.forEach((b) => b.addEventListener("click", () => {
    w = Number(b.getAttribute("data-w")) || w;
    h = Number(b.getAttribute("data-h")) || h;
    tabs.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    if (size) size.textContent = w + "×" + h;
    fit();
  }));
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(stage); else window.addEventListener("resize", fit);
  fit();
}

export function initLive() {
  const root = document.getElementById("live");
  if (!root) return;
  root.classList.add("live--js");
  const card = (n) => q1(`[data-demo="${n}"]`, root);
  if (card("agent")) agent(card("agent"));
  if (card("search")) search(card("search"));
  if (card("device")) device(card("device"));
}
