import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface TerminalOutputEvent {
  /** Terminal tab; empty for agent output (shown in the active tab). */
  id: string;
  data: string;
  is_err: boolean;
}

export type ShellKind = "cmd" | "powershell" | "pwsh" | "bash" | "wsl";

export const terminal = {
  spawn: (id: string, shell: ShellKind, cols: number, rows: number) => invoke<void>("terminal_spawn", { id, shell, cols, rows }),
  kill: (id: string) => invoke<void>("terminal_kill", { id }),
  shells: () => invoke<ShellKind[]>("terminal_shells"),
};

function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let unlisten: (() => void) | undefined;
  void listen<T>(event, (e) => cb(e.payload)).then((fn) => (unlisten = fn));
  return () => unlisten?.();
}

export const onTerminalOutput = (cb: (e: TerminalOutputEvent) => void) =>
  subscribe<TerminalOutputEvent>("terminal-output", cb);

export const onTerminalExit = (cb: (e: { id: string }) => void) => subscribe<{ id: string }>("terminal-exit", cb);
