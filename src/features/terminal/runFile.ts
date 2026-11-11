import { rt } from "@/i18n/tgMap";
import { invoke } from "@tauri-apps/api/core";
import { useTabs } from "@/stores/tabs";
import { useTerminal } from "@/stores/terminal";
import { useUi } from "@/stores/ui";

// "Run file": types the command for the file's language into a terminal tab and leaves the terminal
// open, like the Run button in the editor title of VS Code. The command comes from this fixed table;
// the only variable part is the file path, which must be free of characters a shell would treat specially.

interface Runner {
  label: { ru: string; en: string };
  command: (quotedPath: string) => string;
}

const RUNNERS: Record<string, Runner> = {
  py: { label: { ru: "Запустить файл Python", en: "Run Python File" }, command: (p) => `python ${p}` },
  js: { label: { ru: "Запустить в Node.js", en: "Run with Node.js" }, command: (p) => `node ${p}` },
  mjs: { label: { ru: "Запустить в Node.js", en: "Run with Node.js" }, command: (p) => `node ${p}` },
  cjs: { label: { ru: "Запустить в Node.js", en: "Run with Node.js" }, command: (p) => `node ${p}` },
  ps1: { label: { ru: "Запустить скрипт PowerShell", en: "Run PowerShell Script" }, command: (p) => `powershell -NoProfile -File ${p}` },
  bat: { label: { ru: "Запустить bat-файл", en: "Run Batch File" }, command: (p) => `call ${p}` },
  cmd: { label: { ru: "Запустить cmd-файл", en: "Run Batch File" }, command: (p) => `call ${p}` },
  sh: { label: { ru: "Запустить скрипт sh", en: "Run Shell Script" }, command: (p) => `bash ${p}` },
};

export function runnerFor(fileName: string): Runner | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return fileName.includes(".") ? (RUNNERS[ext] ?? null) : null;
}

const SAFE_PATH = /^[^"%$`!\r\n&|<>^;]+$/;

export async function runFile(tabId: string, dedicated = false): Promise<string | null> {
  const tabs = useTabs.getState();
  const tab = tabs.tabs.find((t) => t.id === tabId);
  if (!tab) return null;
  const runner = runnerFor(tab.name);
  if (!runner) return null;
  if (!SAFE_PATH.test(tab.path)) return rt("В пути к файлу есть символы, с которыми запуск из терминала небезопасен");
  if (tab.dirty) await tabs.save(tabId);

  useUi.setState({ dockTab: "terminal", terminalVisible: true });
  const term = useTerminal.getState();
  await term.ensure();
  let id = useTerminal.getState().activeId;
  const active = useTerminal.getState().sessions.find((s) => s.id === id);
  if (!id || !active?.alive || dedicated) {
    await term.create();
    id = useTerminal.getState().activeId;
  }
  if (!id) return rt("Не удалось открыть терминал");
  try {
    await invoke("terminal_write", { id, data: runner.command(`"${tab.path}"`) + "\r" });
  } catch (e) {
    return String(e);
  }
  return null;
}
