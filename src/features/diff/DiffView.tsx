import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FileText, FoldVertical, X } from "lucide-react";
import { EditorState } from "@codemirror/state";
import { EditorView, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { MergeView, goToNextChunk, goToPreviousChunk } from "@codemirror/merge";
import { fmt, useFeatureText } from "@/i18n/features";
import { useTabs } from "@/stores/tabs";
import { languageForPath } from "@/lib/editorLang";
import { editorTheme } from "@/lib/editorTheme";
import { appearanceFor } from "@/lib/editorAppearance";
import { useDiff, type DiffDoc } from "@/features/diff/store";

// Side-by-side, read-only comparison. Both panes are aligned and scroll together.
export function DiffView({ doc }: { doc: DiffDoc }) {
  const ft = useFeatureText();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | null>(null);
  const [collapse, setCollapse] = useState(true);
  const [chunks, setChunks] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ext = [
      lineNumbers(),
      highlightSpecialChars(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      keymap.of([...defaultKeymap, ...searchKeymap]),
      editorTheme,
      appearanceFor(),
      languageForPath(doc.path),
    ];
    const view = new MergeView({
      a: { doc: doc.left, extensions: ext },
      b: { doc: doc.right, extensions: ext },
      parent: host,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: collapse ? { margin: 3, minSize: 6 } : undefined,
    });
    viewRef.current = view;
    setChunks(view.chunks.length);
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [doc.nonce, collapse]);

  const jump = (dir: 1 | -1) => {
    const v = viewRef.current?.b;
    if (!v) return;
    (dir === 1 ? goToNextChunk : goToPreviousChunk)(v);
    v.focus();
  };

  const btn = "flex size-7 items-center justify-center rounded-md text-ink-500 hover:bg-white/[0.06] hover:text-ink-100 disabled:opacity-40";

  return (
    <div className="flex min-h-0 flex-1 flex-col" role="region" aria-label={doc.title}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.055] px-3 text-[12px]">
        <span className="truncate font-medium text-ink-100" title={doc.path}>
          {doc.title}
        </span>
        <span className="shrink-0 text-ink-500">
          {doc.leftLabel} ↔ {doc.rightLabel}
        </span>
        <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-ink-300">
          {chunks === 0 ? ft.diffNoChanges : fmt(ft.diffChanges, { n: chunks })}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button className={btn} title={ft.diffPrev} aria-label={ft.diffPrev} disabled={chunks === 0} onClick={() => jump(-1)}>
            <ChevronUp size={14} />
          </button>
          <button className={btn} title={ft.diffNext} aria-label={ft.diffNext} disabled={chunks === 0} onClick={() => jump(1)}>
            <ChevronDown size={14} />
          </button>
          <button
            className={btn + (collapse ? " bg-white/[0.06] text-ink-100" : "")}
            title={ft.diffCollapse}
            aria-label={ft.diffCollapse}
            aria-pressed={collapse}
            onClick={() => setCollapse((c) => !c)}
          >
            <FoldVertical size={14} />
          </button>
          <button className={btn} title={ft.openFile} aria-label={ft.openFile} onClick={() => void useTabs.getState().open(doc.path)}>
            <FileText size={14} />
          </button>
          <button className={btn} title={ft.diffClose} aria-label={ft.diffClose} onClick={() => useDiff.getState().close()}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="grid shrink-0 grid-cols-2 border-b border-white/[0.04] text-[11px] text-ink-500">
        <span className="truncate px-3 py-1">{doc.leftLabel}</span>
        <span className="truncate border-l border-white/[0.04] px-3 py-1">{doc.rightLabel}</span>
      </div>
      <div ref={hostRef} className="aide-diff min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}
