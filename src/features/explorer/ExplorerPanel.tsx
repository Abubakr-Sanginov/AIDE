import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { AIDE_PATH_MIME } from "@/lib/dnd";
import { useEffect, useState, type MouseEvent } from "react";
import {
  ChevronRight,
  ChevronsDownUp,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { fs, type FsEntry } from "@/api/fs";
import { useTree } from "@/stores/tree";
import { useTabs } from "@/stores/tabs";
import { useWorkspace } from "@/stores/workspace";
import { basename, dirname, joinPath } from "@/lib/fsUtils";
import { getFileIcon } from "@/lib/fileIcons";
import { useI18n } from "@/i18n";

/* ---------- вспомогательные типы ---------- */

interface Creating {
  dir: string;
  isDir: boolean;
}

interface TreeUi {
  creating: Creating | null;
  renaming: string | null;
  startCreate: (dir: string, isDir: boolean) => void;
  stopCreate: () => void;
  stopRename: () => void;
  openMenu: (e: MouseEvent, entry: FsEntry) => void;
}

interface MenuState {
  x: number;
  y: number;
  entry: FsEntry | null; // null = фон дерева (корень проекта)
}

/* ---------- поля ввода имени (создание / переименование) ---------- */

function NameInput({
  initial,
  placeholder,
  onConfirm,
  onCancel,
}: {
  initial?: string;
  placeholder?: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial ?? "");
  return (
    <input
      autoFocus
      value={name}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => onCancel()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && name.trim()) onConfirm(name.trim());
        if (e.key === "Escape") onCancel();
      }}
      className="w-full min-w-0 rounded border border-sky-500/60 bg-ink-950 px-1.5 py-0.5 text-[13px] text-ink-200 outline-none"
    />
  );
}

