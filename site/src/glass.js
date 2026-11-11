// Liquid glass for full mode.
// Every .glass element gets its own SVG lens filter sized to it: a displacement map that bends the
// backdrop near the rounded edges (like a thick convex bezel), with a slight per-channel split
// (chromatic aberration). Used as `backdrop-filter: url(#…)`, which only Chromium renders, so other
// browsers keep the CSS frosted-glass fallback. A specular sheen follows the pointer everywhere.

const NS = "http://www.w3.org/2000/svg";

function isChromium() {
  const brands = navigator.userAgentData && navigator.userAgentData.brands;
  if (brands) return brands.some((b) => /Chromium/i.test(b.brand));
  return /Chrome\//.test(navigator.userAgent); // Chrome, Edge, Opera, Electron
}

/** Displacement map for a rounded rect: R/G = x/y offset (128 = none), strongest at the rim. */
function lensMap(w, h, radius, bezel) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const hw = w / 2, hh = h / 2, r = Math.min(radius, hw, hh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw, py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const depth = -(Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r); // >0 inside
      let dx = 0, dy = 0;
      if (depth > -1 && depth < bezel) {
        const t = 1 - Math.max(depth, 0) / bezel;
        const mag = t * t * (3 - 2 * t); // smooth, strongest at the edge
        let nx, ny;
        if (qx > 0 && qy > 0) { const L = Math.hypot(ox, oy) || 1; nx = (ox / L) * Math.sign(px); ny = (oy / L) * Math.sign(py); }
        else if (qx > qy) { nx = Math.sign(px); ny = 0; }
        else { nx = 0; ny = Math.sign(py); }
        dx = -nx * mag; dy = -ny * mag; // sample from further inside → the rim magnifies
      }
      const i = (y * w + x) * 4;
      d[i] = 128 + dx * 127; d[i + 1] = 128 + dy * 127; d[i + 2] = 128; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

function el(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v)));
  if (parent) parent.appendChild(n);
  return n;
}

function buildFilter(defs, id, w, h, radius) {
  const bezel = Math.max(10, Math.min(28, Math.min(w, h) * 0.32));
  const scale = Math.round(bezel * 1.7);
  const f = el("filter", { id, x: 0, y: 0, width: w, height: h, filterUnits: "userSpaceOnUse", primitiveUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" }, defs);
  el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 3, result: "blur" }, f);
  el("feImage", { href: lensMap(w, h, radius, bezel), x: 0, y: 0, width: w, height: h, preserveAspectRatio: "none", result: "map" }, f);
  // Three slightly different strengths per channel → a thin rainbow fringe at the rim.
  [["r", 1, "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"], ["g", 0.93, "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"], ["b", 0.86, "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"]].forEach(([ch, k, m]) => {
    el("feDisplacementMap", { in: "blur", in2: "map", scale: Math.round(scale * k), xChannelSelector: "R", yChannelSelector: "G", result: "d" + ch }, f);
    el("feColorMatrix", { in: "d" + ch, type: "matrix", values: m, result: ch }, f);
  });
  el("feBlend", { in: "r", in2: "g", mode: "screen", result: "rg" }, f);
  el("feBlend", { in: "rg", in2: "b", mode: "screen", result: "rgb" }, f);
  el("feColorMatrix", { in: "rgb", type: "saturate", values: 1.6 }, f);
  return f;
}

/** @returns {() => void} cleanup */
export function setupGlass({ reduce }) {
  const items = Array.from(document.querySelectorAll(".glass"));
  if (!items.length) return () => {};
  const root = document.documentElement;
  const refract = isChromium() && typeof ResizeObserver !== "undefined";
  const cleanups = [];

  if (refract) {
    root.classList.add("glass-refract");
    const svg = el("svg", { class: "lens-defs", width: 0, height: 0, "aria-hidden": "true", focusable: "false" });
    const defs = el("defs", {}, svg);
    document.body.appendChild(svg);
    const filters = new Map();
    let uid = 0;

    const update = (node) => {
      const w = Math.round(node.offsetWidth), h = Math.round(node.offsetHeight);
      if (w < 8 || h < 8) return;
      const key = w + "x" + h;
      if (node.dataset.lensSize === key) return;
      node.dataset.lensSize = key;
      const old = filters.get(node);
      if (old) old.remove();
      const radius = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0;
      const id = "lens-" + (++uid);
      filters.set(node, buildFilter(defs, id, w, h, radius));
      node.style.setProperty("--lens", "url(#" + id + ")");
      node.setAttribute("data-lens", "");
    };
    const ro = new ResizeObserver((entries) => entries.forEach((e) => update(e.target)));
    items.forEach((n) => { update(n); ro.observe(n); });

    cleanups.push(() => {
      ro.disconnect();
      svg.remove();
      root.classList.remove("glass-refract");
      items.forEach((n) => { n.removeAttribute("data-lens"); delete n.dataset.lensSize; n.style.removeProperty("--lens"); });
    });
  }

  // Specular sheen that tracks the pointer (skipped with reduced motion).
  if (!reduce) {
    let queued = false, mx = 0, my = 0;
    const paint = () => {
      queued = false;
      const vh = window.innerHeight;
      items.forEach((n) => {
        const r = n.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        n.style.setProperty("--gx", (((mx - r.left) / r.width) * 100).toFixed(1) + "%");
        n.style.setProperty("--gy", (((my - r.top) / r.height) * 100).toFixed(1) + "%");
      });
    };
    const move = (e) => { mx = e.clientX; my = e.clientY; if (!queued) { queued = true; requestAnimationFrame(paint); } };
    window.addEventListener("pointermove", move, { passive: true });
    cleanups.push(() => {
      window.removeEventListener("pointermove", move);
      items.forEach((n) => { n.style.removeProperty("--gx"); n.style.removeProperty("--gy"); });
    });
  }

  return () => cleanups.forEach((f) => f());
}
