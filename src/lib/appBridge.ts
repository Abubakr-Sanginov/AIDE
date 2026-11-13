import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useUi, type AppMode, type SidebarPanel } from "@/stores/ui";
import { useTabs } from "@/stores/tabs";
import { useWorkspace } from "@/stores/workspace";
import { useKins } from "@/features/kins/store";
import { useDesign, DEVICES, type Device } from "@/features/design/store";
import { cleanHtml, isAid } from "@/features/design/dom";
import { hasId } from "@/features/design/ops";
import { fail, parseStyles, projectFile } from "@/lib/bridgeArgs";
import { sessionsTool } from "@/lib/sessionsBridge";

// Bridge "agent → interface". The Rust agent (the chat agent and every Kins role use the same
// backend) calls app_state / app_navigate / design_control; they run here, next to the stores.
// Arguments come from a model, so they are untrusted: everything is validated against allowlists,
// design HTML goes through the same sanitizer as any other model output, file paths stay in the project.

interface BridgeCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

const MODES: AppMode[] = ["ide", "design", "vibe"];
const PANELS: SidebarPanel[] = ["explorer", "search", "git", "snippets", "settings"];
const RIGHT_TABS = ["chat", "kins", "browser"];
const MAX_HTML = 120_000;
const MAX_REPLY = 9_000;

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.slice(0, max) : "");
const clip = (s: string, n = MAX_REPLY) => (s.length > n ? `${s.slice(0, n)}\n…[обрезано, всего ${s.length} символов]` : s);
const isDevice = (v: string): v is Device => v in DEVICES;

function designSummary() {
  const d = useDesign.getState();
  return {
    view: d.view,
    status: d.status,
    activeFrameId: d.activeFrameId,
    selectedId: d.selectedId,
    undoSteps: d.past.length,
    frames: d.frames.map((f) => ({ id: f.id, name: f.name, device: f.device, chars: f.html.length, active: f.id === d.activeFrameId })),
  };
}

function appState(): string {
  const ui = useUi.getState();
  const tabs = useTabs.getState();
  const kins = useKins.getState();
  return JSON.stringify({
    mode: ui.mode,
    settingsOpen: ui.settingsOpen,
    rightTab: ui.rightTab,
    rightPanelVisible: ui.rightPanelVisible,
    terminalVisible: ui.terminalVisible,
    sidebarPanel: ui.activePanel,
    projectRoot: useWorkspace.getState().root,
    openFiles: tabs.tabs.map((t) => t.path),
    activeFile: tabs.tabs.find((t) => t.id === tabs.activeId)?.path ?? null,
    kins: { running: kins.running, tasks: kins.tasks.length },
    design: designSummary(),
  });
}

async function navigate(a: Record<string, unknown>): Promise<string> {
  const done: string[] = [];
  const ui = useUi.getState();
  const mode = str(a.mode, 20);
  if (mode) {
    if (!MODES.includes(mode as AppMode)) fail(`mode: допустимо ${MODES.join(", ")}`);
    useUi.setState({ settingsOpen: false });
    ui.setMode(mode as AppMode);
    done.push(`режим ${mode}`);
  }
  const panel = str(a.panel, 20);
  if (panel) {
    if (!PANELS.includes(panel as SidebarPanel)) fail(`panel: допустимо ${PANELS.join(", ")}`);
    useUi.getState().setPanel(panel as SidebarPanel);
    done.push(`панель ${panel}`);
  }
  const tab = str(a.right_tab, 20);
  if (tab) {
    if (!RIGHT_TABS.includes(tab)) fail(`right_tab: допустимо ${RIGHT_TABS.join(", ")}`);
    if (tab === "browser" && useUi.getState().mode !== "ide") useUi.setState({ settingsOpen: false, browserDock: true });
    else useUi.setState({ settingsOpen: false, rightPanelVisible: true, rightTab: tab });
    done.push(`вкладка ${tab}`);
  }
  if (typeof a.terminal === "boolean") {
    useUi.setState({ terminalVisible: a.terminal });
    done.push(a.terminal ? "терминал показан" : "терминал скрыт");
  }
  const file = str(a.open_file, 500);
  if (file) {
    const abs = projectFile(useWorkspace.getState().root, file);
    useUi.setState({ settingsOpen: false });
    if (useUi.getState().mode !== "ide") useUi.getState().setMode("ide");
    await useTabs.getState().open(abs);
    const err = useTabs.getState().error;
    if (err) fail(`Не удалось открыть файл: ${err}`);
    done.push(`открыт ${file}`);
  }
  return done.length ? `Готово: ${done.join(", ")}` : "Ничего не указано: задайте mode, panel, right_tab, terminal или open_file";
}

