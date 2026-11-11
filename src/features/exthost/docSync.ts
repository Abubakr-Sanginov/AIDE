import { useTabs } from "@/stores/tabs";
import { languageIdForPath } from "@/features/extensions/editorExt";
import { useExtHost } from "./store";

// Keeps the extension host's TextDocuments in step with the editor tabs:
// open / change (debounced, full text) / save / close, plus the active editor.

const MAX_SYNC_BYTES = 4 * 1024 * 1024;
const known = new Map<string, { content: string; dirty: boolean; version: number }>();
let timer: number | undefined;
let lastActive: string | null = null;
let started = false;

function sync() {
  const host = useExtHost.getState();
  if (host.status !== "ready") return;
  const { tabs, activeId } = useTabs.getState();
  const seen = new Set<string>();
  for (const tab of tabs) {
    if (tab.content.length > MAX_SYNC_BYTES) continue;
    seen.add(tab.path);
    const prev = known.get(tab.path);
    if (!prev) {
      known.set(tab.path, { content: tab.content, dirty: tab.dirty, version: 1 });
      host.notify("doc.open", { path: tab.path, languageId: languageIdForPath(tab.path) ?? "plaintext", version: 1, text: tab.content });
      continue;
    }
    if (prev.content !== tab.content) {
      prev.content = tab.content;
      prev.version += 1;
      host.notify("doc.change", { path: tab.path, version: prev.version, text: tab.content });
    }
    if (prev.dirty && !tab.dirty) host.notify("doc.save", { path: tab.path });
    prev.dirty = tab.dirty;
  }
  for (const path of [...known.keys()]) {
    if (!seen.has(path)) {
      known.delete(path);
      host.notify("doc.close", { path });
    }
  }
  const active = tabs.find((t) => t.id === activeId)?.path ?? null;
  if (active !== lastActive) {
    lastActive = active;
    host.notify("editor.active", { path: active, selection: null });
  }
}

/** Sends pending changes right away (used before asking providers, so they see fresh text). */
export function flushDocs() {
  window.clearTimeout(timer);
  sync();
}

export function startDocSync() {
  if (started) return;
  started = true;
  useTabs.subscribe(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(sync, 150);
  });
  window.addEventListener("aide-exthost-ready", () => {
    known.clear();
    lastActive = null;
    sync();
  });
  useExtHost.subscribe((s, prev) => {
    if (prev.status === "ready" && s.status !== "ready") {
      known.clear();
      lastActive = null;
    }
  });
}
