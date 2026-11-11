import { isRuLike } from "@/i18n/ruLike";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { fs } from "@/api/fs";
import { useTabs } from "@/stores/tabs";
import { useWorkspace } from "@/stores/workspace";
import { useUi } from "@/stores/ui";
import { useTerminal } from "@/stores/terminal";

/** Terminals an extension opened: extension-side id -> our terminal tab (resolves once the shell started). */
const extTerminals = new Map<string, Promise<string | null>>();
import { applyEditsToOpenView, goToRange } from "./views";
import { forgetFrame, listenWebviewMessages, postToWebview } from "./webviews";

// Client of the extension host (src-tauri/exthost): a Node.js process that runs trusted VS Code
// extensions. Messages from the host are untrusted data: every field is type-checked before use.

export interface StatusItem {
  id: string;
  text: string;
  tooltip: string;
  command?: string;
  alignment: number;
  priority: number;
}
export interface Diag {
  range: [number, number, number, number];
  message: string;
  severity: number;
  source?: string;
}
export interface ProviderInfo {
  id: number;
  selector: { language?: string; pattern?: string; scheme?: string }[];
  triggerCharacters: string[];
}
export interface Toast {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  items: string[];
  resolve: (index: number | null) => void;
}
export type Dialog =
  | { id: string; kind: "quickpick"; items: { label: string; description?: string; detail?: string; picked?: boolean }[]; placeHolder?: string; many: boolean; resolve: (v: number | number[] | null) => void }
  | { id: string; kind: "input"; prompt?: string; value?: string; placeHolder?: string; password: boolean; resolve: (v: string | null) => void };

export interface WebviewInfo {
  id: string;
  kind: "panel" | "view";
  viewType: string;
  title: string;
  /** Bumped on every new HTML so the iframe reloads. */
  ver: number;
}
export interface ViewDef {
  viewId: string;
  name: string;
  container: string;
  ext: string;
}

export interface ManifestCommand {
  id: string;
  title: string;
  ext: string;
}

interface HostState {
  status: "off" | "starting" | "ready" | "error";
  error: string | null;
  nodeVersion: string | null;
  trusted: string[];
  extStates: Record<string, { state: string; message?: string }>;
  registered: Record<string, true>;
  manifestCommands: ManifestCommand[];
  webviews: Record<string, WebviewInfo>;
  viewDefs: ViewDef[];
  viewProviders: Record<string, true>;
  viewWebview: Record<string, string>;
  statusItems: Record<string, StatusItem>;
  outputs: Record<string, string>;
  outputOpen: string | null;
  diagnostics: Record<string, Diag[]>;
  providers: Record<string, ProviderInfo[]>;
  toasts: Toast[];
  dialogs: Dialog[];
  logs: string[];

  refreshTrust: () => Promise<void>;
  loadInfo: () => Promise<void>;
  setTrusted: (id: string, trusted: boolean) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  call: <T = unknown>(method: string, params: unknown, timeoutMs?: number) => Promise<T>;
  notify: (method: string, params: unknown) => void;
  runCommand: (id: string, args?: unknown[]) => Promise<unknown>;
  openView: (viewId: string) => Promise<void>;
  closeWebview: (id: string) => void;
  dismissToast: (id: string, index: number | null) => void;
  closeOutput: () => void;
}

const SETTINGS_KEY = "aide.ext.settings";
const DEFAULT_SETTINGS: Record<string, unknown> = {
  "editor.tabSize": 4,
  "editor.insertSpaces": true,
  "editor.formatOnSave": false,
  "files.eol": "\n",
  "files.autoSave": "off",
  "workbench.colorTheme": "Default Dark+",
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 100_000) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const errMsg = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

function readSettings(): Record<string, unknown> {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return isObj(raw) ? raw : {};
  } catch {
    return {};
  }
}

let eventsReady = false;
let nextCall = 1;
const waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();

