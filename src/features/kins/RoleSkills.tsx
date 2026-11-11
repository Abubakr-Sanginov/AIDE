import { isRuLike } from "@/i18n/ruLike";
import { useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { findSkills, type RemoteSkill } from "@/features/design/skills/github";
import { useSkills } from "@/features/design/skills/store";
import { SKILL_SOURCES } from "./skillCatalog";
import type { RoleId } from "./roles";
import { lang } from "./engine";

const TEXT = {
  ru: {
    mine: "Навыки роли",
    none: "Пока нет. Выберите источник ниже или вставьте ссылку на GitHub.",
    suggested: "Где взять",
    paste: "Ссылка на репозиторий, папку или SKILL.md",
    find: "Найти",
    add: "Добавить",
    added: "Добавлен",
    preview: "Что в навыке",
    remove: "Убрать у роли",
    found: "Найдено",
    notice: "Добавляйте только то, чему доверяете: текст навыка уходит модели как справочный материал. Навыки не запускают команды и не отменяют правил команды.",
    nothing: "Для этой роли навыки не нужны.",
  },
  en: {
    mine: "Role skills",
    none: "None yet. Pick a source below or paste a GitHub link.",
    suggested: "Where to get them",
    paste: "Repository, folder or SKILL.md link",
    find: "Find",
    add: "Add",
    added: "Added",
    preview: "What's inside",
    remove: "Remove from role",
    found: "Found",
    notice: "Only add what you trust: a skill's text goes to the model as reference material. Skills cannot run commands or override the crew rules.",
    nothing: "This role needs no skills.",
  },
  tg: {
    mine: "Малакаҳои нақш",
    none: "Ҳоло нест. Манбаъро дар поён интихоб кунед ё истиноди GitHub гузоред.",
    suggested: "Аз куҷо гирифтан",
    paste: "Истинод ба репозиторий, ҷузвдон ё SKILL.md",
    find: "Ёфтан",
    add: "Илова кардан",
    added: "Илова шуд",
    preview: "Дар малака чӣ ҳаст",
    remove: "Аз нақш гирифтан",
    found: "Ёфт шуд",
    notice: "Танҳо чизеро илова кунед, ки ба он боварӣ доред: матни малака ба модел ҳамчун маводи маълумотӣ меравад. Малакаҳо фармон иҷро намекунанд ва қоидаҳои дастаро бекор намекунанд.",
    nothing: "Ин нақш ба малака ниёз надорад.",
  },
};

/** Per-role skills: what is attached, where to find more (GitHub), and a preview before adding. */
export function RoleSkills({ role }: { role: RoleId }) {
  const L = lang() === "tg" ? TEXT.tg : isRuLike(lang()) ? TEXT.ru : TEXT.en;
  const l = lang();
  const all = useSkills((s) => s.skills);
  const mine = all.filter((s) => s.roles?.includes(role));
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<RemoteSkill[]>([]);
  const [error, setError] = useState("");
  const sources = SKILL_SOURCES[role];

  const search = async (target: string) => {
    if (!target.trim() || busy) return;
    setBusy(true);
    setError("");
    setFound([]);
    try {
      setFound(await findSkills(target));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const has = (r: RemoteSkill) => mine.some((s) => s.source === r.url);

  return (
    <div className="space-y-3 border-t border-line/60 bg-canvas/40 px-4 py-3">
      <div>
        <div className="mb-1 text-[12px] uppercase tracking-wide text-ink-500">{L.mine}</div>
        {mine.length === 0 ? (
          <div className="text-[13px] text-ink-500">{sources.length === 0 ? L.nothing : L.none}</div>
        ) : (
          <ul className="space-y-1">
            {mine.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[13px] text-ink-100">
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <button onClick={() => useSkills.getState().detachRole(s.id, role)} aria-label={L.remove} title={L.remove} className="text-ink-500 hover:text-ink-100">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sources.length > 0 && (
        <div>
          <div className="mb-1 text-[12px] uppercase tracking-wide text-ink-500">{L.suggested}</div>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((src) => (
              <button
                key={src.url}
                disabled={busy}
                onClick={() => void search(src.url)}
                className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-[12.5px] text-ink-200 transition-colors hover:bg-white/[0.11] disabled:opacity-50"
              >
                {src.label[l === "tg" ? "ru" : l]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={url}
          spellCheck={false}
          placeholder={L.paste}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search(url)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-canvas px-2.5 text-[12.5px] text-ink-100 outline-none placeholder:text-ink-500 focus:border-white/30"
        />
        <button onClick={() => void search(url)} disabled={busy || !url.trim()} className="flex h-8 items-center rounded-lg bg-white/[0.08] px-3 text-[12.5px] text-ink-100 hover:bg-white/[0.13] disabled:opacity-40">
          {busy ? <Loader2 size={13} className="animate-spin" /> : L.find}
        </button>
      </div>

      {error && <div className="text-[12.5px] text-red-400">{error}</div>}

      {found.length > 0 && (
        <div className="divide-y divide-line/60 rounded-lg border border-line/60">
          <div className="px-3 py-1.5 text-[12px] text-ink-400">
            {L.found}: {found.length}
          </div>
          {found.map((r) => (
            <div key={r.url} className="px-3 py-2">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-ink-100">{r.name}</div>
                  {r.description && <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-5 text-ink-400">{r.description}</div>}
                </div>
                {has(r) ? (
                  <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[12.5px] text-ink-300">
                    <Check size={13} />
                    {L.added}
                  </span>
                ) : (
                  <button
                    onClick={() => useSkills.getState().addForRole({ name: r.name, description: r.description, instructions: r.instructions, source: r.url }, role)}
                    className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-white/[0.08] px-2.5 text-[12.5px] text-ink-100 hover:bg-white/[0.13]"
                  >
                    <Plus size={13} />
                    {L.add}
                  </button>
                )}
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer text-[12px] text-ink-500 hover:text-ink-300">{L.preview}</summary>
                <pre className="aide-scroll mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-2 font-mono text-[11.5px] leading-4 text-ink-300">{r.instructions.slice(0, 2500)}</pre>
              </details>
            </div>
          ))}
        </div>
      )}

      <p className="text-[12px] leading-5 text-ink-500">{L.notice}</p>
    </div>
  );
}
