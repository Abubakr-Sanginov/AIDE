// Plumbing between extension webviews (iframes served from the aideext: scheme) and the host.
// An iframe lives in its own origin; the only channel is window.postMessage, validated here.

interface Frame {
  win: Window | null;
  queue: unknown[];
}
const frames = new Map<string, Frame>();
let handler: ((id: string, message: unknown) => void) | null = null;
let listening = false;

const frameOf = (id: string): Frame => {
  let f = frames.get(id);
  if (!f) {
    f = { win: null, queue: [] };
    frames.set(id, f);
  }
  return f;
};

export function attachFrame(id: string, win: Window | null) {
  const f = frameOf(id);
  f.win = win;
  if (win) {
    for (const m of f.queue.splice(0)) win.postMessage({ __aide: "toWebview", message: m }, "*");
  }
}

export function forgetFrame(id: string) {
  frames.delete(id);
}

export function postToWebview(id: string, message: unknown) {
  const f = frameOf(id);
  if (f.win) f.win.postMessage({ __aide: "toWebview", message }, "*");
  else if (f.queue.length < 200) f.queue.push(message);
}

export function listenWebviewMessages(cb: (id: string, message: unknown) => void) {
  handler = cb;
  if (listening) return;
  listening = true;
  window.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { __aide?: string; id?: unknown; message?: unknown } | null;
    if (!d || d.__aide !== "webview" || typeof d.id !== "string") return;
    // Only accept messages from the iframe that owns this id.
    const f = frames.get(d.id);
    if (!f || !f.win || e.source !== f.win) return;
    handler?.(d.id, d.message);
  });
}

export const WEBVIEW_ORIGIN = "http://aideext.localhost";
