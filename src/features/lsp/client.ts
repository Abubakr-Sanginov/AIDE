import { listen } from "@tauri-apps/api/event";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  LSPClient,
  LSPPlugin,
  Workspace,
  jumpToDefinition,
  languageServerExtensions,
  type Transport,
  type WorkspaceFile,
} from "@codemirror/lsp-client";
import { create } from "zustand";
import { lspApi } from "@/api/lsp";
import { useTabs } from "@/stores/tabs";
import { useWorkspace } from "@/stores/workspace";
import { viewFor } from "@/features/exthost/views";
import { useExtHost, type Diag } from "@/features/exthost/store";
import { sanitizeLspHtml } from "@/features/lsp/sanitize";
import { normalizeUri } from "@/features/lsp/uri";

// Language servers in the editor: completion by types, hover docs, go to definition (F12), references (Shift+F12),
// rename (F2), format (Shift+Alt+F) and errors. The server process lives in Rust (src-tauri/src/lsp.rs);
// this file only connects CodeMirror's LSP client to it over Tauri events.

const STORAGE_KEY = "aide.lsp";
const MAX_RESTARTS = 2;

export type LspState = "starting" | "ready" | "error" | "stopped";

interface LspStore {
  enabled: boolean;
  /** Last known state per server id, with a message for errors. */
  status: Record<string, { state: LspState; message: string }>;
  setEnabled: (on: boolean) => void;
}

export const useLsp = create<LspStore>((set) => ({
  enabled: (() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "0";
    } catch {
      return true;
    }
  })(),
  status: {},
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch {
      /* storage unavailable: the choice lasts for this session */
    }
    set({ enabled });
    if (!enabled) disconnectAll();
  },
}));

class AideFile implements WorkspaceFile {
  constructor(
    public uri: string,
    public languageId: string,
    public version: number,
    public doc: EditorView["state"]["doc"],
    public view: EditorView,
  ) {}
  getView() {
    return this.view;
  }
}

class AideWorkspace extends Workspace {
  files: AideFile[] = [];
  private versions: Record<string, number> = Object.create(null);

  private nextVersion(uri: string) {
    return (this.versions[uri] = (this.versions[uri] ?? -1) + 1);
  }

  getFile(uri: string): WorkspaceFile | null {
    const key = normalizeUri(uri);
    return this.files.find((f) => normalizeUri(f.uri) === key) ?? null;
  }

  syncFiles() {
    const result = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin) continue;
      const changes = plugin.unsyncedChanges;
      if (!changes.empty) {
        result.push({ changes, file, prevDoc: file.doc });
        file.doc = file.view.state.doc;
        file.version = this.nextVersion(file.uri);
        plugin.clear();
      }
    }
    return result;
  }

  openFile(uri: string, languageId: string, view: EditorView) {
    const existing = this.getFile(uri);
    if (existing) this.closeFile(existing.uri);
    const file = new AideFile(uri, languageId, this.nextVersion(uri), view.state.doc, view);
    this.files.push(file);
    this.client.didOpen(file);
  }

  closeFile(uri: string) {
    const file = this.getFile(uri);
    if (!file) return;
    this.files = this.files.filter((f) => f !== file);
    this.client.didClose(file.uri);
  }

  /** Go to definition in another file: open its tab and wait for the editor to appear. */
  async displayFile(uri: string): Promise<EditorView | null> {
    const open = this.getFile(uri);
    if (open) {
      const path = await lspApi.pathForUri(open.uri);
      if (path) await useTabs.getState().open(path);
      return open.getView();
    }
    const path = await lspApi.pathForUri(uri);
    if (!path) return null;
    await useTabs.getState().open(path);
    for (let i = 0; i < 60; i++) {
      const view = viewFor(path);
      if (view) return view;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }
}

interface Conn {
  client: LSPClient;
  transport: Transport;
  restarts: number;
}

const conns = new Map<string, Promise<Conn | null>>();
let eventsReady: Promise<void> | null = null;
const handlers = new Map<string, Set<(m: string) => void>>();

/** file:///d%3A/x/a.ts → the open tab's own path when it is open (exact case), else D:\x\a.ts. */
function pathFromUri(uri: string): string {
  let p = uri.replace(/^file:\/\//i, "");
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep encoded */
  }
  if (/^\/[a-zA-Z]:/.test(p)) p = (p[1].toUpperCase() + p.slice(2)).replace(/\//g, "\\");
  const key = normalizeUri(uri);
  const tab = useTabs.getState().tabs.find((t) => normalizeUri("file:///" + t.path) === key);
  return tab ? tab.path : p;
}

/** Language-server errors also go to the Problems panel and the status bar counter (shared diagnostics store). */
function publishToProblems(server: string, raw: string) {
  if (!raw.includes('"textDocument/publishDiagnostics"')) return;
  let msg: { params?: { uri?: string; diagnostics?: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; message: string; severity?: number; source?: string }[] } };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const uri = msg.params?.uri;
  if (!uri) return;
  const key = `lsp:${server}\u0000${pathFromUri(uri)}`;
  const list: Diag[] = (msg.params?.diagnostics ?? []).map((d) => ({
    range: [d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character],
    message: d.message,
    severity: Math.max(0, (d.severity ?? 1) - 1),
    source: d.source,
  }));
  useExtHost.setState((s) => {
    const next = { ...s.diagnostics };
    if (list.length) next[key] = list;
    else delete next[key];
    return { diagnostics: next };
  });
}