export const useExtHost = create<HostState>((set, get) => {
  const log = (message: string) => set((s) => ({ logs: [...s.logs, message.slice(0, 4000)].slice(-300) }));
  const send = (obj: unknown) => invoke<void>("exthost_send", { line: JSON.stringify(obj) }).catch((e) => log(`send failed: ${errMsg(e)}`));
  const reply = (id: string, result: unknown, error?: string) => void send(error ? { t: "r", id, error } : { t: "r", id, result: result ?? null });

  async function sendInit() {
    const [info, list] = await Promise.all([
      invoke<{ dataDir: string; appRoot: string }>("exthost_info"),
      invoke<{ id: string; dir: string; manifest: string }[]>("exthost_extensions"),
    ]);
    const extensions = list.flatMap((e) => {
      try {
        return [{ id: e.id, dir: e.dir, manifest: JSON.parse(e.manifest) }];
      } catch {
        return [];
      }
    });
    const cmds: ManifestCommand[] = [];
    for (const e of extensions) {
      const c = isObj(e.manifest.contributes) ? e.manifest.contributes : {};
      for (const cmd of Array.isArray(c.commands) ? c.commands : []) {
        if (isObj(cmd) && typeof cmd.command === "string") cmds.push({ id: cmd.command, title: typeof cmd.title === "string" ? cmd.title : cmd.command, ext: e.id });
      }
    }
    const defs: ViewDef[] = [];
    for (const e of extensions) {
      const views = isObj(e.manifest.contributes) && isObj(e.manifest.contributes.views) ? e.manifest.contributes.views : {};
      for (const [container, list] of Object.entries(views)) {
        for (const v of Array.isArray(list) ? list : []) {
          if (isObj(v) && typeof v.id === "string" && (v.type === "webview" || v.type === undefined)) defs.push({ viewId: v.id, name: typeof v.name === "string" ? v.name : v.id, container, ext: e.id });
        }
      }
    }
    set({ manifestCommands: cmds, viewDefs: defs });
    void send({
      t: "n",
      method: "init",
      params: {
        extensions,
        workspace: useWorkspace.getState().root,
        dataDir: info.dataDir,
        appRoot: info.appRoot,
        userSettings: { ...DEFAULT_SETTINGS, ...readSettings() },
        language: isRuLike(localStorage.getItem("aide.lang")) ? "ru" : "en",
      },
    });
  }

  async function handleRequest(id: string, method: string, p: Record<string, unknown>) {
    try {
      switch (method) {
        case "window.showMessage": {
          const items = Array.isArray(p.items) ? p.items.map((x) => str(x, 100)).slice(0, 6) : [];
          const idx = await new Promise<number | null>((resolve) => {
            const toast: Toast = { id: crypto.randomUUID(), level: p.level === "error" ? "error" : p.level === "warn" ? "warn" : "info", message: str(p.message, 2000), items, resolve };
            set((s) => ({ toasts: [...s.toasts, toast].slice(-5) }));
            if (items.length === 0) window.setTimeout(() => get().dismissToast(toast.id, null), 8000);
            else window.setTimeout(() => get().dismissToast(toast.id, null), 60_000);
          });
          return reply(id, idx);
        }
        case "window.showQuickPick": {
          const items = Array.isArray(p.items) ? p.items.filter(isObj).slice(0, 2000).map((x) => ({ label: str(x.label, 300), description: str(x.description, 300) || undefined, detail: str(x.detail, 600) || undefined, picked: x.picked === true })) : [];
          const v = await new Promise<number | number[] | null>((resolve) => set((s) => ({ dialogs: [...s.dialogs, { id: crypto.randomUUID(), kind: "quickpick", items, placeHolder: str(p.placeHolder, 200) || undefined, many: p.canPickMany === true, resolve }] })));
          return reply(id, v);
        }
        case "window.showInputBox": {
          const v = await new Promise<string | null>((resolve) => set((s) => ({ dialogs: [...s.dialogs, { id: crypto.randomUUID(), kind: "input", prompt: str(p.prompt, 400) || str(p.title, 400) || undefined, value: str(p.value, 2000) || undefined, placeHolder: str(p.placeHolder, 200) || undefined, password: p.password === true, resolve }] })));
          return reply(id, v);
        }
        case "window.showTextDocument": {
          const path = str(p.path, 2000);
          await useTabs.getState().open(path);
          if (Array.isArray(p.selection)) goToRange(path, p.selection as number[]);
          return reply(id, true);
        }
        case "workspace.applyEdit": {
          const changes = Array.isArray(p.changes) ? p.changes : [];
          for (const c of changes) if (isObj(c)) await applyEdits(str(c.path, 2000), c.edits);
          return reply(id, true);
        }
        case "editor.applyEdits":
          await applyEdits(str(p.path, 2000), p.edits);
          return reply(id, true);
        case "editor.insertSnippet":
          // Snippet placeholders are inserted as plain text (tab stops are not interactive here).
          await applyEdits(str(p.path, 2000), [{ range: Array.isArray(p.at) ? p.at : [0, 0, 0, 0], newText: str(p.snippet).replace(/\$\{\d+:([^}]*)\}|\$\d+|\$\{\d+\}/g, "$1") }]);
          return reply(id, true);
        case "commands.execute":
          return reply(id, await builtinCommand(str(p.id, 200), Array.isArray(p.args) ? p.args : []));
        case "env.clipboardRead":
          return reply(id, await navigator.clipboard.readText().catch(() => ""));
        case "env.clipboardWrite":
          await navigator.clipboard.writeText(str(p.text, 1_000_000)).catch(() => {});
          return reply(id, null);
        case "env.openExternal":
          return reply(id, false);
        default:
          return reply(id, null, `unsupported request ${method}`);
      }
    } catch (e) {
      reply(id, null, errMsg(e));
    }
  }

  async function builtinCommand(id: string, args: unknown[]): Promise<unknown> {
    const tabs = useTabs.getState();
    switch (id) {
      case "workbench.action.files.save":
        if (tabs.activeId) await tabs.save(tabs.activeId);
        return null;
      case "vscode.open": {
        const first = args[0];
        const uri = typeof first === "string" ? first : isObj(first) ? str(first.fsPath) || str(first.path) : "";
        if (uri) await tabs.open(uri.replace(/^file:\/\/\/?/, "").replace(/%3A/gi, ":"));
        return null;
      }
      case "workbench.action.openView":
        return null;
      case "setContext":
      case "workbench.action.reloadWindow":
      case "revealLine":
      case "workbench.action.focusActiveEditorGroup":
        return null;
      default: {
        const s = get();
        const byContainer = id.startsWith("workbench.view.extension.") ? s.viewDefs.find((d) => d.container === id.slice("workbench.view.extension.".length) && s.viewProviders[d.viewId]) : undefined;
        const byFocus = id.endsWith(".focus") ? s.viewDefs.find((d) => d.viewId === id.slice(0, -".focus".length)) : undefined;
        const target = byContainer ?? byFocus;
        if (target) {
          await get().openView(target.viewId);
          return null;
        }
        throw new Error(`command '${id}' is not available`);
      }
    }
  }

  async function applyEdits(path: string, edits: unknown) {
    const list = (Array.isArray(edits) ? edits : [])
      .filter(isObj)
      .map((e) => ({ range: Array.isArray(e.range) ? (e.range.map((n) => num(n)) as [number, number, number, number]) : ([0, 0, 0, 0] as [number, number, number, number]), newText: str(e.newText, 5_000_000) }));
    if (list.length === 0) return;
    if (applyEditsToOpenView(path, list)) return;
    const tab = useTabs.getState().tabs.find((t) => t.path === path);
    const text = tab ? tab.content : await fs.readFile(path);
    const next = applyToString(text, list);
    if (tab) useTabs.getState().setContent(tab.id, next);
    else await fs.writeFile(path, next);
  }

  function onLine(line: string) {
    let m: unknown;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (!isObj(m)) return;
    const p = isObj(m.params) ? m.params : {};
    if (m.t === "r") {
      const w = waiting.get(str(m.id, 40));
      if (!w) return;
      waiting.delete(str(m.id, 40));
      window.clearTimeout(w.timer);
      if (typeof m.error === "string") w.reject(new Error(m.error));
      else w.resolve(m.result);
      return;
    }
    if (m.t === "q") {
      void handleRequest(str(m.id, 40), str(m.method, 80), p);
      return;
    }
    if (m.t !== "n") return;
    switch (m.method) {
      case "ready":
        void sendInit();
        break;
      case "init.done":
        set({ status: "ready" });
        window.dispatchEvent(new CustomEvent("aide-exthost-ready"));
        break;
      case "log":
        log(`[${str(p.level, 10)}] ${str(p.message, 4000)}`);
        break;
      case "ext.state":
        set((s) => ({ extStates: { ...s.extStates, [str(p.id, 100)]: { state: str(p.state, 20), message: str(p.message, 2000) || undefined } } }));
        break;
      case "commands.register":
        set((s) => ({ registered: { ...s.registered, [str(p.id, 200)]: true } }));
        break;
      case "commands.unregister":
        set((s) => {
          const r = { ...s.registered };
          delete r[str(p.id, 200)];
          return { registered: r };
        });
        break;
      case "statusbar.update": {
        const id = str(p.id, 100);
        set((s) => {
          const items = { ...s.statusItems };
          if (p.removed === true || p.visible !== true) delete items[id];
          else items[id] = { id, text: str(p.text, 300), tooltip: str(p.tooltip, 1000), command: str(p.command, 200) || undefined, alignment: num(p.alignment, 1), priority: num(p.priority) };
          return { statusItems: items };
        });
        break;
      }
      case "terminal.create": {
        const extId = str(p.id, 40);
        // Sends wait for the shell to start: they chain on this promise.
        extTerminals.set(extId, useTerminal.getState().create(undefined, str(p.name, 40) || undefined));
        break;
      }
      case "terminal.send": {
        const pending = extTerminals.get(str(p.id, 40));
        const text = str(p.text, 100_000) + (p.newline === false ? "" : "\r");
        if (pending) void pending.then((sid) => sid && invoke("terminal_write", { id: sid, data: text }).catch(() => {}));
        break;
      }
      case "terminal.show": {
        void extTerminals.get(str(p.id, 40))?.then((sid) => {
          if (!sid) return;
          useTerminal.getState().select(sid);
          useUi.setState({ dockTab: "terminal", terminalVisible: true });
        });
        break;
      }
      case "terminal.dispose": {
        const extId = str(p.id, 40);
        void extTerminals.get(extId)?.then((sid) => {
          if (sid) void useTerminal.getState().close(sid);
        });
        extTerminals.delete(extId);
        break;
      }
      case "output.append": {
        const name = str(p.name, 100);
        set((s) => ({ outputs: { ...s.outputs, [name]: ((s.outputs[name] ?? "") + str(p.text, 20_000)).slice(-200_000) } }));
        break;
      }
      case "output.clear":
        set((s) => ({ outputs: { ...s.outputs, [str(p.name, 100)]: "" } }));
        break;
      case "output.show":
        set({ outputOpen: str(p.name, 100) });
        break;
      case "diagnostics.set": {
        const key = `${str(p.name, 100)}\u0000${str(p.path, 2000)}`;
        const list: Diag[] = (Array.isArray(p.diagnostics) ? p.diagnostics : []).filter(isObj).slice(0, 2000).map((d) => ({
          range: Array.isArray(d.range) && d.range.length === 4 ? (d.range.map((n) => num(n)) as Diag["range"]) : [0, 0, 0, 0],
          message: str(d.message, 4000),
          severity: num(d.severity, 0),
          source: str(d.source, 100) || undefined,
        }));
        set((s) => {
          const diagnostics = { ...s.diagnostics };
          if (list.length === 0) delete diagnostics[key];
          else diagnostics[key] = list;
          return { diagnostics };
        });
        break;
      }
      case "provider.register": {
        const kind = str(p.kind, 40);
        const info: ProviderInfo = {
          id: num(p.id),
          selector: (Array.isArray(p.selector) ? p.selector : []).filter(isObj).map((s) => ({ language: str(s.language, 60) || undefined, pattern: str(s.pattern, 200) || undefined, scheme: str(s.scheme, 20) || undefined })),
          triggerCharacters: (Array.isArray(p.triggerCharacters) ? p.triggerCharacters : []).map((c) => str(c, 4)),
        };
        set((s) => ({ providers: { ...s.providers, [kind]: [...(s.providers[kind] ?? []), info] } }));
        break;
      }
      case "provider.unregister": {
        const kind = str(p.kind, 40);
        set((s) => ({ providers: { ...s.providers, [kind]: (s.providers[kind] ?? []).filter((x) => x.id !== num(p.id)) } }));
        break;
      }
      case "webview.viewProvider":
        set((s) => ({ viewProviders: { ...s.viewProviders, [str(p.viewId, 200)]: true } }));
        break;
      case "webview.create": {
        const id = str(p.id, 40);
        const kind = p.kind === "view" ? "view" : "panel";
        const info: WebviewInfo = { id, kind, viewType: str(p.viewType, 200), title: str(p.title, 200), ver: 0 };
        set((s) => ({ webviews: { ...s.webviews, [id]: info }, viewWebview: kind === "view" ? { ...s.viewWebview, [info.viewType]: id } : s.viewWebview }));
        if (kind === "panel") useUi.setState({ rightTab: id, rightPanelVisible: true });
        break;
      }
      case "webview.html": {
        const id = str(p.id, 40);
        void invoke("webview_set_html", { id, html: str(p.html, 16_000_000) })
          .then(() => set((s) => (s.webviews[id] ? { webviews: { ...s.webviews, [id]: { ...s.webviews[id], ver: s.webviews[id].ver + 1 } } } : s)))
          .catch((e) => log(`webview html rejected: ${errMsg(e)}`));
        break;
      }
      case "webview.title": {
        const id = str(p.id, 40);
        set((s) => (s.webviews[id] ? { webviews: { ...s.webviews, [id]: { ...s.webviews[id], title: str(p.title, 200) } } } : s));
        break;
      }
      case "webview.post":
        postToWebview(str(p.id, 40), p.message);
        break;
      case "webview.reveal":
        if (get().webviews[str(p.id, 40)]) useUi.setState({ rightTab: str(p.id, 40), rightPanelVisible: true });
        break;
      case "webview.dispose": {
        const id = str(p.id, 40);
        get().closeWebview(id);
        break;
      }
      case "config.update": {
        const settings = readSettings();
        settings[str(p.key, 200)] = p.value;
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch {
          /* storage unavailable */
        }
        break;
      }
    }
  }

  async function ensureEvents() {
    if (eventsReady) return;
    eventsReady = true;
    listenWebviewMessages((id, message) => get().notify("webview.message", { id, message }));
    await listen<{ line: string }>("exthost-line", (e) => onLine(e.payload.line));
    await listen<{ line: string }>("exthost-stderr", (e) => log(`[stderr] ${e.payload.line}`));
    await listen<{ code: number | null }>("exthost-exit", (e) => {
      for (const w of waiting.values()) {
        window.clearTimeout(w.timer);
        w.reject(new Error("Extension host stopped"));
      }
      waiting.clear();
      for (const id of Object.keys(get().webviews)) get().closeWebview(id);
      set((s) => ({ status: s.status === "error" ? "error" : "off", registered: {}, statusItems: {}, diagnostics: {}, providers: {}, extStates: {}, viewProviders: {}, error: s.status === "error" ? s.error : null }));
      log(`extension host exited (${e.payload.code ?? "?"})`);
    });
  }

  return {
    status: "off",
    error: null,
    nodeVersion: null,
    trusted: [],
    extStates: {},
    registered: {},
    manifestCommands: [],
    webviews: {},
    viewDefs: [],
    viewProviders: {},
    viewWebview: {},
    statusItems: {},
    outputs: {},
    outputOpen: null,
    diagnostics: {},
    providers: {},
    toasts: [],
    dialogs: [],
    logs: [],

    loadInfo: async () => {
      try {
        const info = await invoke<{ nodeVersion: string | null }>("exthost_info");
        set({ nodeVersion: info.nodeVersion });
      } catch {
        /* not inside Tauri */
      }
    },

    refreshTrust: async () => set({ trusted: await invoke<string[]>("ext_trust_list").catch(() => []) }),

    setTrusted: async (id, trusted) => {
      await invoke("ext_trust_set", { id, trusted });
      await get().refreshTrust();
      await get().restart();
    },

    start: async () => {
      if (get().status === "starting" || get().status === "ready") return;
      await get().refreshTrust();
      if (get().trusted.length === 0) return;
      set({ status: "starting", error: null });
      try {
        await ensureEvents();
        const info = await invoke<{ nodeVersion: string | null }>("exthost_info");
        set({ nodeVersion: info.nodeVersion });
        await invoke("exthost_start");
      } catch (e) {
        set({ status: "error", error: errMsg(e) });
      }
    },

    stop: async () => {
      try {
        if (get().status === "ready") await get().call("shutdown", {}, 3000).catch(() => {});
      } finally {
        await invoke("exthost_stop").catch(() => {});
        set({ status: "off" });
      }
    },

    restart: async () => {
      await get().stop();
      await get().start();
    },

    call: <T,>(method: string, params: unknown, timeoutMs = 15_000) =>
      new Promise<T>((resolve, reject) => {
        const id = `a${nextCall++}`;
        const timer = window.setTimeout(() => {
          waiting.delete(id);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
        waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        void send({ t: "q", id, method, params });
      }),

    notify: (method, params) => {
      if (get().status === "ready") void send({ t: "n", method, params });
    },

    runCommand: async (id, args = []) => {
      if (get().status !== "ready") throw new Error("Extension host is not running");
      return get().call("commands.execute", { id, args }, 60_000);
    },

    openView: async (viewId) => {
      const existing = get().viewWebview[viewId];
      if (existing && get().webviews[existing]) {
        useUi.setState({ rightTab: existing, rightPanelVisible: true });
        return;
      }
      const res = await get().call<{ id: string }>("webview.resolveView", { viewId }, 30_000);
      useUi.setState({ rightTab: res.id, rightPanelVisible: true });
    },

    closeWebview: (id) => {
      const w = get().webviews[id];
      if (!w) return;
      set((s) => {
        const webviews = { ...s.webviews };
        delete webviews[id];
        const viewWebview = { ...s.viewWebview };
        if (w.kind === "view") delete viewWebview[w.viewType];
        return { webviews, viewWebview };
      });
      forgetFrame(id);
      void invoke("webview_drop", { id }).catch(() => {});
      if (useUi.getState().rightTab === id) useUi.setState({ rightTab: "chat" });
    },

    dismissToast: (id, index) => {
      const t = get().toasts.find((x) => x.id === id);
      if (!t) return;
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
      t.resolve(index);
    },

    closeOutput: () => set({ outputOpen: null }),
  };
});

export function applyToString(text: string, edits: { range: [number, number, number, number]; newText: string }[]): string {
  const lines = text.split(/(?<=\n)/); // keep line endings
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) {
    starts.push(off);
    off += l.length;
  }
  const at = (line: number, ch: number) => {
    if (line >= lines.length) return text.length;
    const lineText = lines[Math.max(0, line)].replace(/\r?\n$/, "");
    return starts[Math.max(0, line)] + Math.min(Math.max(0, ch), lineText.length);
  };
  const resolved = edits.map((e) => ({ from: at(e.range[0], e.range[1]), to: at(e.range[2], e.range[3]), text: e.newText })).sort((a, b) => b.from - a.from);
  let out = text;
  for (const e of resolved) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return out;
}
