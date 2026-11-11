import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronsDown,
  ChevronsUp,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  Group,
  Heading1,
  ImageIcon,
  Link2,
  Lock,
  LockOpen,
  Minus,
  MousePointerClick,
  Rows2,
  Scissors,
  Square,
  TextCursorInput,
  Trash2,
  Type,
  Ungroup,
  ArrowDown,
  ArrowUp,
  type LucideIcon,
} from "lucide-react";
import type { PresetId } from "@/features/design/ops";
import { liveEl } from "@/features/design/live";
import { useDesign } from "@/features/design/store";
import { useDesignText } from "@/features/design/strings";

export const PRESET_ICONS: Record<PresetId, LucideIcon> = {
  text: Type,
  heading: Heading1,
  button: MousePointerClick,
  box: Square,
  row: Rows2,
  image: ImageIcon,
  input: TextCursorInput,
  divider: Minus,
  link: Link2,
};

export const PRESET_ORDER: PresetId[] = ["text", "heading", "button", "box", "row", "image", "input", "divider", "link"];

function useOutsideClose(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [ref, onClose]);
}

function Item({
  icon: Icon,
  label,
  hint,
  danger,
  disabled,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:opacity-35 " +
        (danger ? "text-red-300 enabled:hover:bg-red-500/15" : "text-ink-100 enabled:hover:bg-white/[0.07]")
      }
    >
      {Icon ? <Icon size={14} className="shrink-0 text-ink-400" /> : <span className="w-3.5" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 font-mono text-[11px] text-ink-500">{hint}</span>}
    </button>
  );
}

function Sep() {
  return <div className="my-1 h-px bg-line" />;
}

function Panel({ children, style, panelRef }: { children: ReactNode; style: React.CSSProperties; panelRef: React.RefObject<HTMLDivElement | null> }) {
  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className="aide-fade-in fixed z-[70] w-56 rounded-xl border border-line-strong bg-overlay p-1 shadow-2xl shadow-black/60"
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Right-click menu for the canvas. */
export function ContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const T = useDesignText();
  const ref = useRef<HTMLDivElement>(null);
  const selectedId = useDesign((s) => s.selectedId);
  const hasSel = selectedId !== null;
  const clipboard = useDesign((s) => s.clipboard);
  useOutsideClose(ref, onClose);

  const el = liveEl(selectedId);
  const hidden = el?.style.display === "none";
  const locked = !!el?.hasAttribute("data-locked");
  const st = useDesign.getState();
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const left = Math.min(x, window.innerWidth - 232);
  const top = Math.min(y, window.innerHeight - 460);

  return (
    <Panel panelRef={ref} style={{ left, top }}>
      <Item icon={CopyPlus} label={T.duplicate} hint="Ctrl+D" disabled={!hasSel} onClick={run(() => st.duplicateSelected())} />
      <Item icon={Copy} label={T.copy} hint="Ctrl+C" disabled={!hasSel} onClick={run(() => st.copySelected())} />
      <Item icon={Scissors} label={T.cut} hint="Ctrl+X" disabled={!hasSel} onClick={run(() => st.cutSelected())} />
      <Item icon={ClipboardPaste} label={T.paste} hint="Ctrl+V" disabled={!clipboard} onClick={run(() => st.paste())} />
      <Sep />
      <Item icon={ChevronsUp} label={T.bringFront} disabled={!hasSel} onClick={run(() => st.reorder("front"))} />
      <Item icon={ArrowUp} label={T.bringForward} hint="]" disabled={!hasSel} onClick={run(() => st.reorder("forward"))} />
      <Item icon={ArrowDown} label={T.sendBackward} hint="[" disabled={!hasSel} onClick={run(() => st.reorder("backward"))} />
      <Item icon={ChevronsDown} label={T.sendBack} disabled={!hasSel} onClick={run(() => st.reorder("back"))} />
      <Sep />
      <Item icon={Group} label={T.group} hint="Ctrl+G" disabled={!hasSel} onClick={run(() => st.group())} />
      <Item icon={Ungroup} label={T.ungroup} hint="Ctrl+⇧+G" disabled={!hasSel} onClick={run(() => st.ungroup())} />
      <Item
        icon={hidden ? Eye : EyeOff}
        label={hidden ? T.show : T.hide}
        disabled={!hasSel}
        onClick={run(() => selectedId && st.toggleHidden(selectedId))}
      />
      <Item
        icon={locked ? LockOpen : Lock}
        label={locked ? T.unlock : T.lock}
        disabled={!hasSel}
        onClick={run(() => selectedId && st.toggleLocked(selectedId))}
      />
      <Sep />
      <Item icon={Trash2} label={T.deleteEl} hint="Del" danger disabled={!hasSel} onClick={run(() => st.deleteSelected())} />
    </Panel>
  );
}

/** "Insert" popover shown above the bottom toolbar. */
export function InsertMenu({ onPick, onClose }: { onPick: (id: PresetId) => void; onClose: () => void }) {
  const T = useDesignText();
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, onClose);
  const labels: Record<PresetId, string> = {
    text: T.elText,
    heading: T.elHeading,
    button: T.elButton,
    box: T.elBox,
    row: T.elRow,
    image: T.elImage,
    input: T.elInput,
    divider: T.elDivider,
    link: T.elLink,
  };
  return (
    <div
      ref={ref}
      className="aide-fade-in absolute bottom-full left-1/2 mb-2 w-52 -translate-x-1/2 rounded-xl border border-line-strong bg-overlay p-1 shadow-2xl shadow-black/60"
    >
      {PRESET_ORDER.map((id) => (
        <Item key={id} icon={PRESET_ICONS[id]} label={labels[id]} onClick={() => onPick(id)} />
      ))}
    </div>
  );
}
