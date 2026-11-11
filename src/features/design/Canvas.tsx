import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Frame as FrameIcon, Globe, Hand, Loader2, Maximize, Minus, MousePointer2, Plus, Redo2, Square, SquarePlus, Undo2, Sparkles } from "lucide-react";
import { isLeafElement } from "@/features/design/dom";
import { shortcutKey } from "@/lib/keys";
import { liveEl, readTranslate } from "@/features/design/live";
import { ContextMenu, InsertMenu } from "@/features/design/Menus";
import { FrameView, type CanvasApi } from "@/features/design/FrameView";
import type { PresetId } from "@/features/design/ops";
import { DEVICES, useDesign } from "@/features/design/store";
import { useDesignText } from "@/features/design/strings";

const FRAME_GAP = 160;

export function Canvas() {
  const T = useDesignText();
  const frames = useDesign((s) => s.frames);
  const zoom = useDesign((s) => s.zoom);
  const pan = useDesign((s) => s.pan);
  const tool = useDesign((s) => s.tool);
  const status = useDesign((s) => s.status);
  const focusReq = useDesign((s) => s.focusReq);
  const canUndo = useDesign((s) => s.past.length > 0);
  const canRedo = useDesign((s) => s.future.length > 0);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editRegistry = useRef<Record<string, (id: string) => void>>({});

  // Screens side by side, left to right.
  const layout = useMemo(() => {
    let x = 0;
    return frames.map((frame) => {
      const w = DEVICES[frame.device].w;
      const item = { frame, x, w };
      x += w + FRAME_GAP;
      return item;
    });
  }, [frames]);
  const total = layout.length ? layout[layout.length - 1].x + layout[layout.length - 1].w : 0;
  const layoutKey = frames.map((f) => f.id + f.device).join("|");

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const st = useDesign.getState();
    const w = Math.max(1, total);
    const z = Math.min(1, Math.max(0.1, (vp.clientWidth - 96) / w));
    st.setZoom(z);
    st.setPan({ x: Math.round(Math.max(48, (vp.clientWidth - w * z) / 2)), y: 56 });
  }, [total]);

  // Fit when screens are added / removed or their device changes.
  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  // Center a screen on request (layers list, new screen from the AI).
  useEffect(() => {
    if (!focusReq) return;
    const vp = viewportRef.current;
    const item = layout.find((l) => l.frame.id === focusReq.id);
    if (!vp || !item) return;
    const st = useDesign.getState();
    // Already fully in view (e.g. right after "fit all"): leave the canvas alone so the other screens stay visible.
    const left = st.pan.x + item.x * st.zoom;
    const right = left + item.w * st.zoom;
    if (left >= 0 && right <= vp.clientWidth) return;
    st.setPan({ x: Math.round(vp.clientWidth / 2 - (item.x + item.w / 2) * st.zoom), y: st.pan.y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq?.n]);

  // ── Zoom / pan ─────────────────────────────────────────────
  const onWheel = useCallback((e: WheelEvent, iframe: HTMLIFrameElement | null) => {
    e.preventDefault();
    const vp = viewportRef.current;
    if (!vp) return;
    const st = useDesign.getState();
    // Hand tool: the wheel zooms. Select tool: the wheel pans and Ctrl+wheel zooms.
    if (e.ctrlKey || e.metaKey || st.tool === "hand") {
      const rect = vp.getBoundingClientRect();
      const frameRect = iframe?.getBoundingClientRect();
      const cx = iframe && frameRect ? frameRect.left + e.clientX * st.zoom - rect.left : e.clientX - rect.left;
      const cy = iframe && frameRect ? frameRect.top + e.clientY * st.zoom - rect.top : e.clientY - rect.top;
      const nextZoom = Math.min(4, Math.max(0.1, st.zoom * Math.exp(-e.deltaY * 0.0015)));
      const k = nextZoom / st.zoom;
      st.setZoom(nextZoom);
      st.setPan({ x: cx - (cx - st.pan.x) * k, y: cy - (cy - st.pan.y) * k });
    } else {
      st.setPan({ x: st.pan.x - e.deltaX, y: st.pan.y - e.deltaY });
    }
  }, []);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const handler = (e: WheelEvent) => onWheel(e, null);
    vp.addEventListener("wheel", handler, { passive: false });
    return () => vp.removeEventListener("wheel", handler);
  }, [onWheel]);

  // ── Keyboard ───────────────────────────────────────────────
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const spaceRef = useRef<"select" | "hand" | null>(null);

  /** Moves keyboard focus out of any text field so Delete / Backspace / arrows reach the canvas. */
  const focusCanvas = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && active !== viewportRef.current) active.blur?.();
    viewportRef.current?.focus({ preventScroll: true });
  }, []);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.code === "Space" && spaceRef.current) {
      useDesign.getState().setTool(spaceRef.current);
      spaceRef.current = null;
    }
  }, []);

  const handleKey = useCallback((e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    const inputType = tag === "INPUT" ? (el as HTMLInputElement).type : "";
    const numeric = ["number", "color", "range", "checkbox", "radio", "button"].includes(inputType);
    // Text fields keep their own shortcuts. Numeric property fields only let undo/redo through.
    if (el && (tag === "TEXTAREA" || el.isContentEditable || (tag === "INPUT" && !numeric))) return;
    const st = useDesign.getState();
    const mod = e.ctrlKey || e.metaKey;
    const key = shortcutKey(e);
    if (tag === "INPUT" && !(mod && (key === "z" || key === "y"))) return;
    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) st.redo();
      else st.undo();
    } else if (mod && key === "y") {
      e.preventDefault();
      st.redo();
    } else if (mod && key === "d") {
      e.preventDefault();
      st.duplicateSelected();
    } else if (mod && key === "c") {
      if (st.selectedId) {
        e.preventDefault();
        st.copySelected();
      }
    } else if (mod && key === "x") {
      if (st.selectedId) {
        e.preventDefault();
        st.cutSelected();
      }
    } else if (mod && key === "v") {
      if (st.clipboard) {
        e.preventDefault();
        st.paste();
      }
    } else if (mod && key === "g") {
      e.preventDefault();
      if (e.shiftKey) st.ungroup();
      else st.group();
    } else if (mod && key === "a") {
      e.preventDefault();
      st.selectAll();
    } else if (e.key === "Escape") {
      st.select(null);
    } else if ((e.key === "Delete" || e.key === "Backspace") && st.selectedId) {
      e.preventDefault();
      st.deleteSelected();
    } else if (e.key === "Enter" && st.selectedId) {
      e.preventDefault();
      if (e.shiftKey) st.selectParent();
      else {
        const target = liveEl(st.selectedId);
        if (target && isLeafElement(target)) editRegistry.current[st.activeFrameId]?.(st.selectedId);
        else st.selectChild();
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      st.selectSibling(e.shiftKey ? -1 : 1);
    } else if (mod && (key === "=" || key === "-" || key === "0" || key === "1")) {
      e.preventDefault();
      const vp = viewportRef.current;
      if (!vp) return;
      if (key === "0") {
        fitRef.current();
      } else {
        const next = key === "1" ? 1 : Math.min(4, Math.max(0.1, st.zoom * (key === "=" ? 1.2 : 1 / 1.2)));
        const cx = vp.clientWidth / 2;
        const cy = vp.clientHeight / 2;
        const r = next / st.zoom;
        st.setZoom(next);
        st.setPan({ x: cx - (cx - st.pan.x) * r, y: cy - (cy - st.pan.y) * r });
      }
    } else if (key === " " && !mod) {
      e.preventDefault();
      if (!spaceRef.current && st.tool !== "hand") {
        spaceRef.current = st.tool;
        st.setTool("hand");
      }
    } else if (key === "]") {
      st.reorder(mod ? "front" : "forward");
    } else if (key === "[") {
      st.reorder(mod ? "back" : "backward");
    } else if (e.key.startsWith("Arrow") && st.selectedId) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
      const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
      const ids = [...st.multi, st.selectedId];
      for (const id of ids) {
        const target = liveEl(id);
        if (!target) continue;
        const t = readTranslate(target);
        st.updateStyles(id, { translate: `${t.x + dx}px ${t.y + dy}px` }, `nudge:${ids.join(",")}`);
      }
    } else if (key === "v" && !mod) st.setTool("select");
    else if (key === "h" && !mod) st.setTool("hand");
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKey, handleKeyUp]);

  // Stable object shared with every screen.
  const api = useMemo<CanvasApi>(
    () => ({
      onWheel,
      handleKey,
      handleKeyUp,
      focusCanvas,
      openMenu: (x, y) => setMenu({ x, y }),
      closeMenus: () => {
        setMenu(null);
        setInsertOpen(false);
      },
      editRegistry,
    }),
    [onWheel, handleKey, handleKeyUp, focusCanvas],
  );

  // ── Hand tool / middle mouse pan ───────────────────────────
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    focusCanvas();
    if (tool !== "hand" && e.button !== 1) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    useDesign.getState().setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const zoomBy = (k: number) => {
    const vp = viewportRef.current;
    const st = useDesign.getState();
    if (!vp) return;
    const cx = vp.clientWidth / 2;
    const cy = vp.clientHeight / 2;
    const next = Math.min(4, Math.max(0.1, st.zoom * k));
    const r = next / st.zoom;
    st.setZoom(next);
    st.setPan({ x: cx - (cx - st.pan.x) * r, y: cy - (cy - st.pan.y) * r });
  };

  const empty = frames.length === 1 && !frames[0].html.trim();

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={viewportRef}
        tabIndex={-1}
        className={"absolute inset-0 overflow-hidden outline-none " + (tool === "hand" ? "cursor-grab active:cursor-grabbing" : "")}
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          if (e.target === e.currentTarget && tool === "select") useDesign.getState().select(null);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          useDesign.getState().select(null);
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {!empty && (
          <div
            className="absolute left-0 top-0"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0", width: total }}
          >
            {layout.map((l) => (
              <FrameView key={l.frame.id} frame={l.frame} x={l.x} zoom={zoom} tool={tool} api={api} />
            ))}
          </div>
        )}

        {empty && <EmptyState />}
        {status === "streaming" && !empty && (
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-line-strong bg-overlay px-3 py-1.5 text-[12px] text-ink-200">
            {T.working}
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || file.size > 1_500_000) return;
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") useDesign.getState().insertImage(reader.result);
          };
          reader.readAsDataURL(file);
        }}
      />
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}

      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-line-strong bg-overlay/95 p-1.5 shadow-2xl shadow-black/50">
        {insertOpen && (
          <InsertMenu
            onClose={() => setInsertOpen(false)}
            onPick={(id: PresetId) => {
              setInsertOpen(false);
              if (id === "image") fileRef.current?.click();
              else useDesign.getState().insert(id);
            }}
          />
        )}
        <ToolBtn label={T.select} active={tool === "select"} onClick={() => useDesign.getState().setTool("select")}>
          <MousePointer2 size={16} />
        </ToolBtn>
        <ToolBtn label={T.hand} active={tool === "hand"} onClick={() => useDesign.getState().setTool("hand")}>
          <Hand size={16} />
        </ToolBtn>
        <ToolBtn label={T.insert} active={insertOpen} onClick={() => setInsertOpen((v) => !v)}>
          <SquarePlus size={16} />
        </ToolBtn>
        <ToolBtn label={T.addScreen} onClick={() => useDesign.getState().addFrame()}>
          <FrameIcon size={16} />
        </ToolBtn>
        <Sep />
        <ToolBtn label={T.undo} disabled={!canUndo} onClick={() => useDesign.getState().undo()}>
          <Undo2 size={16} />
        </ToolBtn>
        <ToolBtn label={T.redo} disabled={!canRedo} onClick={() => useDesign.getState().redo()}>
          <Redo2 size={16} />
        </ToolBtn>
        <Sep />
        <ToolBtn label={T.zoomOut} onClick={() => zoomBy(1 / 1.2)}>
          <Minus size={16} />
        </ToolBtn>
        <span className="w-11 text-center font-mono text-[12px] tabular-nums text-ink-200">{Math.round(zoom * 100)}%</span>
        <ToolBtn label={T.zoomIn} onClick={() => zoomBy(1.2)}>
          <Plus size={16} />
        </ToolBtn>
        <ToolBtn label={T.fit} onClick={fit}>
          <Maximize size={16} />
        </ToolBtn>
      </div>
    </div>
  );
}

