import { useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

interface Props {
  axis: "x" | "y";
  /** Current size of the panel being resized, in px. */
  value: number;
  /** Receives the next size. The store clamps it. */
  onChange: (next: number) => void;
  /** true when dragging toward the start (left/up) should grow the panel. */
  invert?: boolean;
  label: string;
}

// Generic drag handle for resizable islands. Uses pointer capture so the drag
// keeps working when the cursor leaves the thin hit area.
export function ResizeHandle({ axis, value, onChange, invert = false, label }: Props) {
  const [active, setActive] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const start = axis === "x" ? e.clientX : e.clientY;
    const startValue = value;
    setActive(true);
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";

    const move = (ev: PointerEvent) => {
      const pos = axis === "x" ? ev.clientX : ev.clientY;
      const delta = invert ? start - pos : pos - start;
      onChange(startValue + delta);
    };
    const stop = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", stop);
      target.removeEventListener("pointercancel", stop);
      document.body.style.cursor = "";
      setActive(false);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 32 : 8;
    const dec = axis === "x" ? "ArrowLeft" : "ArrowUp";
    const inc = axis === "x" ? "ArrowRight" : "ArrowDown";
    if (e.key !== dec && e.key !== inc) return;
    e.preventDefault();
    const sign = (e.key === inc ? 1 : -1) * (invert ? -1 : 1);
    onChange(value + sign * step);
  };

  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      tabIndex={0}
      data-axis={axis}
      data-active={active}
      className="aide-resize"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
