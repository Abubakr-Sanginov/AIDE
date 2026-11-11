import { rt } from "@/i18n/tgMap";
import { create } from "zustand";
import { terminal, onTerminalOutput, onTerminalExit, type ShellKind } from "@/api/terminal";
import { createTerm, disposeTerm, getTerm, writeTerm } from "@/features/terminal/xterms";

export interface TerminalSession {
  id: string;
  shell: ShellKind;
  title: string;
  alive: boolean;
}

export const MAX_TERMINALS = 100;

export const SHELL_LABEL: Record<ShellKind, string> = {
  cmd: "Command Prompt",
  powershell: "PowerShell",
  pwsh: "PowerShell 7",
  bash: "Git Bash",
  wsl: "WSL",
};

interface TerminalState {
  sessions: TerminalSession[];
  activeId: string | null;
  shells: ShellKind[];
  lastShell: ShellKind;
  /** Open a new tab with the given shell (default: the one used last). */
  create: (shell?: ShellKind, title?: string) => Promise<string | null>;
  /** Make sure at least one tab exists. */
  ensure: () => Promise<void>;
  select: (id: string) => void;
  close: (id: string) => Promise<void>;
  restart: (id: string) => Promise<void>;
  clear: (id: string) => void;
  loadShells: () => Promise<void>;
}

const patch = (sessions: TerminalSession[], id: string, f: (s: TerminalSession) => TerminalSession) =>
  sessions.map((s) => (s.id === id ? f(s) : s));

function newId(): string {
  return "t" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/** "PowerShell", then "PowerShell (2)", … so 100 tabs stay distinguishable. */
function nextTitle(sessions: TerminalSession[], shell: ShellKind): string {
  const base = SHELL_LABEL[shell];
  const used = new Set(sessions.map((s) => s.title));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} (${n})`)) return `${base} (${n})`;
}

async function start(id: string, shell: ShellKind) {
  const { term } = createTerm(id);
  try {
    await terminal.spawn(id, shell, term.cols, term.rows);
    useTerminal.setState((s) => ({ sessions: patch(s.sessions, id, (x) => ({ ...x, alive: true })) }));
  } catch (e) {
    writeTerm(id, `\x1b[31m${String(e)}\x1b[0m\r\n`);
  }
}

export const useTerminal = create<TerminalState>((set, get) => ({
  sessions: [],
  activeId: null,
  shells: ["cmd"],
  lastShell: "cmd",
  loadShells: async () => {
    try {
      const shells = await terminal.shells();
      if (shells.length > 0) set({ shells });
    } catch {
      /* keep default */
    }
  },
  create: async (shell, title) => {
    const { sessions, lastShell } = get();
    if (sessions.length >= MAX_TERMINALS) return null;
    const kind = shell ?? lastShell;
    const id = newId();
    set({ sessions: [...sessions, { id, shell: kind, title: title ? title.slice(0, 40) : nextTitle(sessions, kind), alive: false }], activeId: id, lastShell: kind });
    await start(id, kind);
    return id;
  },
  ensure: async () => {
    if (get().sessions.length === 0) await get().create();
  },
  select: (id) => set({ activeId: id }),
  close: async (id) => {
    try {
      await terminal.kill(id);
    } catch {
      /* already gone */
    }
    disposeTerm(id);
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.id === id);
      const sessions = s.sessions.filter((x) => x.id !== id);
      const activeId = s.activeId === id ? (sessions[Math.min(idx, sessions.length - 1)]?.id ?? null) : s.activeId;
      return { sessions, activeId };
    });
  },
  restart: async (id) => {
    const cur = get().sessions.find((x) => x.id === id);
    if (!cur) return;
    try {
      await terminal.kill(id);
    } catch {
      /* already gone */
    }
    getTerm(id)?.term.reset();
    set((s) => ({ sessions: patch(s.sessions, id, (x) => ({ ...x, alive: false })) }));
    await start(id, cur.shell);
  },
  clear: (id) => getTerm(id)?.term.clear(),
}));

let inited = false;
export function ensureTerminalEvents() {
  if (inited) return;
  inited = true;
  void useTerminal.getState().loadShells();
  onTerminalOutput((e) => {
    if (!e.data) return;
    // Agent commands (no tab id) are echoed into the visible tab; terminals expect CRLF.
    const target = e.id || useTerminal.getState().activeId;
    if (!target) return;
    writeTerm(target, e.id ? e.data : e.data.replace(/\r?\n/g, "\r\n"));
  });
  onTerminalExit((e) => {
    writeTerm(e.id, `\r\n\x1b[90m${rt("[процесс завершён]")}\x1b[0m\r\n`);
    useTerminal.setState((s) => ({ sessions: patch(s.sessions, e.id, (x) => ({ ...x, alive: false })) }));
  });
}