function Sep() {
  return <div className="mx-1 h-5 w-px bg-line-strong" />;
}

function ToolBtn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={
        "flex size-8 items-center justify-center rounded-lg transition-colors disabled:opacity-35 " +
        (active ? "bg-white/[0.12] text-ink-50" : "text-ink-300 enabled:hover:bg-white/[0.07] enabled:hover:text-ink-50")
      }
    >
      {children}
    </button>
  );
}

function EmptyState() {
  const T = useDesignText();
  const status = useDesign((s) => s.status);
  const job = useDesign((s) => s.job);
  const busy = status === "streaming";
  // While the first design is being generated the canvas must visibly work.
  if (busy) {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-2xl bg-white/[0.06] text-ink-200">
            <Loader2 size={20} className="animate-spin" />
          </div>
          <div className="text-[16px] font-medium text-ink-50">{T.designing}</div>
          {job && <p className="mt-1.5 text-[13px] text-ink-400">{job.label}</p>}
          <button
            onClick={() => useDesign.getState().stop()}
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.07] px-3 text-[13px] text-ink-100 transition-colors hover:bg-white/[0.12]"
          >
            <Square size={11} fill="currentColor" />
            {T.stop}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-2xl bg-white/[0.06] text-ink-200">
          <Sparkles size={20} />
        </div>
        <div className="text-[16px] font-medium text-ink-50">{T.emptyTitle}</div>
        <p className="mt-1.5 text-[13px] leading-5 text-ink-400">{T.emptySubtitle}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {T.suggestions.map((s) => (
            <button
              key={s}
              onClick={() => useDesign.getState().send(s)}
              className="rounded-full border border-line-strong px-3 py-1.5 text-[12.5px] text-ink-200 transition-colors hover:bg-white/[0.06] hover:text-ink-50"
            >
              {s}
            </button>
          ))}
          <button
            onClick={() => useDesign.getState().setSiteDialog(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[12.5px] text-ink-200 transition-colors hover:bg-white/[0.06] hover:text-ink-50"
          >
            <Globe size={13} />
            {T.siteChip}
          </button>
        </div>
      </div>
    </div>
  );
}
