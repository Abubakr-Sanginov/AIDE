// AIDE site — the heavy part: 3D mark (three.js), scroll scenes (GSAP ScrollTrigger), smooth scroll (Lenis).
// Loaded only in full mode. start() returns a teardown so the page can drop to lite mode at runtime.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { setupGlass } from "./glass.js";

gsap.registerPlugin(ScrollTrigger);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const TAU = Math.PI * 2;

function px(sx, sy) {
  const k = 3.75 / 480;
  return new THREE.Vector2((sx - 256) * k, -(sy - 256) * k);
}

function buildMark() {
  const group = new THREE.Group();

  // Tile: rounded square, extruded with a soft bevel.
  const w = 3.75, r = 0.9, h = w / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-h + r, -h);
  shape.lineTo(h - r, -h);
  shape.quadraticCurveTo(h, -h, h, -h + r);
  shape.lineTo(h, h - r);
  shape.quadraticCurveTo(h, h, h - r, h);
  shape.lineTo(-h + r, h);
  shape.quadraticCurveTo(-h, h, -h, h - r);
  shape.lineTo(-h, -h + r);
  shape.quadraticCurveTo(-h, -h, -h + r, -h);
  const tileGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.34, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.08, bevelSegments: 8, curveSegments: 28,
  });
  tileGeo.center();
  group.add(new THREE.Mesh(
    tileGeo,
    new THREE.MeshPhysicalMaterial({ color: 0x16120f, roughness: 0.38, metalness: 0.25, envMapIntensity: 0.75, clearcoat: 1, clearcoatRoughness: 0.25, sheen: 0.12, sheenColor: new THREE.Color(0x5eead4) })
  ));
  const face = 0.26;

  // The "A": two rounded tubes meeting at the top, peach → teal like the logo gradient.
  const peach = new THREE.Color(0xfde3c8), mid = new THREE.Color(0xfbc89d), teal = new THREE.Color(0x8ff0de);
  const legMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0xf08a4b, emissiveIntensity: 0.06 });
  [[142, 388, 256, 128], [256, 128, 370, 388]].forEach(([x1, y1, x2, y2]) => {
    const a = px(x1, y1), b = px(x2, y2);
    const g = new THREE.CapsuleGeometry(0.18, a.distanceTo(b), 10, 24);
    g.applyMatrix4(new THREE.Matrix4()
      .makeTranslation((a.x + b.x) / 2, (a.y + b.y) / 2, face + 0.06)
      .multiply(new THREE.Matrix4().makeRotationZ(Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2)));
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp((pos.getX(i) - pos.getY(i) + 1.6) / 3.6, 0, 1);
      if (t < 0.55) c.copy(peach).lerp(mid, t / 0.55); else c.copy(mid).lerp(teal, (t - 0.55) / 0.45);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    group.add(new THREE.Mesh(g, legMat));
  });

  // Spark in place of the crossbar.
  const sp = new THREE.Shape();
  const p0 = px(256, 250); sp.moveTo(p0.x, p0.y);
  const curve = (c1, c2, e) => { const a = px(...c1), b = px(...c2), d = px(...e); sp.bezierCurveTo(a.x, a.y, b.x, b.y, d.x, d.y); };
  curve([261, 283], [273, 295], [306, 300]);
  curve([273, 305], [261, 317], [256, 350]);
  curve([251, 317], [239, 305], [206, 300]);
  curve([239, 295], [251, 283], [256, 250]);
  const spark = new THREE.Mesh(
    new THREE.ExtrudeGeometry(sp, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.025, bevelSegments: 4, curveSegments: 24 }),
    new THREE.MeshPhysicalMaterial({ color: 0xeafffb, emissive: 0x5eead4, emissiveIntensity: 0.85, roughness: 0.3, clearcoat: 1 })
  );
  spark.position.z = face + 0.02;
  group.add(spark);
  group.userData.spark = spark;

  const dot = (sx, sy, rr, color, emi) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(rr, 24, 16), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emi, roughness: 0.3 }));
    const v = px(sx, sy); m.position.set(v.x, v.y, face + 0.05);
    group.add(m);
  };
  dot(338, 214, 0.075, 0x9ff5e6, 0.8);
  dot(176, 236, 0.045, 0xfde3c8, 0.5);
  return group;
}

