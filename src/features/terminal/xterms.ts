import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// One xterm.js instance per terminal tab. It is created together with the tab (so output that
// arrives before the tab is first shown is not lost) and attached to the DOM when the tab is active.

interface Entry {
  term: Terminal;
  fit: FitAddon;
}

const entries = new Map<string, Entry>();

export function getTerm(id: string): Entry | undefined {
  return entries.get(id);
}

export function createTerm(id: string): Entry {
  const existing = entries.get(id);
  if (existing) return existing;
  const term = new Terminal({
    fontFamily: "'JetBrains Mono', Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: false,
    // Programs print errors in dark ANSI colors (black, dark blue); keep any text readable on the dark background.
    minimumContrastRatio: 4.5,
    theme: {
      background: "#121211",
      foreground: "#d6dbe3",
      cursor: "#5eead4",
      selectionBackground: "#5eead444",
      black: "#1b1a18",
      red: "#f87171",
      green: "#6ee7b7",
      yellow: "#fbbf24",
      blue: "#7dd3fc",
      magenta: "#d8b4fe",
      cyan: "#5eead4",
      white: "#d6dbe3",
      brightBlack: "#5d6a80",
      brightRed: "#fca5a5",
      brightGreen: "#a7f3d0",
      brightYellow: "#fde68a",
      brightBlue: "#bae6fd",
      brightMagenta: "#e9d5ff",
      brightCyan: "#99f6e4",
      brightWhite: "#ffffff",
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // Keystrokes go to the shell exactly as xterm produces them; the backend never interprets them.
  term.onData((data) => void invoke("terminal_write", { id, data }).catch(() => {}));
  term.onResize(({ cols, rows }) => void invoke("terminal_resize", { id, cols, rows }).catch(() => {}));
  const entry = { term, fit };
  entries.set(id, entry);
  return entry;
}

/** Shows the terminal inside `host` (moving it if it was shown elsewhere before). */
export function attachTerm(id: string, host: HTMLElement) {
  const e = entries.get(id);
  if (!e) return;
  if (!e.term.element) e.term.open(host);
  else if (e.term.element.parentElement !== host) host.appendChild(e.term.element);
  fitTerm(id);
  // The host may not be laid out in this frame yet; fit again once it is.
  requestAnimationFrame(() => fitTerm(id));
  e.term.focus();
}

export function fitTerm(id: string) {
  const e = entries.get(id);
  const host = e?.term.element?.parentElement;
  // A hidden or collapsed host measures as ~0: fitting then would shrink the grid to a few cells and the output looks blank.
  if (!e || !host || host.clientWidth < 60 || host.clientHeight < 30) return;
  try {
    e.fit.fit();
    e.term.refresh(0, e.term.rows - 1);
  } catch {
    /* not visible */
  }
}

export function writeTerm(id: string, text: string) {
  entries.get(id)?.term.write(text);
}

export function disposeTerm(id: string) {
  const e = entries.get(id);
  if (!e) return;
  e.term.dispose();
  entries.delete(id);
}
