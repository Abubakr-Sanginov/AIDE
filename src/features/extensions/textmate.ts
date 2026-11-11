import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { INITIAL, Registry, parseRawGrammar, type IGrammar, type StateStack } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import onigWasmUrl from "vscode-oniguruma/release/onig.wasm?url";
import { extApi, type ExtInfo, type VsTheme } from "./manifest";

// TextMate highlighting for languages CodeMirror has no parser for (grammars come from
// installed VS Code extensions). Grammars are data; the regex engine is a bundled WASM
// module loaded from our own origin. Tokens are colored with the active VS Code theme.

let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  wasmReady ??= fetch(onigWasmUrl)
    .then((r) => r.arrayBuffer())
    .then((buf) => loadWASM(buf));
  return wasmReady;
}

const DEFAULT_RULES = [
  { scope: ["comment"], settings: { foreground: "#7f848e", fontStyle: "italic" } },
  { scope: ["string"], settings: { foreground: "#98c379" } },
  { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#d19a66" } },
  { scope: ["keyword", "storage"], settings: { foreground: "#c678dd" } },
  { scope: ["entity.name.function", "support.function"], settings: { foreground: "#61afef" } },
  { scope: ["entity.name.type", "entity.name.class", "support.class", "support.type"], settings: { foreground: "#e5c07b" } },
  { scope: ["variable"], settings: { foreground: "#e06c75" } },
  { scope: ["entity.name.tag"], settings: { foreground: "#e06c75" } },
  { scope: ["entity.other.attribute-name"], settings: { foreground: "#d19a66" } },
];

interface Loaded {
  registry: Registry;
  grammars: Map<string, { ext: string; path: string }>;
}
let cache: { key: string; loaded: Loaded } | null = null;

function registryFor(exts: ExtInfo[], theme: VsTheme | null, key: string): Loaded {
  if (cache?.key === key) return cache.loaded;
  const grammars = new Map<string, { ext: string; path: string }>();
  for (const e of exts) for (const g of e.grammars) grammars.set(g.scopeName, { ext: e.id, path: g.path });
  const fg = theme?.colors["editor.foreground"] ?? "#e6ebf1";
  const rules = theme && theme.tokenColors.length > 0 ? theme.tokenColors : DEFAULT_RULES;
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources: string[]) => new OnigScanner(sources),
      createOnigString: (s: string) => new OnigString(s),
    }),
    theme: { name: theme?.name ?? "default", settings: [{ settings: { foreground: fg } }, ...rules] } as never,
    loadGrammar: async (scopeName: string) => {
      const g = grammars.get(scopeName);
      if (!g) return null;
      try {
        return parseRawGrammar(await extApi.read(g.ext, g.path), g.path);
      } catch {
        return null;
      }
    },
  });
  const loaded = { registry, grammars };
  cache = { key, loaded };
  return loaded;
}

const MAX_LINE = 4000;

function plugin(grammar: IGrammar, colors: string[]): Extension {
  const marks = new Map<string, Decoration>();
  const markFor = (fg: number, fontStyle: number): Decoration | null => {
    const color = colors[fg];
    if (!color) return null;
    const k = `${fg}:${fontStyle}`;
    let m = marks.get(k);
    if (!m) {
      let style = `color:${color}`;
      if (fontStyle & 1) style += ";font-style:italic";
      if (fontStyle & 2) style += ";font-weight:bold";
      if (fontStyle & 4) style += ";text-decoration:underline";
      m = Decoration.mark({ attributes: { style } });
      marks.set(k, m);
    }
    return m;
  };

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      /** states[i] = rule stack at the start of line i+1 */
      states: StateStack[] = [INITIAL];
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) {
          let first = Infinity;
          u.changes.iterChangedRanges((fromA) => {
            first = Math.min(first, u.startState.doc.lineAt(fromA).number);
          });
          this.states.length = Math.max(1, Math.min(this.states.length, first));
        }
        if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
      }
      tokenize(text: string, state: StateStack) {
        return text.length > MAX_LINE
          ? { tokens: new Uint32Array(0), ruleStack: state }
          : grammar.tokenizeLine2(text, state, 15);
      }
      build(view: EditorView): DecorationSet {
        const doc = view.state.doc;
        const { from, to } = view.viewport;
        const firstLine = doc.lineAt(from).number;
        const lastLine = doc.lineAt(Math.min(to, doc.length)).number;
        // advance cached states up to the end of the viewport
        for (let n = this.states.length; n <= lastLine; n++) {
          this.states[n] = this.tokenize(doc.line(n).text, this.states[n - 1]).ruleStack;
        }
        const builder = new RangeSetBuilder<Decoration>();
        for (let n = firstLine; n <= lastLine; n++) {
          const line = doc.line(n);
          const { tokens } = this.tokenize(line.text, this.states[n - 1]);
          for (let i = 0; i < tokens.length; i += 2) {
            const start = tokens[i];
            const end = i + 2 < tokens.length ? tokens[i + 2] : line.length;
            const meta = tokens[i + 1];
            const mark = end > start ? markFor((meta & 0x00ff8000) >>> 15, (meta & 0x00007800) >>> 11) : null;
            if (mark) builder.add(line.from + start, line.from + end, mark);
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/** Returns a highlighter for `scopeName`, or null when no installed grammar matches. */
export async function textmateExtension(exts: ExtInfo[], theme: VsTheme | null, key: string, scopeName: string): Promise<Extension | null> {
  try {
    await ensureWasm();
    const { registry, grammars } = registryFor(exts, theme, key);
    if (!grammars.has(scopeName)) return null;
    const grammar = await registry.loadGrammar(scopeName);
    if (!grammar) return null;
    return plugin(grammar, registry.getColorMap());
  } catch {
    return null;
  }
}