function NewEntryInput({
  dir,
  isDir,
  indent,
  onDone,
}: {
  dir: string;
  isDir: boolean;
  indent: number;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const loadDir = useTree((s) => s.loadDir);
  const openTab = useTabs((s) => s.open);
  const setError = useTabs((s) => s.setError);

  const create = async (name: string) => {
    const path = joinPath(dir, name);
    try {
      await fs.createEntry(path, isDir);
      await loadDir(dir, true);
      if (!isDir) await openTab(path); // новый файл сразу открываем
    } catch (e) {
      setError(t("explorer.errorCreate", { name, error: String(e) }));
    } finally {
      onDone();
    }
  };

  return (
    <div
      className="flex items-center gap-1.5 py-0.5 pr-2"
      style={{ paddingLeft: indent }}
    >
      <FileText size={14} className="shrink-0 text-ink-500" />
      <NameInput
        placeholder={isDir ? t("explorer.folderName") : t("explorer.fileName")}
        onConfirm={create}
        onCancel={onDone}
      />
    </div>
  );
}

function RenameInput({ entry, onDone }: { entry: FsEntry; onDone: () => void }) {
  const { t } = useI18n();
  const loadDir = useTree((s) => s.loadDir);
  const renameTab = useTabs((s) => s.rename);
  const setError = useTabs((s) => s.setError);

  const rename = async (name: string) => {
    const parent = dirname(entry.path);
    try {
      await fs.renameEntry(entry.path, name);
      renameTab(entry.path, joinPath(parent, name)); // вкладка следует за файлом
      await loadDir(parent, true);
    } catch (e) {
      setError(t("explorer.errorRename", { name: entry.name, error: String(e) }));
    } finally {
      onDone();
    }
  };

  return (
    <div className="flex items-center gap-1.5 py-0.5 pr-2">
      {entry.is_dir ? (
        <Folder size={15} fill="currentColor" strokeWidth={1.5} className="shrink-0 text-[#5b9bd5]" />
      ) : (() => {
        const fi = getFileIcon(entry.name);
        const Icon = fi.icon;
        return <Icon size={14} className={`shrink-0 ${fi.color}`} />;
      })()}
      <NameInput initial={entry.name} onConfirm={rename} onCancel={onDone} />
    </div>
  );
}

/* ---------- узел дерева ---------- */

function TreeNode({ entry, depth, ui }: { entry: FsEntry; depth: number; ui: TreeUi }) {
  const expanded = useTree((s) => s.expanded[entry.path] ?? false);
  const children = useTree((s) => s.cache[entry.path]);
  const toggleDir = useTree((s) => s.toggleDir);
  const openTab = useTabs((s) => s.open);
  const activePath = useTabs((s) => s.activeId);
  const isDirty = useTabs((s) => s.tabs.some((tab) => tab.path === entry.path && tab.dirty));
  const indent = 8 + depth * 14;
  const isActive = !entry.is_dir && entry.path === activePath;

  if (ui.renaming === entry.path) {
    return (
      <div style={{ paddingLeft: indent }}>
        <RenameInput entry={entry} onDone={ui.stopRename} />
      </div>
    );
  }

  if (entry.is_dir) {
    return (
      <div>
        <button
          onClick={() => void toggleDir(entry.path)}
          onContextMenu={(e) => ui.openMenu(e, entry)}
          style={{ paddingLeft: indent }}
          className="mx-2 flex w-[calc(100%-16px)] items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-[14.5px] text-ink-100 hover:bg-white/[0.04]"
        >
          <ChevronRight
            size={14}
            className={
              "shrink-0 text-ink-500 transition-transform duration-300 ease-[cubic-bezier(0.34,1.45,0.64,1)] " +
              (expanded ? "rotate-90 text-ink-300" : "")
            }
          />
          <Folder size={16} fill="currentColor" strokeWidth={1.5} className={"shrink-0 text-[#5b9bd5] transition-transform duration-300 " + (expanded ? "scale-110" : "")} />
          <span className="truncate">{entry.name}</span>
        </button>
        {expanded && (
          <div className="aide-tree-open">
            {ui.creating?.dir === entry.path && (
              <NewEntryInput
                dir={entry.path}
                isDir={ui.creating.isDir}
                indent={indent + 14}
                onDone={ui.stopCreate}
              />
            )}
            {children?.map((child) => (
              <TreeNode key={child.path} entry={child} depth={depth + 1} ui={ui} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => void openTab(entry.path)}
      onContextMenu={(e) => ui.openMenu(e, entry)}
      draggable
      onDragStart={(e) => {
        // Drop it on a chat to attach the file.
        e.dataTransfer.setData(AIDE_PATH_MIME, entry.path);
        e.dataTransfer.effectAllowed = "copy";
      }}
      style={{ paddingLeft: indent + 18 }}
      className={
        "mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-[14.5px] " +
        (isActive
          ? "bg-white/[0.06] text-ink-50"
          : "text-ink-200 hover:bg-white/[0.04] hover:text-ink-50")
      }
    >
      {(() => {
        const fi = getFileIcon(entry.name);
        const Icon = fi.icon;
        return <Icon size={15} className={`shrink-0 ${fi.color}`} />;
      })()}
      <span className="truncate">{entry.name}</span>
      {isDirty && <span className="size-1.5 shrink-0 rounded-full bg-sky-400" />}
    </button>
  );
}

/* ---------- контекстное меню ---------- */

function ContextMenu({
  menu,
  root,
  onClose,
  startCreate,
  startRename,
}: {
  menu: MenuState;
  root: string;
  onClose: () => void;
  startCreate: (dir: string, isDir: boolean) => void;
  startRename: (path: string) => void;
}) {
  const loadDir = useTree((s) => s.loadDir);
  const closeByPath = useTabs((s) => s.closeByPath);
  const setError = useTabs((s) => s.setError);
  const { t } = useI18n();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { entry } = menu;

  // Папка-цель для создания: сама папка, родитель файла или корень
  const targetDir = entry
    ? entry.is_dir
      ? entry.path
      : dirname(entry.path)
    : root;

  const del = async () => {
    if (!entry) return;
    try {
      await fs.deleteEntry(entry.path);
      closeByPath(entry.path); // закрываем вкладку удалённого файла
      await loadDir(dirname(entry.path), true);
    } catch (e) {
      setError(t("explorer.errorDelete", { name: entry.name, error: String(e) }));
    }
    onClose();
  };

  const left = Math.min(menu.x, window.innerWidth - 210);
  const top = Math.min(menu.y, window.innerHeight - 190);

  const item = (label: string, Icon: LucideIcon, onClick: () => void, danger = false) => (
    <button
      onClick={onClick}
      className={
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] " +
        (danger
          ? "text-red-400 hover:bg-red-500/10"
          : "text-ink-300 hover:bg-ink-700/60")
      }
    >
      <Icon size={14} className="shrink-0" />
      {label}
    </button>
  );

  return (
    <div
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-52 rounded-md border border-ink-700 bg-ink-900 py-1 shadow-xl"
    >
      {item(t("explorer.newFile"), FilePlus2, () => {
        startCreate(targetDir, false);
        onClose();
      })}
      {item(t("explorer.newFolder"), FolderPlus, () => {
        startCreate(targetDir, true);
        onClose();
      })}
      {entry && <div className="my-1 border-t border-ink-700/70" />}
      {entry &&
        item(t("explorer.rename"), Pencil, () => {
          startRename(entry.path);
          onClose();
        })}
      {entry &&
        (confirmDelete
          ? item(t("explorer.confirmDelete"), Trash2, () => void del(), true)
          : item(t("explorer.delete"), Trash2, () => setConfirmDelete(true), true))}
    </div>
  );
}

/* ---------- мелочи ---------- */

function IconBtn({
  icon: Icon,
  title,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="aide-icon-button p-1.5 disabled:opacity-40"
    >
      <Icon size={15} />
    </button>
  );
}

function EmptyState({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-[13px] text-ink-500">
      <FolderOpen size={28} strokeWidth={1.5} />
      <p>
        {t("explorer.openFolderHint")}
        <br />
        {t("explorer.openFolderHint2")}
      </p>
      <button
        onClick={onOpen}
        className="rounded-md bg-white/[0.08] px-3 py-1.5 text-[13px] text-ink-100 transition-colors hover:bg-white/[0.14]"
      >
        {t("explorer.openFolder")}
      </button>
      <p className="text-xs text-ink-600">Ctrl+O</p>
    </div>
  );
}

/* ---------- панель проводника ---------- */

export function ExplorerPanel() {
  const { t, lang } = useI18n();
  const root = useWorkspace((s) => s.root);
  const openFolder = useWorkspace((s) => s.openFolder);
  const cache = useTree((s) => s.cache);
  const error = useTree((s) => s.error);
  const loadDir = useTree((s) => s.loadDir);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    if (root) void loadDir(root);
  }, [root, loadDir]);

  // Любой клик или потеря фокуса закрывает контекстное меню.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const startCreate = (dir: string, isDir: boolean) => {
    useTree.setState((s) => ({ expanded: { ...s.expanded, [dir]: true } }));
    void loadDir(dir);
    setCreating({ dir, isDir });
  };

  const refreshAll = () => {
    for (const dir of Object.keys(useTree.getState().cache)) {
      void loadDir(dir, true);
    }
  };

  const ui: TreeUi = {
    creating,
    renaming,
    startCreate,
    stopCreate: () => setCreating(null),
    stopRename: () => setRenaming(null),
    openMenu: (e, entry) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, entry });
    },
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-0.5 px-3 pb-2 pt-1">
        <span className="mr-auto min-w-0 truncate text-[15px] font-semibold text-ink-50" title={root ?? undefined}>
          {root ? basename(root) : t("sidebar.explorer")}
        </span>
        <IconBtn
          icon={FilePlus2}
          title={t("explorer.newFile")}
          disabled={!root}
          onClick={() => root && startCreate(root, false)}
        />
        <IconBtn
          icon={FolderPlus}
          title={t("explorer.newFolder")}
          disabled={!root}
          onClick={() => root && startCreate(root, true)}
        />
        <IconBtn
          icon={ChevronsDownUp}
          title={isRuLike(lang) ? rt("Свернуть все папки") : "Collapse all folders"}
          disabled={!root}
          onClick={() => useTree.getState().collapseAll()}
        />
        <IconBtn
          icon={RefreshCw}
          title={t("explorer.refresh")}
          disabled={!root}
          onClick={refreshAll}
        />
        <IconBtn
          icon={FolderOpen}
          title={t("explorer.openFolder")}
          onClick={() => void openFolder()}
        />
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto pb-2"
        onContextMenu={(e) => {
          if (root) {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, entry: null });
          }
        }}
      >
        {!root ? (
          <EmptyState onOpen={() => void openFolder()} />
        ) : (
          <>
            {error && !cache[root] && (
              <div className="flex flex-col items-start gap-2 px-3 py-2 text-[12px] text-red-400">
                <span>{t("explorer.loadError", { error })}</span>
                <button
                  onClick={() => void loadDir(root, true)}
                  className="flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[12px] text-ink-300 transition-colors hover:bg-ink-800"
                >
                  <RefreshCw size={12} />
                  {t("explorer.refresh")}
                </button>
              </div>
            )}
            {!cache[root] && !error && (
              <div className="px-3 py-2 text-[12px] text-ink-500">
                {t("explorer.loading")}
              </div>
            )}
            {creating?.dir === root && (
              <NewEntryInput
                dir={root}
                isDir={creating.isDir}
                indent={8}
                onDone={() => setCreating(null)}
              />
            )}
            {cache[root]?.map((entry) => (
              <TreeNode key={entry.path} entry={entry} depth={0} ui={ui} />
            ))}
          </>
        )}
      </div>

      {menu && root && (
        <ContextMenu
          menu={menu}
          root={root}
          onClose={() => setMenu(null)}
          startCreate={startCreate}
          startRename={(path) => setRenaming(path)}
        />
      )}
    </div>
  );
}
