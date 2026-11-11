import { useState } from "react";
import { AlertCircle, CheckCircle2, Circle, FolderOpen, Loader2, Plus, Search, Settings, Trash2 } from "lucide-react";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { Select } from "@/ui/Select";
import { basename } from "@/lib/fsUtils";
import { useChats } from "@/stores/chats";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { useAi } from "@/stores/ai";
import { KinsView } from "@/features/kins/KinsView";
import { useKins } from "@/features/kins/store";
import { useVibeText, type VibeText } from "./strings";
import { ageOf, groupOf, useTasks, type Task, type TaskStatus } from "./tasks";

const OPEN_FOLDER = "__open__";

function StatusIcon({ status }: { status: TaskStatus }) {
  const cls = "mt-0.5 shrink-0";
  if (status === "running") return <Loader2 size={14} className={cls + " animate-spin text-ink-300"} />;
  if (status === "failed") return <AlertCircle size={14} className={cls + " text-red-400"} />;
  if (status === "done") return <CheckCircle2 size={14} className={cls + " text-ink-400"} />;
  return <Circle size={14} className={cls + " text-ink-600"} />;
}

function subtitle(task: Task, T: VibeText): { text: string; tone: string } {
  if (task.status === "failed") return { text: T.failed, tone: "text-red-400" };
  if (task.status === "empty") return { text: T.notStarted, tone: "text-ink-500" };
  if (task.status === "running") return { text: T.running, tone: "text-ink-400" };
  return { text: task.snippet, tone: "text-ink-500" };
}

function ProjectPicker({ T }: { T: VibeText }) {
  const root = useWorkspace((s) => s.root);
  const recents = useWorkspace((s) => s.recents);
  const options = [
    ...(root ? [{ value: root, label: basename(root) }] : []),
    ...recents.filter((p) => p !== root).map((p) => ({ value: p, label: basename(p) })),
    { value: OPEN_FOLDER, label: T.openFolder },
  ];
  return (
    <Select
      title={T.project}
      value={root ?? ""}
      placeholder={T.noProject}
      options={options}
      onChange={(v) => {
        const ws = useWorkspace.getState();
        if (v === OPEN_FOLDER) void ws.openFolder();
        else void ws.openPath(v).catch(() => {});
      }}
      className="min-w-0 max-w-full text-[14px] font-medium text-ink-100"
      menuMinWidth={240}
    />
  );
}

const KINS_STATUS: Record<string, TaskStatus> = {
  idle: "empty",
  planning: "running",
  working: "running",
  verifying: "running",
  fixing: "running",
  done: "done",
  blocked: "failed",
  stopped: "empty",
};

