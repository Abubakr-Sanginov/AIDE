import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CornerDownLeft, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useFeatureText } from "@/i18n/features";
import { useSnippets, type SnippetEditing } from "@/features/snippets/store";
import { matchesQuery, toDraft, validateDraft, type SnippetDraft } from "@/features/snippets/model";
import { insertSnippet } from "@/features/snippets/actions";

const input =
  "block w-full rounded-lg border border-white/[0.09] bg-black/20 px-2.5 py-1.5 text-[13px] text-ink-200 placeholder-ink-600 outline-none focus:border-brand-400/50";

export function SnippetsPanel() {
  const ft = useFeatureText();
  const snippets = useSnippets((s) => s.snippets);
  const editing = useSnippets((s) => s.editing);
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const list = useMemo(
    () => snippets.filter((s) => matchesQuery(s, query)).sort((a, b) => a.prefix.localeCompare(b.prefix)),
    [snippets, query],
  );

  if (editing) return <SnippetForm key={editing.nonce} editing={editing} />;

  const askDelete = (id: string) => {
    window.clearTimeout(timer.current);
    if (confirm === id) {
      setConfirm(null);
      useSnippets.getState().remove(id);
      return;
    }
    setConfirm(id);
    timer.current = window.setTimeout(() => setConfirm(null), 3000);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.055] px-3">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          {ft.snippetsTitle}
        </span>
        <button
          title={ft.newSnippet}
          aria-label={ft.newSnippet}
          onClick={() => useSnippets.getState().startEdit(null)}
          className="flex size-7 items-center justify-center rounded-md text-ink-500 hover:bg-white/[0.06] hover:text-ink-100"
        >
          <Plus size={14} />
        </button>
      </div>
      {snippets.length > 0 && (
        <div className="shrink-0 px-3 pt-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-white/[0.09] bg-black/20 px-2.5 py-1.5 focus-within:border-brand-400/50">
            <Search size={13} className="shrink-0 text-ink-500" aria-hidden />
            <input
              value={query}
              aria-label={ft.snippetsSearch}
              placeholder={ft.snippetsSearch}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-200 placeholder-ink-600 outline-none"
            />
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {snippets.length === 0 ? (
          <div className="space-y-3 px-4 py-8 text-center text-[12px] leading-5 text-ink-500">
            <div>{ft.noSnippets}</div>
            <div className="text-ink-600">{ft.noSnippetsHint}</div>
            <div className="flex justify-center gap-2">
              <button
                onClick={() => useSnippets.getState().startEdit(null)}
                className="rounded-lg bg-brand-300 px-3 py-1.5 text-[12px] font-medium text-ink-950 hover:bg-brand-200"
              >
                {ft.newSnippet}
              </button>
              <button
                onClick={() => useSnippets.getState().addSamples()}
                className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-[12px] text-ink-300 hover:bg-white/[0.05]"
              >
                {ft.addSamples}
              </button>
            </div>
          </div>
        ) : list.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-ink-600">{ft.nothingFound}</div>
        ) : (
          list.map((s) => (
            <div key={s.id} className="group px-3 py-1.5 hover:bg-white/[0.04]">
              <div className="flex items-center gap-2">
                <code className="shrink-0 rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[11px] text-brand-200">
                  {s.prefix}
                </code>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-200">{s.name}</span>
                <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <RowBtn label={ft.insert} onClick={() => void insertSnippet(s)}>
                    <CornerDownLeft size={12} />
                  </RowBtn>
                  <RowBtn label={ft.edit} onClick={() => useSnippets.getState().startEdit(s.id, toDraft(s))}>
                    <Pencil size={12} />
                  </RowBtn>
                  <RowBtn label={confirm === s.id ? ft.deleteConfirm : ft.delete} danger={confirm === s.id} onClick={() => askDelete(s.id)}>
                    {confirm === s.id ? <Check size={12} /> : <Trash2 size={12} />}
                  </RowBtn>
                </div>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-ink-600">
                {s.langs.length ? s.langs.join(", ") : ft.allFiles}
                {s.description ? " · " + s.description : ""}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SnippetForm({ editing }: { editing: SnippetEditing }) {
  const ft = useFeatureText();
  const [draft, setDraft] = useState<SnippetDraft>(editing.draft);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof SnippetDraft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const submit = () => {
    const res = validateDraft(draft);
    if (!res.ok) {
      setError(ft[res.error]);
      return;
    }
    const err = useSnippets.getState().save(res.value);
    if (err) setError(ft[err]);
  };

  const label = "mb-1 block text-[11px] font-medium text-ink-400";
  const hint = "mt-1 block text-[10.5px] leading-4 text-ink-600";

  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          useSnippets.getState().cancelEdit();
        }
      }}
    >
      <div className="flex h-9 shrink-0 items-center border-b border-white/[0.055] px-3 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        {editing.id ? ft.edit : ft.newSnippet}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <label className="block">
          <span className={label}>{ft.name}</span>
          <input autoFocus value={draft.name} maxLength={80} onChange={set("name")} className={input} />
        </label>
        <label className="block">
          <span className={label}>{ft.prefix}</span>
          <input value={draft.prefix} maxLength={40} spellCheck={false} onChange={set("prefix")} className={input + " font-mono"} />
          <span className={hint}>{ft.prefixHint}</span>
        </label>
        <label className="block">
          <span className={label}>{ft.langs}</span>
          <input value={draft.langs} spellCheck={false} placeholder="ts, tsx" onChange={set("langs")} className={input + " font-mono"} />
          <span className={hint}>{ft.langsHint}</span>
        </label>
        <label className="block">
          <span className={label}>{ft.description}</span>
          <input value={draft.description} maxLength={300} onChange={set("description")} className={input} />
        </label>
        <label className="block">
          <span className={label}>{ft.body}</span>
          <textarea
            value={draft.body}
            rows={8}
            spellCheck={false}
            onChange={set("body")}
            onKeyDown={(e) => {
              // Tab indents inside the template instead of leaving the field.
              if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: a, selectionEnd: b } = el;
                const next = draft.body.slice(0, a) + "  " + draft.body.slice(b);
                setDraft((d) => ({ ...d, body: next }));
                requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
              }
            }}
            className={input + " resize-y font-mono text-[12px] leading-5"}
          />
          <span className={hint}>{ft.bodyHint}</span>
        </label>
        {error && <div role="alert" className="text-[12px] text-red-400">{error}</div>}
      </div>
      <div className="flex shrink-0 gap-2 border-t border-white/[0.055] px-3 py-2.5">
        <button type="submit" className="h-8 flex-1 rounded-lg bg-brand-300 text-[13px] font-medium text-ink-950 hover:bg-brand-200">
          {ft.save}
        </button>
        <button
          type="button"
          onClick={() => useSnippets.getState().cancelEdit()}
          className="h-8 flex-1 rounded-lg border border-white/[0.1] text-[13px] text-ink-300 hover:bg-white/[0.05]"
        >
          {ft.cancel}
        </button>
      </div>
    </form>
  );
}

export default SnippetsPanel;

function RowBtn({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={
        "flex size-6 items-center justify-center rounded-md " +
        (danger ? "bg-red-500/20 text-red-300" : "text-ink-500 hover:bg-white/[0.08] hover:text-ink-100")
      }
    >
      {children}
    </button>
  );
}
