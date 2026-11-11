import {
  StateEffect,
  StateField,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet,
  WidgetType,
} from "@codemirror/view";
import { useInlineEdit } from "@/stores/inlineEdit";
import { t } from "@/i18n/t";

export const inlineEditEffect = StateEffect.define<Range<Decoration>[]>();

export const inlineEditField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(inlineEditEffect)) {
        next = e.value.length ? Decoration.set(e.value, true) : Decoration.none;
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function setInlineEditDecos(view: EditorView, decos: Range<Decoration>[]) {
  view.dispatch({ effects: inlineEditEffect.of(decos) });
}

export function diffLines(oldText: string, newText: string): {
  removed: number[];
  added: string[];
} {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const removed: number[] = [];
  if (a.length * b.length > 1_000_000) {
    for (let i = 0; i < a.length; i++) removed.push(i);
    return { removed, added: b };
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removed.push(i);
      i++;
    } else {
      added.push(b[j]);
      j++;
    }
  }
  while (i < a.length) {
    removed.push(i);
    i++;
  }
  while (j < b.length) {
    added.push(b[j]);
    j++;
  }
  return { removed, added };
}

export function removedLineMarks(
  view: EditorView,
  from: number,
  original: string,
  replacement: string,
): Range<Decoration>[] {
  const { removed } = diffLines(original, replacement);
  const startLine = view.state.doc.lineAt(from).number;
  return removed.map((idx) => {
    const lineNo = Math.min(startLine + idx, view.state.doc.lines);
    return Decoration.line({ class: "cm-inline-removed" }).range(
      view.state.doc.line(lineNo).from,
    );
  });
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

export class InlineEditWidget extends WidgetType {
  constructor(
    private status: "input" | "streaming" | "done" | "error",
    private replacement: string,
    private error: string | null,
  ) {
    super();
  }

  eq() {
    return false;
  }

  toDOM(): HTMLElement {
    const edit = useInlineEdit.getState();
    const wrap = el("div", "aide-inline-edit");

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (edit.status === "streaming") {
          edit.cancel();
        } else {
          edit.close();
        }
      } else if (e.key === "Tab" && edit.status === "done") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("aide-inline-accept"));
      }
    };
    wrap.addEventListener("keydown", handleKey);

    if (this.status === "input") {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = t("inlineEdit.placeholder");
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && input.value.trim()) {
          e.preventDefault();
          useInlineEdit.getState().submit(input.value.trim());
        }
      });
      wrap.appendChild(input);
      const hint = el("div", "hint", t("inlineEdit.hint"));
      wrap.appendChild(hint);
      requestAnimationFrame(() => input.focus());
      return wrap;
    }

    if (this.status === "streaming") {
      const row = el("div", "actions");
      row.appendChild(el("span", "hint", t("inlineEdit.generating")));
      row.appendChild(button(t("common.cancel"), () => useInlineEdit.getState().cancel()));
      wrap.appendChild(row);
      const preview = el("div", "preview", this.replacement + "▍");
      wrap.appendChild(preview);
      requestAnimationFrame(() => {
        preview.scrollTop = preview.scrollHeight;
      });
      return wrap;
    }

    if (this.status === "error") {
      wrap.appendChild(el("div", "error", this.error ?? t("inlineEdit.unknownError")));
      const row = el("div", "actions");
      row.appendChild(button(t("common.retry"), () => useInlineEdit.getState().retry()));
      row.appendChild(button(t("common.cancel"), () => useInlineEdit.getState().close()));
      wrap.appendChild(row);
      return wrap;
    }

    const preview = el("div", "preview", this.replacement);
    wrap.appendChild(preview);
    const row = el("div", "actions");
    row.appendChild(button(t("inlineEdit.accept"), () => {
      window.dispatchEvent(new CustomEvent("aide-inline-accept"));
    }));
    row.appendChild(button(t("inlineEdit.reject"), () => useInlineEdit.getState().close()));
    wrap.appendChild(row);
    return wrap;
  }
}