import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { Files, Search, MessageSquare, History, Trash2, type LucideIcon } from "lucide-react";
import { useWorkspace } from "@/stores/workspace";
import { useRecent } from "@/stores/recent";
import { useCommands } from "@/stores/commands";
import { useUi } from "@/stores/ui";
import { useI18n } from "@/i18n";
import { basename } from "@/lib/fsUtils";

interface Row {
  icon: LucideIcon;
  label: string;
  keys: string[];
  onClick: () => void;
}

export function WelcomeScreen() {
  const { t, lang } = useI18n();
  const ru = isRuLike(lang);
  const toggleChat = useUi((s) => s.toggleRightPanel);
  const openPath = useWorkspace((s) => s.openPath);
  const recents = useWorkspace((s) => s.recents);
  const removeRecent = useWorkspace((s) => s.removeRecent);
  const openRecent = useRecent((s) => s.open);
  const openPalette = useCommands((s) => s.openWithT);
  const setPanel = useUi((s) => s.setPanel);

  const rows: Row[] = [
    { icon: Files, label: ru ? rt("Файлы и команды") : "Files and commands", keys: ["Ctrl", "P"], onClick: () => openPalette(t as (key: string) => string) },
    { icon: Search, label: ru ? rt("Поиск по проекту") : "Search the project", keys: ["Ctrl", "Shift", "F"], onClick: () => setPanel("search") },
    {
      icon: MessageSquare,
      label: ru ? rt("Спросить агента") : "Ask the agent",
      keys: [],
      onClick: () => {
        if (!useUi.getState().rightPanelVisible) toggleChat();
        useUi.getState().setRightTab("chat");
      },
    },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 select-none items-center justify-center overflow-auto px-8 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aide-ambient" />
      </div>
      <div className="aide-stagger relative w-full max-w-[420px]">
        <img src="/logo.svg" alt="" draggable={false} className="aide-float mb-5 size-16 rounded-[20px] shadow-[0_12px_40px_-8px_rgba(94,234,212,0.5)]" />
        <h1 className="text-[29px] font-semibold tracking-tight text-ink-50">AIDE</h1>
        <p className="mt-3 text-[14px] leading-6 text-ink-300">{ru ? rt("Откройте код, найдите нужное или начните с задачи для агента.") : "Open code, find what you need, or start with a task for the agent."}</p>

        <ul className="aide-stagger mt-7 space-y-0.5">
          {rows.map(({ icon: Icon, label, keys, onClick }) => (
            <li key={label}>
              <button
                onClick={onClick}
                className="aide-lift group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[14px] text-ink-100 hover:bg-white/[0.05] hover:text-ink-50"
              >
                <Icon size={17} className="shrink-0 text-ink-400 transition-transform duration-300 group-hover:scale-115 group-hover:text-teal-200" />
                <span className="flex-1 truncate first-letter:uppercase">{label}</span>
                <span className="flex gap-1">
                  {keys.map((k) => (
                    <kbd key={k} className="aide-kbd">{k}</kbd>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {recents.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-2 flex items-center gap-2 px-2 text-[12px] font-medium text-ink-500">
              <History size={13} />
              {t("workspace.recent")}
              <button
                onClick={openRecent}
                className="ml-auto rounded p-1 text-ink-500 hover:bg-white/[0.06] hover:text-ink-200"
                title={ru ? "Все проекты (Ctrl+R)" : "All projects (Ctrl+R)"}
              >
                <Search size={13} />
              </button>
            </h2>
            <ul className="aide-stagger">
              {recents.slice(0, 5).map((path) => (
                <li key={path} className="group relative">
                  <button
                    onClick={() => void openPath(path).catch(() => {})}
                    title={path}
                    className="aide-lift flex w-full items-baseline gap-3 rounded-lg px-2 py-1.5 pr-8 text-left hover:bg-white/[0.05]"
                  >
                    <span className="shrink-0 text-[13px] text-ink-200">{basename(path)}</span>
                    <span className="min-w-0 truncate font-mono text-[11px] text-ink-600">{path}</span>
                  </button>
                  <button
                    onClick={() => removeRecent(path)}
                    aria-label={`${t("common.delete")}: ${basename(path)}`}
                    title={t("common.delete")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-500 opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-ink-200 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
