import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Atom, Check, Code2, Component, Flame, Loader2, Rocket, Triangle, X, type LucideIcon } from "lucide-react";
import { useI18n } from "@/i18n";
import { useDesign } from "@/features/design/store";
import { useWorkspace } from "@/stores/workspace";
import { basename } from "@/lib/fsUtils";
import { STACKS, createFromDesign, validFolder, type CodeLang, type CssKind, type StackId } from "@/features/design/project";

const ICONS: Record<StackId, LucideIcon> = {
  html: Code2,
  react: Atom,
  vue: Component,
  svelte: Flame,
  next: Triangle,
  astro: Rocket,
};

const PREFS_KEY = "aide.design.create";

interface Prefs {
  stack: StackId;
  lang: CodeLang;
  css: CssKind;
  routing: boolean;
  responsive: boolean;
  runAfter: boolean;
}

const DEFAULTS: Prefs = { stack: "react", lang: "ts", css: "plain", routing: true, responsive: true, runAfter: true };

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return {
      stack: STACKS.some((s) => s.id === raw.stack) ? (raw.stack as StackId) : DEFAULTS.stack,
      lang: raw.lang === "js" ? "js" : "ts",
      css: raw.css === "tailwind" ? "tailwind" : "plain",
      routing: raw.routing !== false,
      responsive: raw.responsive !== false,
      runAfter: raw.runAfter !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

function Segmented<T extends string>({ value, options, onChange, disabled }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="group" className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={
            "h-9 flex-1 rounded-xl border text-[13px] transition-colors disabled:opacity-60 " +
            (value === o.id ? "border-white/30 bg-white/[0.1] text-ink-50" : "border-line-strong text-ink-400 hover:bg-white/[0.05] hover:text-ink-100")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Check2({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-50"
    >
      <span
        className={
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-md border transition-colors " +
          (checked ? "border-teal-300 bg-teal-300 text-canvas" : "border-line-strong text-transparent")
        }
      >
        <Check size={11} strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] text-ink-100">{label}</span>
        {hint && <span className="block text-[12px] leading-4 text-ink-500">{hint}</span>}
      </span>
    </button>
  );
}

/** "Create in project": pick the stack and options; the design becomes a project of that stack. */
export function CreateProjectDialog() {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const open = useDesign((s) => s.createDialog);
  const frames = useDesign((s) => s.frames);
  const root = useWorkspace((s) => s.root);
  const close = () => useDesign.getState().setCreateDialog(false);

  const filled = useMemo(() => frames.filter((f) => f.html.trim()), [frames]);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [folder, setFolder] = useState("app");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every time the dialog opens: all screens selected, a free-looking folder name.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setPicked(filled.map((f) => f.id));
    setFolder((cur) => (validFolder(cur) ? cur : "app"));
  }, [open, filled]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) useDesign.getState().setCreateDialog(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  if (!open) return null;

  const stack = STACKS.find((s) => s.id === prefs.stack) ?? STACKS[0];
  const set = (p: Partial<Prefs>) => setPrefs((cur) => ({ ...cur, ...p }));
  const folderOk = validFolder(folder);
  const canSubmit = !busy && folderOk && picked.length > 0 && !!root;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* preferences are a convenience only */
    }
    const res = await createFromDesign({ ...prefs, folder, frameIds: picked }, frames, lang);
    setBusy(false);
    if (res.ok) close();
    else setError(res.error);
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-[8vh]" onPointerDown={() => !busy && close()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ru ? rt("Создать в проекте") : "Create in project"}
        className="aide-pop w-full max-w-[600px] rounded-3xl border border-line-strong bg-overlay p-5 shadow-2xl shadow-black/70"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-ink-50">{ru ? rt("Создать в проекте") : "Create in project"}</h2>
          <button onClick={close} disabled={busy} aria-label={ru ? rt("Закрыть") : "Close"} className="aide-icon-button size-8 disabled:opacity-40">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-[13px] leading-5 text-ink-400">
          {lang === "tg"
            ? `Стекро интихоб кунед: тарроҳӣ ба лоиҳа табдил мешавад${root ? ` дар «${basename(root)}»` : ""}. Барои фреймворкҳо лоиҳаро агент аз рӯи экранҳои шумо месозад.`
            : ru
            ? `Выберите стек: дизайн станет проектом${root ? ` в «${basename(root)}»` : ""}. Для фреймворков проект соберёт агент по вашим экранам.`
            : `Pick a stack: the design becomes a project${root ? ` in "${basename(root)}"` : ""}. For frameworks, the agent builds it from your screens.`}
        </p>

        <div className="mb-1.5 text-[12.5px] text-ink-300">{ru ? rt("Стек") : "Stack"}</div>
        <div role="radiogroup" className="aide-stagger grid grid-cols-2 gap-2 sm:grid-cols-3">
          {STACKS.map((s) => {
            const Icon = ICONS[s.id];
            const on = prefs.stack === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy}
                onClick={() => set({ stack: s.id })}
                className={
                  "aide-lift flex flex-col items-start gap-1 rounded-2xl border p-3 text-left disabled:opacity-60 " +
                  (on ? "border-teal-300/60 bg-teal-300/[0.08] text-ink-50" : "border-line-strong text-ink-200 hover:bg-white/[0.04]")
                }
              >
                <Icon size={18} className={on ? "text-teal-200" : "text-ink-400"} />
                <span className="text-[13.5px] font-medium">{s.name}</span>
                <span className="text-[11.5px] leading-4 text-ink-500">{ru ? rt(s.blurb.ru) : s.blurb.en}</span>
              </button>
            );
          })}
        </div>

        {(stack.typed || stack.tailwind) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {stack.typed && (
              <div>
                <div className="mb-1.5 text-[12.5px] text-ink-300">{ru ? rt("Язык") : "Language"}</div>
                <Segmented<CodeLang>
                  value={prefs.lang}
                  disabled={busy}
                  onChange={(v) => set({ lang: v })}
                  options={[
                    { id: "ts", label: "TypeScript" },
                    { id: "js", label: "JavaScript" },
                  ]}
                />
              </div>
            )}
            {stack.tailwind && (
              <div>
                <div className="mb-1.5 text-[12.5px] text-ink-300">{ru ? rt("Стили") : "Styles"}</div>
                <Segmented<CssKind>
                  value={prefs.css}
                  disabled={busy}
                  onChange={(v) => set({ css: v })}
                  options={[
                    { id: "plain", label: "CSS" },
                    { id: "tailwind", label: "Tailwind" },
                  ]}
                />
              </div>
            )}
          </div>
        )}

        <div className="mb-1.5 mt-4 text-[12.5px] text-ink-300">{lang === "tg" ? `Экранҳо (${picked.length} аз ${filled.length})` : ru ? `Экраны (${picked.length} из ${filled.length})` : `Screens (${picked.length} of ${filled.length})`}</div>
        <div className="aide-scroll max-h-36 overflow-y-auto rounded-2xl border border-line p-1">
          {filled.map((f) => (
            <Check2
              key={f.id}
              checked={picked.includes(f.id)}
              disabled={busy}
              onChange={(v) => setPicked((cur) => (v ? [...cur, f.id] : cur.filter((x) => x !== f.id)))}
              label={f.name}
              hint={f.device === "desktop" ? (ru ? rt("компьютер") : "desktop") : f.device === "tablet" ? (ru ? rt("планшет") : "tablet") : ru ? rt("телефон") : "phone"}
            />
          ))}
        </div>

        {stack.id !== "html" && (
          <div className="mt-3 space-y-0.5">
            <Check2 checked={prefs.routing} disabled={busy} onChange={(v) => set({ routing: v })} label={ru ? rt("Навигация между экранами") : "Navigation between screens"} hint={ru ? rt("Роутинг, рабочие ссылки меню") : "Routing, working menu links"} />
            <Check2 checked={prefs.responsive} disabled={busy} onChange={(v) => set({ responsive: v })} label={ru ? rt("Адаптивная вёрстка") : "Responsive layout"} hint={ru ? rt("Десктоп, планшет и телефон") : "Desktop, tablet and phone"} />
            <Check2 checked={prefs.runAfter} disabled={busy} onChange={(v) => set({ runAfter: v })} label={ru ? rt("Предложить установку и запуск") : "Offer to install and run"} hint={ru ? rt("npm install и npm run dev, с вашим подтверждением") : "npm install and npm run dev, with your approval"} />
          </div>
        )}

        <label className="mb-1.5 mt-4 block text-[12.5px] text-ink-300" htmlFor="create-folder">
          {ru ? rt("Папка в проекте") : "Folder in the project"}
        </label>
        <input
          id="create-folder"
          value={folder}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setFolder(e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          aria-invalid={!folderOk}
          className={
            "h-10 w-full rounded-xl border bg-canvas px-3 font-mono text-[13.5px] text-ink-100 outline-none transition-colors disabled:opacity-60 " +
            (folderOk ? "border-line-strong focus:border-white/30" : "border-red-400/60")
          }
        />
        {!folderOk && <div className="mt-1 text-[12px] text-red-400">{ru ? rt("Латиница, цифры, - и _, до 40 символов.") : "Letters, digits, - and _, up to 40 characters."}</div>}
        {!root && <div className="mt-2 text-[12.5px] text-amber-300">{ru ? rt("Сначала откройте папку проекта (режим IDE).") : "Open a project folder first (IDE mode)."}</div>}
        {error && (
          <div role="alert" className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-[12.5px] leading-5 text-red-200">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={close} disabled={busy} className="h-10 rounded-xl px-4 text-[14px] text-ink-300 transition-colors hover:bg-white/[0.06] hover:text-ink-50 disabled:opacity-50">
            {ru ? rt("Отмена") : "Cancel"}
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="flex h-10 items-center gap-2 rounded-xl bg-accent px-5 text-[14px] font-medium text-canvas transition-[filter] hover:brightness-110 disabled:opacity-40"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {stack.id === "html" ? (ru ? rt("Создать") : "Create") : ru ? rt("Создать с агентом") : "Create with the agent"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
