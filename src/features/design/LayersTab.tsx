import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CopyPlus, Eye, EyeOff, Layers, Lock, LockOpen, Monitor, Plus, Smartphone, SquarePen, Tablet, Trash2 } from "lucide-react";
import { buildLayers } from "@/features/design/dom";
import { useDesign } from "@/features/design/store";
import { useDesignText } from "@/features/design/strings";
import type { MovePos } from "@/features/design/ops";

interface DropState {
  id: string;
  pos: MovePos;
}

// Layer tree: select (shift/ctrl for multi), drag to reorder or nest,
// eye / lock toggles, double-click to rename, chevron to collapse.
export function LayersTab() {
  const T = useDesignText();
  const html = useDesign((s) => s.html);
  const selectedId = useDesign((s) => s.selectedId);
  const multi = useDesign((s) => s.multi);
  const layers = useMemo(() => buildLayers(html), [html]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const selected = new Set(selectedId ? [...multi, selectedId] : []);

  // Hide descendants of collapsed layers.
  const visible = useMemo(() => {
    const out: typeof layers = [];
    let skipBelow = Infinity;
    for (const l of layers) {
      if (l.depth > skipBelow) continue;
      skipBelow = Infinity;
      out.push(l);
      if (collapsed.has(l.id)) skipBelow = l.depth;
    }
    return out;
  }, [layers, collapsed]);

  if (layers.length === 0) {
    return (
      <div className="aide-scroll h-full overflow-y-auto px-2 pb-3">
        <ScreensSection />
        <div className="flex flex-col items-center justify-center gap-2 pt-10 text-[13px] text-ink-500">
          <Layers size={22} strokeWidth={1.4} />
          {T.noLayers}
        </div>
      </div>
    );
  }

  const posFor = (e: React.DragEvent, container: boolean): MovePos => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (y < 0.28) return "before";
    if (y > 0.72) return "after";
    return container ? "inside" : y < 0.5 ? "before" : "after";
  };

  return (
    <div className="aide-scroll h-full overflow-y-auto px-2 pb-3" onDragEnd={() => { setDragId(null); setDrop(null); }}>
      <ScreensSection />
      <div className="px-2 pb-1.5 pt-3 text-[12px] font-medium uppercase tracking-wide text-ink-500">{T.elements}</div>
      {visible.map((l) => {
        const isSel = selected.has(l.id);
        const isDrop = drop?.id === l.id;
        return (
          <div
            key={l.id}
            draggable={renaming !== l.id}
            onDragStart={(e) => {
              setDragId(l.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", l.id);
            }}
            onDragOver={(e) => {
              if (!dragId || dragId === l.id) return;
              e.preventDefault();
              const pos = posFor(e, true);
              if (drop?.id !== l.id || drop.pos !== pos) setDrop({ id: l.id, pos });
            }}
            onDragLeave={() => setDrop((d) => (d?.id === l.id ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && drop) useDesign.getState().moveInTree(dragId, drop.id, drop.pos);
              setDragId(null);
              setDrop(null);
            }}
            onClick={(e) => {
              const st = useDesign.getState();
              if (e.shiftKey || e.ctrlKey || e.metaKey) st.toggleSelect(l.id);
              else st.select(l.id);
            }}
            onPointerEnter={() => useDesign.getState().hover(l.id)}
            onPointerLeave={() => useDesign.getState().hover(null)}
            onDoubleClick={() => setRenaming(l.id)}
            style={{ paddingLeft: 4 + Math.min(l.depth, 10) * 14 }}
            className={
              "group relative flex h-8 cursor-default items-center gap-1 rounded-lg pr-1 text-[13px] transition-colors " +
              (isSel ? "bg-white/[0.09] text-ink-50" : "text-ink-300 hover:bg-white/[0.04] hover:text-ink-50") +
              (l.hidden ? " opacity-50" : "") +
              (isDrop && drop?.pos === "inside" ? " ring-1 ring-[#6ea8ff]" : "")
            }
          >
            {isDrop && drop?.pos === "before" && <span className="pointer-events-none absolute -top-px left-2 right-2 h-0.5 rounded bg-[#6ea8ff]" />}
            {isDrop && drop?.pos === "after" && <span className="pointer-events-none absolute -bottom-px left-2 right-2 h-0.5 rounded bg-[#6ea8ff]" />}

            <button
              aria-label="toggle"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((c) => {
                  const n = new Set(c);
                  if (n.has(l.id)) n.delete(l.id);
                  else n.add(l.id);
                  return n;
                });
              }}
              className={"flex size-5 shrink-0 items-center justify-center rounded text-ink-500 hover:text-ink-100 " + (l.hasChildren ? "" : "invisible")}
            >
              <ChevronRight size={12} className={"transition-transform " + (collapsed.has(l.id) ? "" : "rotate-90")} />
            </button>
            <SquarePen size={12} className="shrink-0 text-ink-500" />

            {renaming === l.id ? (
              <RenameInput
                initial={l.name || l.label || l.tag}
                label={T.layerName}
                onDone={(name) => {
                  setRenaming(null);
                  if (name !== null) useDesign.getState().rename(l.id, name);
                }}
              />
            ) : l.name ? (
              <span className="min-w-0 truncate">{l.name}</span>
            ) : (
              <>
                <span className="font-mono text-[12px] text-[#6ea8ff]">{l.tag}</span>
                {l.label && <span className="min-w-0 truncate text-ink-400">{l.label}</span>}
              </>
            )}

            <span className="ml-auto flex shrink-0 items-center">
              <button
                title={l.hidden ? T.show : T.hide}
                aria-label={l.hidden ? T.show : T.hide}
                onClick={(e) => {
                  e.stopPropagation();
                  useDesign.getState().toggleHidden(l.id);
                }}
                className={"flex size-6 items-center justify-center rounded text-ink-400 hover:text-ink-50 " + (l.hidden ? "" : "opacity-0 group-hover:opacity-100")}
              >
                {l.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                title={l.locked ? T.unlock : T.lock}
                aria-label={l.locked ? T.unlock : T.lock}
                onClick={(e) => {
                  e.stopPropagation();
                  useDesign.getState().toggleLocked(l.id);
                }}
                className={"flex size-6 items-center justify-center rounded text-ink-400 hover:text-ink-50 " + (l.locked ? "" : "opacity-0 group-hover:opacity-100")}
              >
                {l.locked ? <Lock size={13} /> : <LockOpen size={13} />}
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RenameInput({ initial, label, onDone }: { initial: string; label: string; onDone: (name: string | null) => void }) {
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
      aria-label={label}
      maxLength={60}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(value);
        else if (e.key === "Escape") onDone(null);
      }}
      className="h-6 min-w-0 flex-1 rounded border border-line-strong bg-canvas px-1.5 text-[13px] text-ink-50 outline-none focus:border-white/30"
    />
  );
}

const DEVICE_ICON = { desktop: Monitor, tablet: Tablet, mobile: Smartphone } as const;

// Screens (frames) of the design: switch, add, duplicate, delete, rename, reorder.
function ScreensSection() {
  const T = useDesignText();
  const frames = useDesign((s) => s.frames);
  const activeFrameId = useDesign((s) => s.activeFrameId);
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <div className="mb-1">
      <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
        <span className="text-[12px] font-medium uppercase tracking-wide text-ink-500">{T.screens}</span>
        <button
          title={T.addScreen}
          aria-label={T.addScreen}
          onClick={() => useDesign.getState().addFrame()}
          className="aide-icon-button size-6"
        >
          <Plus size={14} />
        </button>
      </div>
      {frames.map((f, i) => {
        const Icon = DEVICE_ICON[f.device];
        const isActive = f.id === activeFrameId;
        return (
          <div
            key={f.id}
            onClick={() => {
              const st = useDesign.getState();
              st.activateFrame(f.id);
              st.focusFrame(f.id);
            }}
            onDoubleClick={() => setRenaming(f.id)}
            className={
              "group flex h-8 cursor-default items-center gap-2 rounded-lg px-2 text-[13px] transition-colors " +
              (isActive ? "bg-white/[0.09] text-ink-50" : "text-ink-300 hover:bg-white/[0.04] hover:text-ink-50")
            }
          >
            <Icon size={13} className="shrink-0 text-ink-500" />
            {renaming === f.id ? (
              <ScreenRename
                initial={f.name}
                label={T.frameName}
                onDone={(name) => {
                  setRenaming(null);
                  if (name) useDesign.getState().renameFrame(f.id, name);
                }}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
            )}
            <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button
                title="←"
                aria-label="Move left"
                disabled={i === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  useDesign.getState().moveFrame(f.id, -1);
                }}
                className="flex size-6 items-center justify-center rounded text-ink-400 hover:text-ink-50 disabled:opacity-30"
              >
                <ChevronLeft size={13} />
              </button>
              <button
                title="→"
                aria-label="Move right"
                disabled={i === frames.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  useDesign.getState().moveFrame(f.id, 1);
                }}
                className="flex size-6 items-center justify-center rounded text-ink-400 hover:text-ink-50 disabled:opacity-30"
              >
                <ChevronRight size={13} />
              </button>
              <button
                title={T.duplicateScreen}
                aria-label={T.duplicateScreen}
                onClick={(e) => {
                  e.stopPropagation();
                  useDesign.getState().duplicateFrame(f.id);
                }}
                className="flex size-6 items-center justify-center rounded text-ink-400 hover:text-ink-50"
              >
                <CopyPlus size={13} />
              </button>
              <button
                title={T.deleteScreen}
                aria-label={T.deleteScreen}
                onClick={(e) => {
                  e.stopPropagation();
                  useDesign.getState().deleteFrame(f.id);
                }}
                className="flex size-6 items-center justify-center rounded text-ink-400 hover:text-red-300"
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ScreenRename({ initial, label, onDone }: { initial: string; label: string; onDone: (name: string | null) => void }) {
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
      aria-label={label}
      maxLength={60}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => onDone(value.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(value.trim() || null);
        else if (e.key === "Escape") onDone(null);
      }}
      className="h-6 min-w-0 flex-1 rounded border border-line-strong bg-canvas px-1.5 text-[13px] text-ink-50 outline-none focus:border-white/30"
    />
  );
}
