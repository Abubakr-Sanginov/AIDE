import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildDocument, isLeafElement } from "@/features/design/dom";
import { liveEl, readTranslate, setLiveDoc } from "@/features/design/live";
import { DEVICES, useDesign, type Frame } from "@/features/design/store";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  tag: string;
}

const SELECT_COLOR = "#6ea8ff";
const MIN_SIZE = 8;

// Resize handles: [x, y] in {0, .5, 1} of the selection box.
const HANDLES: { hx: 0 | 0.5 | 1; hy: 0 | 0.5 | 1; cursor: string }[] = [
  { hx: 0, hy: 0, cursor: "nwse-resize" },
  { hx: 0.5, hy: 0, cursor: "ns-resize" },
  { hx: 1, hy: 0, cursor: "nesw-resize" },
  { hx: 1, hy: 0.5, cursor: "ew-resize" },
  { hx: 1, hy: 1, cursor: "nwse-resize" },
  { hx: 0.5, hy: 1, cursor: "ns-resize" },
  { hx: 0, hy: 1, cursor: "nesw-resize" },
  { hx: 0, hy: 0.5, cursor: "ew-resize" },
];

function measure(doc: Document | null, aid: string | null): Box | null {
  if (!doc || !aid) return null;
  const el = doc.querySelector(`[data-aid="${aid}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, tag: el.tagName.toLowerCase() };
}

/** What the canvas shares with every screen. */
export interface CanvasApi {
  onWheel: (e: WheelEvent, iframe: HTMLIFrameElement | null) => void;
  handleKey: (e: KeyboardEvent) => void;
  handleKeyUp: (e: KeyboardEvent) => void;
  focusCanvas: () => void;
  openMenu: (x: number, y: number) => void;
  closeMenus: () => void;
  /** frameId -> start inline text editing of an element in that screen */
  editRegistry: React.MutableRefObject<Record<string, (id: string) => void>>;
}

interface Props {
  frame: Frame;
  x: number;
  zoom: number;
  tool: "select" | "hand";
  api: CanvasApi;
}

/** One screen: label, iframe, selection overlay and all direct-manipulation handlers. */
export function FrameView({ frame, x, zoom, tool, api }: Props) {
  const active = useDesign((s) => s.activeFrameId === frame.id);
  const selectedId = useDesign((s) => s.selectedId);
  const multi = useDesign((s) => s.multi);
  const hoverId = useDesign((s) => s.hoverId);
  const editingId = useDesign((s) => s.editingId);
  const styleRev = useDesign((s) => s.styleRev);
  const docRev = useDesign((s) => s.docRev);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [frameH, setFrameH] = useState(DEVICES[frame.device].h);
  const [boxes, setBoxes] = useState<{ sel: Box[]; hov: Box | null }>({ sel: [], hov: null });
  const [renaming, setRenaming] = useState(false);

  const dev = DEVICES[frame.device];
  // Reload only for structural changes (frame.rev). Direct edits go to the live document.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const srcDoc = useMemo(() => buildDocument(frame.html, { canvas: true }), [frame.id, frame.rev]);

  const remeasure = useCallback(() => {
    const st = useDesign.getState();
    if (st.activeFrameId !== frame.id) {
      setBoxes((b) => (b.sel.length || b.hov ? { sel: [], hov: null } : b));
      return;
    }
    const doc = iframeRef.current?.contentDocument ?? null;
    const ids = st.selectedId ? [...st.multi, st.selectedId] : [];
    setBoxes({
      sel: ids.map((id) => measure(doc, id)).filter((b): b is Box => !!b),
      hov: st.hoverId && !ids.includes(st.hoverId) ? measure(doc, st.hoverId) : null,
    });
  }, [frame.id]);

  useLayoutEffect(() => {
    remeasure();
  }, [remeasure, active, selectedId, multi, hoverId, frame.html, frameH, frame.device, styleRev, editingId, docRev]);

  useEffect(
    () => () => {
      roRef.current?.disconnect();
      setLiveDoc(frame.id, null);
      delete api.editRegistry.current[frame.id];
    },
    [frame.id, api.editRegistry],
  );

  // ── Iframe wiring: select, drag, text edit ─────────────────
  const onLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    setLiveDoc(frame.id, doc);
    const isActive = () => useDesign.getState().activeFrameId === frame.id;
    if (isActive()) {
      useDesign.getState().setEditing(null);
      useDesign.getState().bumpDoc();
    }

    const pick = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-aid]");
      if (!el || el.closest("[data-locked]")) return null;
      return el.getAttribute("data-aid");
    };
    const activate = () => {
      if (!isActive()) useDesign.getState().activateFrame(frame.id);
    };

    let drag: { items: { id: string; bx: number; by: number }[]; sx: number; sy: number; moved: boolean } | null = null;
    let editing: { id: string; el: HTMLElement; original: string } | null = null;

    const finishEdit = (save: boolean) => {
      if (!editing) return;
      const { id, el, original } = editing;
      editing = null;
      const text = el.textContent ?? "";
      el.removeAttribute("contenteditable");
      el.removeEventListener("keydown", onEditKey);
      el.removeEventListener("blur", onEditBlur);
      if (!save) el.textContent = original;
      useDesign.getState().setEditing(null);
      if (save && text !== original) useDesign.getState().updateText(id, text);
    };
    const onEditKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        finishEdit(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finishEdit(false);
      }
    };
    const onEditBlur = () => finishEdit(true);

    const startEdit = (id: string) => {
      const el = doc.querySelector(`[data-aid="${id}"]`) as HTMLElement | null;
      if (!el || !isLeafElement(el)) return;
      editing = { id, el, original: el.textContent ?? "" };
      el.setAttribute("contenteditable", "plaintext-only");
      el.addEventListener("keydown", onEditKey);
      el.addEventListener("blur", onEditBlur);
      useDesign.getState().setEditing(id);
      el.focus();
      const sel = doc.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(el);
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    api.editRegistry.current[frame.id] = startEdit;

    const onMove = (e: MouseEvent) => {
      if (!drag) return;
      const dx = e.screenX - drag.sx;
      const dy = e.screenY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      const z = useDesign.getState().zoom;
      for (const it of drag.items) {
        liveEl(it.id)?.style.setProperty("translate", `${it.bx + dx / z}px ${it.by + dy / z}px`);
      }
      remeasure();
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseup", onUp);
      if (drag?.moved) {
        const key = `drag:${Date.now()}`;
        for (const it of drag.items) {
          const el = liveEl(it.id);
          if (el) useDesign.getState().updateStyles(it.id, { translate: el.style.translate }, key + it.id);
        }
      }
      drag = null;
    };

    doc.addEventListener("mousemove", (e) => {
      if (drag || editing || !isActive() || useDesign.getState().tool !== "select") return;
      useDesign.getState().hover(pick(e));
    });
    doc.documentElement.addEventListener("mouseleave", () => {
      if (isActive()) useDesign.getState().hover(null);
    });
    doc.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || useDesign.getState().tool !== "select") return;
      if (editing) {
        if (editing.el.contains(e.target as Node)) return; // caret placement inside the text
        finishEdit(true);
      }
      e.preventDefault();
      api.focusCanvas();
      api.closeMenus();
      activate();
      const id = pick(e);
      const st = useDesign.getState();
      if (id && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        st.toggleSelect(id);
        return;
      }
      const current = st.selectedId ? [...st.multi, st.selectedId] : [];
      if (!id || !current.includes(id)) st.select(id);
      if (!id) return;
      const sel = useDesign.getState();
      const ids = sel.selectedId ? [...sel.multi, sel.selectedId] : [];
      const items = ids
        .map((i) => ({ id: i, el: liveEl(i) }))
        .filter((x): x is { id: string; el: HTMLElement } => !!x.el)
        .map((x) => ({ id: x.id, bx: readTranslate(x.el).x, by: readTranslate(x.el).y }));
      drag = { items, sx: e.screenX, sy: e.screenY, moved: false };
      st.hover(null);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      doc.addEventListener("mousemove", onMove);
      doc.addEventListener("mouseup", onUp);
    });
    doc.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    doc.addEventListener("dblclick", (e) => {
      if (useDesign.getState().tool !== "select") return;
      activate();
      const id = pick(e);
      if (id) startEdit(id);
    });
    doc.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      activate();
      const id = pick(e);
      const st = useDesign.getState();
      const current = st.selectedId ? [...st.multi, st.selectedId] : [];
      if (id && !current.includes(id)) st.select(id);
      if (!id) st.select(null);
      const fr = iframeRef.current?.getBoundingClientRect();
      if (!fr) return;
      api.openMenu(fr.left + e.clientX * st.zoom, fr.top + e.clientY * st.zoom);
    });
    doc.addEventListener("dragstart", (e) => e.preventDefault());
    doc.addEventListener("submit", (e) => e.preventDefault());
    doc.addEventListener("keydown", api.handleKey);
    doc.addEventListener("keyup", api.handleKeyUp);
    doc.addEventListener("wheel", (e) => api.onWheel(e, iframeRef.current), { passive: false });

    const sync = () => {
      const device = useDesign.getState().frames.find((f) => f.id === frame.id)?.device ?? "desktop";
      const h = Math.max(DEVICES[device].h, doc.documentElement.scrollHeight);
      setFrameH(h);
      remeasure();
    };
    sync();
    roRef.current?.disconnect();
    const ro = new ResizeObserver(sync);
    ro.observe(doc.documentElement);
    ro.observe(doc.body);
    roRef.current = ro;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.id, api, remeasure]);

  // ── Resize handles ─────────────────────────────────────────
  const startResize = (e: React.PointerEvent, hx: number, hy: number) => {
    const st0 = useDesign.getState();
    const id = st0.selectedId;
    const el = liveEl(id);
    const selBox = boxes.sel[boxes.sel.length - 1];
    if (!id || !el || !selBox || st0.multi.length > 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const start = { x: e.screenX, y: e.screenY, w: selBox.w, h: selBox.h, t: readTranslate(el) };

    const move = (ev: PointerEvent) => {
      const z = useDesign.getState().zoom;
      const dx = (ev.screenX - start.x) / z;
      const dy = (ev.screenY - start.y) / z;
      let w = start.w;
      let h = start.h;
      let tx = start.t.x;
      let ty = start.t.y;
      if (hx === 1) w = start.w + dx;
      if (hx === 0) {
        w = start.w - dx;
        tx = start.t.x + dx;
      }
      if (hy === 1) h = start.h + dy;
      if (hy === 0) {
        h = start.h - dy;
        ty = start.t.y + dy;
      }
      if (w < MIN_SIZE) {
        if (hx === 0) tx -= MIN_SIZE - w;
        w = MIN_SIZE;
      }
      if (h < MIN_SIZE) {
        if (hy === 0) ty -= MIN_SIZE - h;
        h = MIN_SIZE;
      }
      if (hx !== 0.5) el.style.setProperty("width", `${Math.round(w)}px`);
      if (hy !== 0.5) el.style.setProperty("height", `${Math.round(h)}px`);
      if (hx === 0 || hy === 0) el.style.setProperty("translate", `${Math.round(tx)}px ${Math.round(ty)}px`);
      remeasure();
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      useDesign.getState().updateStyles(
        id,
        { width: el.style.width, height: el.style.height, translate: el.style.translate },
        `resize:${Date.now()}`,
      );
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const bw = 1.5 / zoom;
  const hs = 9 / zoom;

  return (
    <div className="absolute top-0" style={{ left: x, width: dev.w }}>
      {/* Label */}
      <div
        className="absolute left-0 flex items-center gap-2 whitespace-nowrap text-[12px]"
        style={{ top: -26 / zoom, transform: `scale(${1 / zoom})`, transformOrigin: "0 100%" }}
      >
        {renaming ? (
          <RenameInput
            initial={frame.name}
            onDone={(name) => {
              setRenaming(false);
              if (name) useDesign.getState().renameFrame(frame.id, name);
            }}
          />
        ) : (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => useDesign.getState().activateFrame(frame.id)}
            onDoubleClick={() => setRenaming(true)}
            className={"rounded px-1 py-0.5 transition-colors " + (active ? "bg-white/[0.1] text-ink-50" : "text-ink-400 hover:text-ink-100")}
          >
            {frame.name}
          </button>
        )}
        <span className="text-ink-500">
          {dev.w} × {dev.h}
        </span>
      </div>

      <div
        className={
          "relative bg-white " +
          (active
            ? "shadow-[0_0_0_1px_rgba(110,168,255,0.55),0_24px_60px_rgba(0,0,0,0.5)]"
            : "shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_24px_60px_rgba(0,0,0,0.5)]")
        }
        style={{ width: dev.w, height: frameH }}
      >
        <iframe
          ref={iframeRef}
          title={frame.name}
          sandbox="allow-same-origin"
          srcDoc={srcDoc}
          onLoad={onLoad}
          scrolling="no"
          className="block border-0 bg-white"
          style={{ width: dev.w, height: frameH, pointerEvents: tool === "hand" ? "none" : "auto" }}
        />
        {active && boxes.hov && !editingId && (
          <div
            className="pointer-events-none absolute"
            style={{ left: boxes.hov.x, top: boxes.hov.y, width: boxes.hov.w, height: boxes.hov.h, outline: `${bw}px solid ${SELECT_COLOR}66` }}
          />
        )}
        {active &&
          boxes.sel.map((box, idx) => {
            const primary = idx === boxes.sel.length - 1;
            return (
              <div
                key={idx}
                className="pointer-events-none absolute"
                style={{
                  left: box.x,
                  top: box.y,
                  width: box.w,
                  height: box.h,
                  outline: `${bw * 1.3}px solid ${SELECT_COLOR}`,
                  background: editingId ? "transparent" : `${SELECT_COLOR}14`,
                }}
              >
                {primary && (
                  <span
                    className="absolute left-0 rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#0b1220]"
                    style={{ top: -20 / zoom, background: SELECT_COLOR, transform: `scale(${1 / zoom})`, transformOrigin: "0 100%" }}
                  >
                    {box.tag}
                  </span>
                )}
                {primary &&
                  boxes.sel.length === 1 &&
                  tool === "select" &&
                  !editingId &&
                  HANDLES.map((h) => (
                    <span
                      key={`${h.hx}-${h.hy}`}
                      onPointerDown={(e) => startResize(e, h.hx, h.hy)}
                      className="pointer-events-auto absolute rounded-[2px] border bg-white"
                      style={{
                        width: hs,
                        height: hs,
                        left: `calc(${h.hx * 100}% - ${hs / 2}px)`,
                        top: `calc(${h.hy * 100}% - ${hs / 2}px)`,
                        borderColor: SELECT_COLOR,
                        borderWidth: bw,
                        cursor: h.cursor,
                      }}
                    />
                  ))}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      maxLength={60}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onDone(value.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(value.trim() || null);
        else if (e.key === "Escape") onDone(null);
      }}
      className="h-6 w-48 rounded border border-line-strong bg-canvas px-1.5 text-[12px] text-ink-50 outline-none focus:border-white/30"
    />
  );
}