function VibeSidebar() {
  const T = useVibeText();
  const chat = useTasks();
  const tab = useKins((s) => s.tab);
  const kinsTasks = useKins((s) => s.tasks);
  const kinsActive = useKins((s) => s.activeId);
  const kinsRunning = useKins((s) => s.running);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const chatStreaming = useAi((s) => s.streaming);
  const kins = tab === "kins";
  const streaming = kins ? kinsRunning : chatStreaming;

  const tasks: Task[] = kins
    ? kinsTasks.map((t) => ({
        id: t.id,
        title: t.title,
        updatedAt: t.updatedAt,
        status: KINS_STATUS[t.phase] ?? "empty",
        snippet: t.feed.length > 0 ? t.feed[t.feed.length - 1].text.replace(/\s+/g, " ").slice(0, 80) : "",
        live: false,
      }))
    : chat.tasks;
  const activeId = kins ? kinsActive : chat.activeId;
  const onNew = () => (kins ? useKins.getState().newTask() : useChats.getState().newChat());
  const onOpen = (id: string) => (kins ? useKins.getState().openTask(id) : useChats.getState().openChat(id));
  const onDelete = (id: string) => (kins ? useKins.getState().deleteTask(id) : useChats.getState().deleteChat(id));

  const q = query.trim().toLowerCase();
  const visible = q ? tasks.filter((t) => (t.title || T.untitled).toLowerCase().includes(q)) : tasks;
  const groups: { key: "today" | "yesterday" | "earlier"; label: string; items: Task[] }[] = [
    { key: "today", label: T.today, items: [] },
    { key: "yesterday", label: T.yesterday, items: [] },
    { key: "earlier", label: T.earlier, items: [] },
  ];
  for (const t of visible) groups.find((g) => g.key === groupOf(t.updatedAt))?.items.push(t);

  const row = "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[14px] text-ink-300 transition-colors hover:bg-white/[0.06] hover:text-ink-50";

  return (
    <aside className="aide-flat flex w-[272px] shrink-0 flex-col">
      <div className="flex h-11 shrink-0 items-center px-2">
        <ProjectPicker T={T} />
      </div>
      <div className="flex shrink-0 flex-col gap-0.5 px-2 pb-2">
        <button className={row} disabled={streaming} onClick={onNew}>
          <Plus size={15} />
          {T.newTask}
        </button>
        {searching ? (
          <div className="flex h-8 items-center gap-2 rounded-lg bg-white/[0.06] px-2">
            <Search size={14} className="text-ink-400" />
            <input
              autoFocus
              value={query}
              maxLength={80}
              placeholder={T.searchPlaceholder}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => !query && setSearching(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setSearching(false);
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-ink-100 outline-none placeholder:text-ink-500"
            />
          </div>
        ) : (
          <button className={row} onClick={() => setSearching(true)}>
            <Search size={15} />
            {T.search}
          </button>
        )}
      </div>

      <div className="aide-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visible.length === 0 && <div className="px-2 py-3 text-[13px] text-ink-500">{q ? T.nothingFound : T.noTasks}</div>}
        {groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <section key={g.key} className="aide-stagger mb-2">
              <h3 className="px-2 pb-1 pt-2 text-[12px] font-medium text-ink-500">{g.label}</h3>
              {g.items.map((task) => {
                const sub = subtitle(task, T);
                const active = task.id === activeId;
                return (
                  <div
                    key={task.id}
                    className={
                      "aide-lift group relative flex items-start gap-2 rounded-lg px-2 py-1.5 " +
                      (active ? "bg-white/[0.08]" : "hover:bg-white/[0.05]")
                    }
                  >
                    <StatusIcon status={task.status} />
                    <button
                      className="min-w-0 flex-1 text-left"
                      aria-current={active ? "true" : undefined}
                      onClick={() => onOpen(task.id)}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[14px] text-ink-100">{task.title || T.untitled}</span>
                        <span className="shrink-0 text-[12px] text-ink-500 group-hover:invisible">{ageOf(task.updatedAt, T)}</span>
                      </div>
                      {sub.text && <div className={"truncate text-[12.5px] " + sub.tone}>{sub.text}</div>}
                    </button>
                    {!streaming && (task.status !== "empty" || !task.live) && (
                      <button
                        title={T.deleteTask}
                        aria-label={T.deleteTask}
                        onClick={() => onDelete(task.id)}
                        className="aide-icon-button absolute right-1.5 top-1.5 hidden size-6 group-hover:flex"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
      </div>

      <div className="flex h-11 shrink-0 items-center px-2">
        <button
          className={row}
          onClick={() => {
            useUi.getState().setMode("ide");
            useUi.getState().setPanel("settings");
          }}
        >
          <Settings size={15} />
          {T.settings}
        </button>
      </div>
    </aside>
  );
}

export function VibeView() {
  const T = useVibeText();
  const root = useWorkspace((s) => s.root);
  const tab = useKins((s) => s.tab);
  return (
    <div className="flex min-h-0 flex-1 px-1.5">
      <VibeSidebar />
      {/* Stable box for the Agent / Crew switch animation. */}
      <div className="aide-vt-vibe flex min-h-0 min-w-0 flex-1">
      {tab === "kins" ? (
        <KinsView />
      ) : (
        <main className="aide-island relative mx-1.5 flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <ChatPanel variant="vibe" />
          </div>
          <div className="flex h-7 shrink-0 items-center gap-2 px-4 pb-1 text-[12px] text-ink-500">
            <FolderOpen size={12} />
            <span className="truncate">{root ? basename(root) : T.noProject}</span>
          </div>
        </main>
      )}
      </div>
    </div>
  );
}
