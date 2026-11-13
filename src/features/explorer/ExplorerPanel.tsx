import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { AIDE_PATH_MIME } from "@/lib/dnd";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
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
import {
  EMPTY_SELECTION,
  clickSelect,
  focusAfterDelete,
  isSameOrInside,
  moveSelect,
  selectAll,
  visibleRows,
  withoutNested,
  type Selection,
} from "@/lib/explorerSelection";
import { useI18n } from "@/i18n";

/* ---------- вспомогательные типы ---------- */

interface Creating {
  dir: string;
  isDir: boolean;
}

interface TreeUi {
  /** Selected paths (a click, Ctrl+click or Shift+click chooses them). */
  selected: Set<string>;
  focus: string | null;
  /** Mouse down on a row. Returns true for a plain click: then the row opens/toggles as before. */
  pick: (e: MouseEvent, entry: FsEntry) => boolean;
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
  /** Paths the menu acts on: the whole selection when the row is part of it. */
  targets: string[];
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
  const isSelected = ui.selected.has(entry.path);
  const isFocused = ui.focus === entry.path;
  const selClass = isSelected ? " bg-sky-500/20 text-ink-50" : "";
  const focusClass = isFocused ? " ring-1 ring-inset ring-sky-400/60" : "";

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
          data-path={entry.path}
          aria-selected={isSelected}
          tabIndex={-1}
          onClick={(e) => {
            if (ui.pick(e, entry)) void toggleDir(entry.path);
          }}
          onContextMenu={(e) => ui.openMenu(e, entry)}
          style={{ paddingLeft: indent }}
          className={"mx-2 flex w-[calc(100%-16px)] items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-[14.5px] text-ink-100 hover:bg-white/[0.04]" + selClass + focusClass}
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
      data-path={entry.path}
      aria-selected={isSelected}
      tabIndex={-1}
      onClick={(e) => {
        if (ui.pick(e, entry)) void openTab(entry.path);
      }}
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
        (isSelected
          ? "bg-sky-500/20 text-ink-50"
          : isActive
            ? "bg-white/[0.06] text-ink-50"
            : "text-ink-200 hover:bg-white/[0.04] hover:text-ink-50") +
        focusClass
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
  trash,
  destroy,
}: {
  menu: MenuState;
  root: string;
  onClose: () => void;
  startCreate: (dir: string, isDir: boolean) => void;
  startRename: (path: string) => void;
  trash: (paths: string[]) => void;
  destroy: (paths: string[]) => void;
}) {
  const { t, lang } = useI18n();
  const ru = isRuLike(lang);
  const { entry, targets } = menu;
  const many = targets.length > 1;
  const count = many ? ` (${targets.length})` : "";

  // Папка-цель для создания: сама папка, родитель файла или корень
  const targetDir = entry ? (entry.is_dir ? entry.path : dirname(entry.path)) : root;

  const left = Math.min(menu.x, window.innerWidth - 250);
  const top = Math.min(menu.y, window.innerHeight - 230);

  const item = (label: string, Icon: LucideIcon, onClick: () => void, opts: { danger?: boolean; hint?: string } = {}) => (
    <button
      onClick={onClick}
      className={
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] " +
        (opts.danger ? "text-red-400 hover:bg-red-500/10" : "text-ink-300 hover:bg-ink-700/60")
      }
    >
      <Icon size={14} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {opts.hint && <span className="shrink-0 text-[11px] text-ink-500">{opts.hint}</span>}
    </button>
  );

  return (
    <div
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-60 rounded-md border border-ink-700 bg-ink-900 py-1 shadow-xl"
    >
      {!many && item(t("explorer.newFile"), FilePlus2, () => {
        startCreate(targetDir, false);
        onClose();
      })}
      {!many && item(t("explorer.newFolder"), FolderPlus, () => {
        startCreate(targetDir, true);
        onClose();
      })}
      {entry && !many && <div className="my-1 border-t border-ink-700/70" />}
      {entry && !many &&
        item(t("explorer.rename"), Pencil, () => {
          startRename(entry.path);
          onClose();
        }, { hint: "F2" })}
      {entry &&
        item((ru ? rt("Удалить") : "Delete") + count, Trash2, () => {
          onClose();
          trash(targets);
        }, { danger: true, hint: "Del" })}
      {entry &&
        item((ru ? rt("Удалить навсегда") : "Delete permanently") + count, Trash2, () => {
          onClose();
          destroy(targets);
        }, { danger: true, hint: "Shift+Del" })}
    </div>
  );
}

