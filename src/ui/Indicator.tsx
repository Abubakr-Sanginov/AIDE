import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

// A highlight that glides to the selected item of a tab row or segmented control.
// The host gets `ref` and must be `relative isolate` (the highlight sits behind the items);
// the selected item is found by aria-selected / aria-pressed / aria-current.

const SELECTED = '[aria-selected="true"],[aria-pressed="true"],[aria-current="true"],[aria-current="page"]';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxOf(el: HTMLElement, host: HTMLElement): Box {
  // offset* ignore transforms, so entrance animations of the items do not skew the measurement.
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== host) {
    x += n.offsetLeft;
    y += n.offsetTop;
    const parent = n.offsetParent as HTMLElement | null;
    if (!parent || (parent !== host && !host.contains(parent))) {
      // The host is not in the offset chain: fall back to on-screen geometry.
      const a = el.getBoundingClientRect();
      const b = host.getBoundingClientRect();
      return { x: a.left - b.left + host.scrollLeft, y: a.top - b.top + host.scrollTop, w: el.offsetWidth, h: el.offsetHeight };
    }
    n = parent;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

export function useIndicator<T extends HTMLElement = HTMLDivElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const measure = () => {
      const el = host.querySelector<HTMLElement>(SELECTED);
      if (!el || el.offsetWidth === 0) return setBox(null);
      const next = boxOf(el, host);
      setBox((prev) => (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    const sel = host.querySelector<HTMLElement>(SELECTED);
    if (sel) ro.observe(sel);
    return () => ro.disconnect();
  }, [dep]);
  return { ref, box };
}

export function Indicator({
  box,
  variant = "pill",
  radius = 8,
  inset = 0,
}: {
  box: Box | null;
  variant?: "pill" | "underline";
  radius?: number;
  /** Shrinks the pill by this many pixels on every side. */
  inset?: number;
}) {
  if (!box) return null;
  const style: CSSProperties =
    variant === "underline"
      ? { width: Math.max(0, box.w - 8), height: 2, transform: `translate(${box.x + 4}px, ${box.y + box.h - 2}px)` }
      : {
          width: Math.max(0, box.w - inset * 2),
          height: Math.max(0, box.h - inset * 2),
          borderRadius: radius,
          transform: `translate(${box.x + inset}px, ${box.y + inset}px)`,
        };
  return <span aria-hidden className="aide-indicator" data-variant={variant} style={style} />;
}