async function design(a: Record<string, unknown>): Promise<string> {
  const d = () => useDesign.getState();
  const action = str(a.action, 40);
  const frameId = () => {
    const id = str(a.frame_id, 80);
    if (!d().frames.some((f) => f.id === id)) fail("frame_id не найден: возьмите id из action=state");
    return id;
  };
  const elementId = () => {
    const id = str(a.element_id, 20);
    if (!isAid(id) || !hasId(d().html, id)) fail("element_id не найден в активном экране: возьмите id из get_html");
    return id;
  };
  const html = () => {
    const raw = str(a.html, MAX_HTML);
    if (!raw.trim()) fail("html пустой");
    return cleanHtml(raw);
  };
  const guardIdle = () => d().status === "streaming" && fail("Встроенный ИИ-дизайнер сейчас работает: дождитесь конца или остановите его");

  switch (action) {
    case "state":
      return JSON.stringify(designSummary());
    case "get_html":
      return clip(d().html || "(экран пустой)");
    case "set_html":
      guardIdle();
      d().commit(html());
      return "HTML активного экрана заменён (можно откатить через undo)";
    case "add_frame": {
      guardIdle();
      const device = str(a.device, 20);
      if (device && !isDevice(device)) fail("device: desktop, tablet или mobile");
      d().addFrame({ name: str(a.name, 60) || undefined, device: (device as Device) || undefined, html: str(a.html, MAX_HTML) ? html() : undefined });
      return `Экран добавлен, активен ${d().activeFrameId}`;
    }
    case "activate_frame":
      d().activateFrame(frameId());
      return "Экран активирован";
    case "delete_frame":
      guardIdle();
      d().deleteFrame(frameId());
      return "Экран удалён (undo вернёт)";
    case "rename_frame": {
      const name = str(a.name, 60).trim();
      if (!name) fail("name пустой");
      d().renameFrame(frameId(), name);
      return "Экран переименован";
    }
    case "set_device": {
      const device = str(a.device, 20);
      if (!isDevice(device)) fail("device: desktop, tablet или mobile");
      d().setFrameDevice(a.frame_id ? frameId() : d().activeFrameId, device as Device);
      return `Устройство: ${device}`;
    }
    case "select":
      d().select(elementId());
      return "Элемент выделен";
    case "update_styles": {
      guardIdle();
      const styles = parseStyles(str(a.styles, 4000));
      if (Object.keys(styles).length === 0) fail("styles: ожидается «свойство:значение;свойство:значение»");
      d().updateStyles(elementId(), styles, `bridge:${Date.now()}`);
      return `Стили применены: ${Object.keys(styles).join(", ")}`;
    }
    case "update_text":
      guardIdle();
      d().updateText(elementId(), str(a.text, 5000));
      return "Текст обновлён";
    case "delete_selected":
      guardIdle();
      if (!d().selectedId) fail("Ничего не выделено: сначала action=select");
      d().deleteSelected();
      return "Выделенное удалено (undo вернёт)";
    case "undo":
      d().undo();
      return `Откат выполнен, шагов назад осталось ${d().past.length}`;
    case "redo":
      d().redo();
      return "Шаг возвращён";
    case "set_view": {
      const view = str(a.view, 10);
      if (view !== "canvas" && view !== "code") fail("view: canvas или code");
      d().setView(view);
      return `Вид: ${view}`;
    }
    case "ask_designer": {
      guardIdle();
      const text = str(a.instruction, 4000).trim();
      if (!text) fail("instruction пустой");
      d().send(text);
      return "Задача передана ИИ-дизайнеру. Он работает в фоне: проверяйте action=state (status станет idle) и затем get_html";
    }
    case "save_to_project":
      guardIdle();
      await d().saveToProject();
      return "Дизайн записан в папку design проекта";
    default:
      return fail("Неизвестное действие. Допустимы: state, get_html, set_html, add_frame, activate_frame, delete_frame, rename_frame, set_device, select, update_styles, update_text, delete_selected, undo, redo, set_view, ask_designer, save_to_project");
  }
}

export async function runBridgeTool(tool: string, args: Record<string, unknown>): Promise<string> {
  switch (tool) {
    case "app_state":
      return appState();
    case "app_navigate":
      return navigate(args);
    case "sessions":
      return sessionsTool(args);
    case "design_control":
      if (useUi.getState().mode !== "design") {
        // The design workspace has to be on screen for the user to see what the agent does.
        useUi.setState({ settingsOpen: false });
        useUi.getState().setMode("design");
      }
      return design(args);
    default:
      return fail(`Неизвестный инструмент: ${tool}`);
  }
}

let started = false;

/** Listens to bridge calls from the Rust agent. Safe to call more than once. */
export function startAppBridge(): void {
  if (started) return;
  started = true;
  void listen<BridgeCall>("app-bridge", async (e) => {
    const { id, tool, args } = e.payload;
    let ok = true;
    let text: string;
    try {
      text = await runBridgeTool(tool, args && typeof args === "object" ? args : {});
    } catch (err) {
      ok = false;
      text = err instanceof Error ? err.message : String(err);
    }
    await invoke("app_bridge_reply", { id, ok, text }).catch(() => {});
  });
}
