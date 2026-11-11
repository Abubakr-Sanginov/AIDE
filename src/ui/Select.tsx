import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { useI18n } from "@/i18n";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** "ghost": borderless text button (toolbars). "field": bordered full-width input look. */
  variant?: "ghost" | "field";
  title?: string;
  className?: string;
  /** Minimum menu width in px (menu is at least as wide as the trigger). */
  menuMinWidth?: number;
  /** Show a filter box. Defaults to true when there are many options. */
  searchable?: boolean;
  placeholder?: string;
}

const MENU_MAX_HEIGHT = 320;
const GAP = 6;

// Fully custom dropdown: portal-rendered menu, themed scrollbar, keyboard
// navigation, type-to-filter. Replaces the native <select> popup.
export function Select({
  value,
  options,
  onChange,
  variant = "ghost",
  title,
  className = "",
  menuMinWidth = 160,
  searchable,
  placeholder = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const { t } = useI18n();

  const showSearch = searchable ?? options.length > 8;
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    const up = below < 180 && above > below;
    const maxHeight = Math.max(120, Math.min(MENU_MAX_HEIGHT, up ? above : below));
    const width = Math.max(r.width, menuMinWidth);
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    setPos({ left, width, maxHeight, up, top: up ? r.top - GAP : r.bottom + GAP });
  }, [menuMinWidth]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onResize = () => close();
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onResize);
    };
  }, [open, close]);

  // Start with the current value highlighted; focus the filter or the list.
  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, filtered.findIndex((o) => o.value === value));
    setActive(idx);
    requestAnimationFrame(() => {
      if (showSearch) searchRef.current?.focus();
      else listRef.current?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (v: string) => {
    onChange(v);
    close();
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(filtered.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[active];
      if (item) choose(item.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      close();
    }
  };

  const triggerClass =
    variant === "field"
      ? "flex w-full items-center justify-between gap-2 rounded-lg border border-line-strong bg-canvas px-2.5 py-1.5 text-left text-[13px] text-ink-100 transition-colors hover:border-white/25"
      : "flex max-w-full items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-400 transition-colors hover:bg-white/[0.05] hover:text-ink-100";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`${triggerClass} ${open ? "bg-white/[0.06] text-ink-50" : ""} ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={variant === "field" ? 14 : 12}
          className={`shrink-0 text-ink-500 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
              maxHeight: pos.maxHeight,
            }}
            className={"aide-drop z-[100] flex flex-col overflow-hidden rounded-xl border border-line-strong bg-overlay shadow-2xl shadow-black/60 " + (pos.up ? "origin-bottom" : "origin-top")}
            onKeyDown={onKeyDown}
          >
            {showSearch && (
              <div className="flex shrink-0 items-center gap-2 border-b border-line px-2.5">
                <Search size={13} className="shrink-0 text-ink-500" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("sidebar.search")}
                  spellCheck={false}
                  className="h-9 w-full bg-transparent text-[13px] text-ink-100 placeholder:text-ink-500 outline-none"
                />
              </div>
            )}
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              data-noanim
              tabIndex={-1}
              className="aide-scroll aide-stagger min-h-0 flex-1 overflow-y-auto p-1 outline-none"
            >
              {filtered.length === 0 && <div className="px-3 py-2 text-[13px] text-ink-500">—</div>}
              {filtered.map((o, i) => {
                const isSel = o.value === value;
                return (
                  <div
                    key={o.value}
                    role="option"
                    aria-selected={isSel}
                    data-idx={i}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => choose(o.value)}
                    className={
                      "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-75 " +
                      (i === active ? "bg-white/[0.07] text-ink-50" : "text-ink-200")
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {isSel && <Check size={13} className="shrink-0 text-ink-300" />}
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
