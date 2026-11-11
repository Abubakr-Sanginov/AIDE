import { useEffect, useRef } from "react";
import type { SlashItem } from "@/features/chat/slash";

/** The list of commands above the chat input (opens on "/"): matched letters are bold, like in a command palette. */
export function SlashMenu({
  rows,
  index,
  onPick,
  onHover,
}: {
  rows: { item: SlashItem; hit: number[] }[];
  index: number;
  onPick: (i: number) => void;
  onHover: (i: number) => void;
}) {
  const sel = useRef<HTMLButtonElement>(null);
  useEffect(() => { sel.current?.scrollIntoView({ block: "nearest" }); }, [index]);
  return (
    <div
      role="listbox"
      className="aide-scroll aide-rise absolute bottom-full left-0 right-0 z-30 mb-1.5 max-h-72 overflow-y-auto rounded-2xl border border-line-strong bg-overlay p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
    >
      {rows.map(({ item, hit }, i) => (
        <button
          key={item.source + item.name}
          ref={i === index ? sel : undefined}
          role="option"
          aria-selected={i === index}
          // mouseDown, so the textarea keeps focus
          onMouseDown={(e) => { e.preventDefault(); onPick(i); }}
          onMouseEnter={() => onHover(i)}
          className={"flex w-full items-baseline gap-3 rounded-xl px-3 py-1.5 text-left text-[14px] " + (i === index ? "bg-white/[0.09] text-ink-50" : "text-ink-200")}
        >
          <span className="shrink-0 font-mono">
            /{[...item.name].map((ch, k) => (hit.includes(k) ? <b key={k} className="font-semibold text-ink-50">{ch}</b> : <span key={k}>{ch}</span>))}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-500">{item.desc}</span>
          {item.source !== "builtin" && <span className="shrink-0 rounded-md bg-white/[0.07] px-1.5 text-[11px] text-ink-400">{item.source === "skill" ? "skill" : "project"}</span>}
        </button>
      ))}
    </div>
  );
}