/** Confirmation for deleting for good (Shift+Delete): Windows asks the same question. */
function ConfirmPermanent({ paths, onConfirm, onCancel }: { paths: string[]; onConfirm: () => void; onCancel: () => void }) {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const names = paths.slice(0, 5).map(basename);
  const rest = paths.length - names.length;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ru ? rt("Удалить навсегда") : "Delete permanently"}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        className="w-full max-w-sm rounded-xl border border-ink-700 bg-ink-900 p-4 shadow-2xl"
      >
        <div className="text-[14px] font-semibold text-ink-50">
          {ru
            ? rt(paths.length === 1 ? "Удалить навсегда?" : `Удалить навсегда ${paths.length} элем.?`)
            : paths.length === 1
              ? "Delete permanently?"
              : `Delete ${paths.length} items permanently?`}
        </div>
        <ul className="mt-2 space-y-0.5 text-[13px] text-ink-300">
          {names.map((n, i) => (
            <li key={i} className="truncate">{n}</li>
          ))}
          {rest > 0 && <li className="text-ink-500">{ru ? rt(`и ещё ${rest}`) : `and ${rest} more`}</li>}
        </ul>
        <p className="mt-2 text-[12.5px] leading-5 text-ink-400">
          {ru ? rt("Это нельзя отменить: файлы не попадут в корзину.") : "This cannot be undone: the files will not go to the Recycle Bin."}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md bg-white/[0.08] px-3 py-1.5 text-[13px] text-ink-100 hover:bg-white/[0.14]">
            {ru ? rt("Отмена") : "Cancel"}
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            className="rounded-md bg-red-500/80 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-red-500"
          >
            {ru ? rt("Удалить") : "Delete"}
          </button>
        </div>
      </div>
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
  const ru = isRuLike(lang);
  const root = useWorkspace((s) => s.root);
  const openFolder = useWorkspace((s) => s.openFolder);
  const cache = useTree((s) => s.cache);
  const expanded = useTree((s) => s.expanded);
  const error = useTree((s) => s.error);
  const loadDir = useTree((s) => s.loadDir);
  const setError = useTabs((s) => s.setError);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = root ? visibleRows(root, cache, expanded) : [];
  const order = rows.map((r) => r.entry.path);
  const byPath = new Map(rows.map((r) => [r.entry.path, r.entry]));
  const selected = new Set(sel.selected);

  useEffect(() => {
    if (root) void loadDir(root);
  }, [root, loadDir]);

  // Другая папка проекта — старое выделение больше не имеет смысла.
  useEffect(() => setSel(EMPTY_SELECTION), [root]);

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

  // Клавиатура двигает фокус: строка под ним всегда видна.
  useEffect(() => {
    if (!sel.focus) return;
    const el = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-path]") ?? [])].find((n) => n.dataset.path === sel.focus);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel.focus]);

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

  /** Delete (Recycle Bin) or Shift+Delete (for good) for the given paths; the tree, tabs and focus follow. */
  const removePaths = async (paths: string[], permanent: boolean) => {
    const targets = withoutNested(paths);
    if (targets.length === 0) return;
    const nextFocus = focusAfterDelete(order, targets);
    try {
      const report = permanent ? await fs.deleteEntries(targets) : await fs.trashEntries(targets);
      for (const p of report.done) {
        // Вкладки удалённых файлов (и файлов внутри удалённых папок) закрываем.
        for (const tab of useTabs.getState().tabs) if (isSameOrInside(tab.path, p)) useTabs.getState().closeByPath(tab.path);
      }
      await Promise.all([...new Set(targets.map(dirname))].map((d) => loadDir(d, true)));
      setSel(nextFocus ? { selected: [nextFocus], anchor: nextFocus, focus: nextFocus } : EMPTY_SELECTION);
      if (report.failed.length > 0) {
        setError(t("explorer.errorDelete", { name: report.failed.slice(0, 3).join("; "), error: "" }).replace(/:\s*$/, ""));
      }
    } catch (e) {
      const msg = String(e);
      // Нет корзины (не Windows): предлагаем удалить насовсем с подтверждением.
      if (!permanent && /только в Windows/i.test(msg)) setConfirm(targets);
      else setError(t("explorer.errorDelete", { name: targets.map(basename).slice(0, 3).join(", "), error: msg }));
    }
  };

  const ui: TreeUi = {
    selected,
    focus: sel.focus,
    pick: (e, entry) => {
      const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
      listRef.current?.focus({ preventScroll: true });
      setSel((s) => clickSelect(s, order, entry.path, mods));
      return !mods.ctrl && !mods.shift;
    },
    creating,
    renaming,
    startCreate,
    stopCreate: () => setCreating(null),
    stopRename: () => setRenaming(null),
    openMenu: (e, entry) => {
      e.preventDefault();
      e.stopPropagation();
      // Правый клик по выделенному оставляет выделение; по другой строке выделяет её одну.
      const inSelection = selected.has(entry.path);
      if (!inSelection) setSel({ selected: [entry.path], anchor: entry.path, focus: entry.path });
      setMenu({ x: e.clientX, y: e.clientY, entry, targets: inSelection ? sel.selected : [entry.path] });
    },
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || !root) return; // имя файла вводится: клавиши не трогаем
    const ctrl = e.ctrlKey || e.metaKey;
    const focusEntry = sel.focus ? byPath.get(sel.focus) : undefined;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        handled();
        setSel((s) => moveSelect(s, order, e.key === "ArrowDown" ? "down" : "up", e.shiftKey));
        return;
      case "Home":
      case "End":
        handled();
        setSel((s) => moveSelect(s, order, e.key === "Home" ? "home" : "end", e.shiftKey));
        return;
      case "ArrowRight":
        if (focusEntry?.is_dir) {
          handled();
          if (!expanded[focusEntry.path]) void useTree.getState().toggleDir(focusEntry.path);
          else {
            const i = order.indexOf(focusEntry.path);
            if (order[i + 1] && isSameOrInside(order[i + 1], focusEntry.path)) setSel((s) => moveSelect(s, order, "down", false));
          }
        }
        return;
      case "ArrowLeft":
        if (focusEntry) {
          handled();
          if (focusEntry.is_dir && expanded[focusEntry.path]) void useTree.getState().toggleDir(focusEntry.path);
          else {
            const parent = dirname(focusEntry.path);
            if (parent !== root && byPath.has(parent)) setSel({ selected: [parent], anchor: parent, focus: parent });
          }
        }
        return;
      case "Enter":
        if (focusEntry) {
          handled();
          if (focusEntry.is_dir) void useTree.getState().toggleDir(focusEntry.path);
          else void useTabs.getState().open(focusEntry.path);
        }
        return;
      case "F2":
        if (focusEntry && sel.selected.length <= 1) {
          handled();
          setRenaming(focusEntry.path);
        }
        return;
      case "Escape":
        if (sel.selected.length > 0) {
          handled();
          setSel((s) => ({ ...s, selected: [] }));
        }
        return;
      case "Delete":
        if (sel.selected.length > 0) {
          handled();
          if (e.shiftKey) setConfirm(withoutNested(sel.selected));
          else void removePaths(sel.selected, false);
        }
        return;
      default:
        if (ctrl && e.key.toLowerCase() === "a") {
          handled();
          setSel(selectAll(order));
        }
    }
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
          title={ru ? rt("Свернуть все папки") : "Collapse all folders"}
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
        ref={listRef}
        tabIndex={0}
        role="tree"
        aria-multiselectable="true"
        aria-label={t("sidebar.explorer")}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto pb-2 outline-none"
        onClick={(e) => {
          // Клик по пустому месту снимает выделение, как в проводнике Windows.
          if (e.target === e.currentTarget) setSel(EMPTY_SELECTION);
        }}
        onContextMenu={(e) => {
          if (root) {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, entry: null, targets: [] });
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
          trash={(paths) => void removePaths(paths, false)}
          destroy={(paths) => setConfirm(withoutNested(paths))}
        />
      )}
      {confirm && (
        <ConfirmPermanent
          paths={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const paths = confirm;
            setConfirm(null);
            void removePaths(paths, true);
          }}
        />
      )}
    </div>
  );
}