function clearProblems() {
  useExtHost.setState((s) => ({
    diagnostics: Object.fromEntries(Object.entries(s.diagnostics).filter(([k]) => !k.startsWith("lsp:"))),
  }));
}

function ensureEvents() {
  if (eventsReady) return eventsReady;
  eventsReady = (async () => {
    await listen<{ server: string; message: string }>("lsp-message", (e) => {
      publishToProblems(e.payload.server, e.payload.message);
      handlers.get(e.payload.server)?.forEach((h) => h(e.payload.message));
    });
    await listen<{ server: string; state: LspState; message: string }>("lsp-status", (e) => {
      const { server, state, message } = e.payload;
      useLsp.setState((s) => ({ status: { ...s.status, [server]: { state, message } } }));
      if (state === "stopped") void restart(server);
    });
  })();
  return eventsReady;
}

async function connect(server: string): Promise<Conn | null> {
  await ensureEvents();
  try {
    // Start (and initialize) the server first: the client's own initialize is then answered at once.
    await lspApi.start(server);
  } catch (e) {
    useLsp.setState((s) => ({ status: { ...s.status, [server]: { state: "error", message: String(e) } } }));
    return null;
  }
  const subs = new Set<(m: string) => void>();
  handlers.set(server, subs);
  const transport: Transport = {
    send: (message) => {
      void lspApi.send(server, message).catch((err) => console.warn("[lsp]", server, err));
    },
    subscribe: (h) => subs.add(h),
    unsubscribe: (h) => subs.delete(h),
  };
  const client = new LSPClient({
    workspace: (c) => new AideWorkspace(c),
    timeout: 20000,
    sanitizeHTML: sanitizeLspHtml,
    extensions: languageServerExtensions(),
  }).connect(transport);
  return { client, transport, restarts: 0 };
}

/** The server process ended (crash, killed): start it again and re-open the editors' files. */
async function restart(server: string) {
  const pending = conns.get(server);
  if (!pending) return;
  const conn = await pending;
  if (!conn || conn.restarts >= MAX_RESTARTS || !useLsp.getState().enabled) return;
  conn.restarts += 1;
  conn.client.disconnect();
  try {
    await lspApi.start(server);
    conn.client.connect(conn.transport);
  } catch (e) {
    console.warn("[lsp] restart failed", server, e);
  }
}

function getClient(server: string): Promise<Conn | null> {
  let c = conns.get(server);
  if (!c) {
    c = connect(server);
    conns.set(server, c);
    // A failed start is not cached forever: the next editor may try again (e.g. after installing the server).
    void c.then((r) => {
      if (!r) conns.delete(server);
    });
  }
  return c;
}

function disconnectAll() {
  const all = [...conns.values()];
  conns.clear();
  clearProblems();
  for (const p of all) void p.then((c) => c?.client.disconnect());
}

/** CodeMirror extension that connects this file's editor to its language server, or [] if there is none. */
export async function lspExtensionFor(path: string): Promise<Extension> {
  if (!useLsp.getState().enabled) return [];
  let info;
  try {
    info = await lspApi.forPath(path);
  } catch {
    return [];
  }
  if (!info || !info.available) return [];
  const conn = await getClient(info.server);
  if (!conn) return [];
  return [conn.client.plugin(info.uri, info.languageId), ctrlClickDefinition];
}

// Ctrl/Cmd+click on a name → go to its definition (like VS Code). F12 does the same, but in dev builds WebView2 keeps
// F12 for its DevTools. Only in files with a language server: elsewhere Ctrl+click still adds a cursor (Alt+click always does).
const ctrlClickDefinition = Prec.highest(
  EditorView.domEventHandlers({
    mousedown(e, view) {
      const mod = navigator.platform.toLowerCase().includes("mac") ? e.metaKey : e.ctrlKey;
      if (!mod || e.button !== 0 || e.altKey || e.shiftKey) return false;
      if (!LSPPlugin.get(view)) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return false;
      e.preventDefault();
      view.dispatch({ selection: { anchor: pos } });
      jumpToDefinition(view);
      return true;
    },
  }),
);

// Another project: Rust stops its servers; drop our clients too so the next editors connect afresh.
let lastRoot = useWorkspace.getState().root;
useWorkspace.subscribe((s) => {
  if (s.root !== lastRoot) {
    lastRoot = s.root;
    disconnectAll();
  }
});