/**
 * @param {{ reduce: boolean, probe: boolean, onSlow: () => void }} opts
 * @returns {() => void} teardown
 */
export function start({ reduce, probe, onSlow }) {
  const canvas = $("#gl");
  const S = { xf: 0, y: 0, rx: 0.5, ry: -2.4, rz: 0, s: 0.55, o: 0 };
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const cleanups = [];
  const on = (target, type, fn, opt) => { target.addEventListener(type, fn, opt); cleanups.push(() => target.removeEventListener(type, fn, opt)); };
  let renderer = null, scene, camera, mark, halfW = 3;

  /* 3D setup */
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    renderer = null;
  }
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 12);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 4, 6); scene.add(key);
    const warm = new THREE.PointLight(0xff8a4a, 60, 30, 2); warm.position.set(-5, -4, 3); scene.add(warm);
    const cool = new THREE.PointLight(0x5eead4, 30, 30, 2); cool.position.set(5, 4, 2); scene.add(cool);
    mark = buildMark();
    scene.add(mark);
  } else {
    document.documentElement.classList.add("no-gl");
  }

  function resize() {
    if (!renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z * camera.aspect;
    if (reduce) render(0);
  }

  function render(t) {
    if (!renderer) return;
    canvas.style.opacity = String(S.o);
    if (S.o < 0.01 || document.hidden) return;
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    const fit = THREE.MathUtils.clamp(halfW / 2.9, 0.5, 1);
    mark.position.set(S.xf * halfW, S.y + (reduce ? 0 : Math.sin(t * 0.8) * 0.06), 0);
    mark.rotation.set(S.rx + (reduce ? 0 : Math.sin(t * 0.6) * 0.04) + pointer.y * 0.15, S.ry + pointer.x * 0.22, S.rz);
    mark.scale.setScalar(S.s * fit);
    mark.userData.spark.material.emissiveIntensity = 0.75 + (reduce ? 0 : Math.sin(t * 2.2) * 0.25);
    renderer.render(scene, camera);
  }

  resize();
  on(window, "resize", resize);
  cleanups.push(setupGlass({ reduce }));
  if (!reduce) {
    on(window, "pointermove", (e) => {
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
  }

  /* Reduced motion: one still frame, no scroll scenes */
  if (reduce) {
    Object.assign(S, { o: 1, xf: 0, rx: 0.18, ry: -0.4, s: 0.9 });
    const place = () => { canvas.style.top = $("#hero").offsetTop + "px"; render(0); };
    place();
    on(window, "resize", place);
    $$(".word").forEach((w) => { w.style.color = "var(--cream)"; });
    return () => { cleanups.forEach((f) => f()); disposeGL(); };
  }

  /* Smooth scroll + render loop + FPS probe */
  const lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
  lenis.on("scroll", ScrollTrigger.update);
  const samples = [];
  let probing = probe && !!renderer, skip = 15;
  const tick = (time, deltaMs) => {
    lenis.raf(time * 1000);
    render(time);
    // Measure only while the 3D mark is actually on screen: that is the expensive part.
    if (probing && S.o > 0.9 && !document.hidden) {
      if (skip > 0) { skip--; return; }
      samples.push(deltaMs);
      if (samples.length >= 90) {
        probing = false;
        const sorted = samples.slice().sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        if (median > 40) onSlow(Math.round(1000 / median)); // below ~25 fps
      }
    }
  };
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);

  on(document, "click", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute("href");
    const target = id === "#top" ? 0 : document.querySelector(id);
    if (target === null) return;
    e.preventDefault();
    lenis.scrollTo(target, { duration: 1.6 });
    if (target && target.focus) { target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true }); }
  });

  const mm = gsap.matchMedia();
  const ctx = gsap.context(() => {
    /* Progress bar */
    gsap.to(".progress span", { scaleY: 1, ease: "none", scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: true } });

    /* Intro: blueprint draws on load */
    const draw = ".bp__tile, .bp__a, .bp__spark";
    gsap.set(draw, { strokeDasharray: 1, strokeDashoffset: 1 });
    gsap.set(".bp__guides line", { strokeDasharray: "1 0", strokeDashoffset: 1 });
    gsap.timeline({ defaults: { ease: "power3.inOut" } })
      .to(".bp__guides line", { strokeDashoffset: 0, duration: 1.2, stagger: 0.08 }, 0)
      .from(".bp__circle", { opacity: 0, scale: 0.6, transformOrigin: "50% 50%", duration: 1.2, stagger: 0.15 }, 0.2)
      .to(".bp__tile", { strokeDashoffset: 0, duration: 1.4 }, 0.3)
      .to(".bp__a", { strokeDashoffset: 0, duration: 1.1 }, 0.7)
      .to(".bp__spark", { strokeDashoffset: 0, duration: 0.9 }, 1.1)
      .from(".bp__handles line", { scale: 0, transformOrigin: "50% 50%", duration: 0.5, stagger: 0.03, ease: "back.out(2)" }, 1.3)
      .from(".bp__nodes > *", { scale: 0, transformOrigin: "50% 50%", transformBox: "fill-box", duration: 0.4, stagger: 0.015, ease: "back.out(3)" }, 1.3)
      .from(".bp__notes text", { opacity: 0, duration: 0.6, stagger: 0.08 }, 1.7)
      .to(".bp__spark", { fill: "rgba(159,245,230,0.9)", duration: 0.6 }, 1.9)
      .set(draw, { strokeDasharray: "none" })
      .from(".intro__copy > *", { yPercent: 60, opacity: 0, duration: 1, stagger: 0.1, ease: "expo.out" }, 0.4)
      .from(".intro__meta > div, .intro__hint", { opacity: 0, y: 12, duration: 0.8, stagger: 0.08, ease: "expo.out" }, 0.9);

    /* Intro exit → dark stage, 3D mark appears */
    gsap.timeline({ scrollTrigger: { trigger: ".intro", start: "top top", end: "bottom bottom", scrub: 1 } })
      .to(".bp", { scale: 0.7, opacity: 0, ease: "power2.in", duration: 1 }, 0.2)
      .to(".intro__copy, .intro__meta, .intro__hint", { opacity: 0, y: -30, duration: 0.6 }, 0)
      .to(".intro__stage", { backgroundColor: "#110e0c", "--ga": 0, duration: 1 }, 0.4)
      .to(".intro", { backgroundColor: "#110e0c", duration: 1 }, 0.4)
      .to(".glow", { opacity: 1, duration: 1 }, 0.6)
      .fromTo(S, { o: 0, s: 0.55, ry: -2.4, rx: 0.5 }, { o: 1, s: 0.85, ry: 0, rx: 0.15, duration: 1, ease: "power2.out", immediateRender: false }, 0.6);

    mm.add({ desk: "(min-width: 861px)", mob: "(max-width: 860px)" }, (c) => {
      const { desk } = c.conditions;
      const side = desk ? 0.52 : 0;
      const chO = desk ? 1 : 0.22;
      const chS = desk ? 0.78 : 0.7;
      const st = (trigger, start, end) => ({ trigger, start, end, scrub: 1 });
      const ch = $$(".chapter");

      gsap.fromTo(S, { ry: 0, rx: 0.15, s: 0.85 }, { ry: TAU, rx: -0.12, s: 0.9, ease: "none", immediateRender: false, scrollTrigger: st("#hero", "top top", "bottom bottom") });
      gsap.fromTo(S, { xf: 0, y: 0, ry: TAU, rx: -0.12, s: 0.9, o: 1 }, { xf: side, y: desk ? 0.9 : 0, ry: TAU + 0.55, rx: 0.22, s: chS, o: chO, ease: "power2.inOut", immediateRender: false, scrollTrigger: st(ch[0], "top bottom", "top top") });
      gsap.fromTo(S, { ry: TAU + 0.55 }, { ry: TAU - 0.35, ease: "none", immediateRender: false, scrollTrigger: st(ch[0], "top top", "bottom bottom") });
      gsap.fromTo(S, { xf: side, y: desk ? 0.9 : 0, ry: TAU - 0.35, rx: 0.22 }, { xf: -side, y: 0, ry: 2 * TAU + 0.45, rx: 0.12, ease: "power2.inOut", immediateRender: false, scrollTrigger: st(ch[1], "top bottom", "top top") });
      gsap.fromTo(S, { ry: 2 * TAU + 0.45 }, { ry: 2 * TAU - 0.4, ease: "none", immediateRender: false, scrollTrigger: st(ch[1], "top top", "bottom bottom") });
      gsap.fromTo(S, { xf: -side, ry: 2 * TAU - 0.4, rx: 0.12 }, { xf: side, ry: 3 * TAU - 0.5, rx: -0.2, ease: "power2.inOut", immediateRender: false, scrollTrigger: st(ch[2], "top bottom", "top top") });
      gsap.fromTo(S, { o: chO, y: 0 }, { o: 0, y: -1.2, ease: "power1.in", immediateRender: false, scrollTrigger: st("#inside", "top bottom", "top 35%") });

      $$(".chapter__ui").forEach((ui) => {
        gsap.from(ui.children, { opacity: 0, y: 40, stagger: 0.12, ease: "power2.out", scrollTrigger: st(ui.closest(".chapter"), "top 20%", "top -40%") });
      });

      if (desk) {
        const track = $(".crew__track");
        const dist = () => Math.max(0, track.scrollWidth - window.innerWidth);
        gsap.to(track, {
          x: () => -dist(), ease: "none",
          scrollTrigger: { trigger: ".crew__pin", start: "top top", end: () => "+=" + dist(), pin: true, scrub: 1, invalidateOnRefresh: true, anticipatePin: 1 },
        });
      }
    });

    $$("[data-lines]").forEach((el) => {
      gsap.from(el.querySelectorAll(".line > span"), {
        yPercent: 110, duration: 1.1, stagger: 0.09, ease: "expo.out",
        scrollTrigger: { trigger: el.closest("section"), start: el.closest(".hero") ? "top 55%" : "top 75%", toggleActions: "play none none reverse" },
      });
    });

    $$("[data-words]").forEach((el) => {
      gsap.fromTo(el.querySelectorAll(".word"), { color: "#5a5047" }, {
        color: "#f5ede3", stagger: 0.1, ease: "none",
        scrollTrigger: { trigger: el.closest("section"), start: "top 55%", end: "top -35%", scrub: true },
      });
    });

    gsap.utils.toArray(".kicker, .stats li, .modes-list li, .review, .num, .spec, .cmd, .window, .mate, .reviews__bar").forEach((el) => {
      gsap.from(el, { opacity: 0, y: 36, duration: 1, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 92%", toggleActions: "play none none reverse" } });
    });

    gsap.from(".foot__mark", { yPercent: 40, opacity: 0.2, ease: "none", scrollTrigger: { trigger: ".foot", start: "top bottom", end: "bottom bottom", scrub: true } });
  });

  if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());

  function disposeGL() {
    if (!renderer) return;
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    if (scene.environment) scene.environment.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer = null;
    canvas.style.opacity = "0";
  }

  return function teardown() {
    gsap.ticker.remove(tick);
    mm.revert();
    ctx.revert();
    ScrollTrigger.getAll().forEach((t) => t.kill());
    lenis.destroy();
    cleanups.forEach((f) => f());
    disposeGL();
  };
}
