import { isRuLike } from "@/i18n/ruLike";
import { useState } from "react";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { Btn, Row, Section, inputClass } from "@/features/settings/SettingsPanel";
import { findSkills, type RemoteSkill } from "@/features/design/skills/github";
import { useSkills } from "@/features/design/skills/store";

const TEXT = {
  en: {
    title: "Design skills",
    usedIn: "Used by the AI in Design",
    github: "Add from GitHub",
    githubHint: "Paste a repository, folder or SKILL.md link. Only github.com is contacted.",
    find: "Find",
    add: "Add",
    added: "Added",
    paste: "Add your own",
    pasteHint: "Write guidelines the AI should follow.",
    name: "Name",
    instructions: "Instructions",
    save: "Save",
    cancel: "Cancel",
    remove: "Delete skill",
    notice: "Only add skills you trust: their text is sent to your AI model as instructions. Skills are guidance only and cannot run commands.",
    found: "Found",
    builtin: "Built in",
    uiux: "Design intelligence: accessibility, touch, layout and responsive rules, plus a style, palette and typography recommendation for the product type.",
  },
  ru: {
    title: "Скиллы дизайна",
    usedIn: "Использует ИИ в разделе «Дизайн»",
    github: "Добавить с GitHub",
    githubHint: "Вставьте ссылку на репозиторий, папку или файл SKILL.md. Запросы идут только на github.com.",
    find: "Найти",
    add: "Добавить",
    added: "Добавлен",
    paste: "Добавить свой",
    pasteHint: "Напишите правила, которым должен следовать ИИ.",
    name: "Название",
    instructions: "Инструкции",
    save: "Сохранить",
    cancel: "Отмена",
    remove: "Удалить скилл",
    notice: "Добавляйте только скиллы, которым доверяете: их текст отправляется вашей модели как инструкции. Скиллы это только рекомендации, команды они не запускают.",
    found: "Найдено",
    builtin: "Встроенный",
    uiux: "Дизайн-экспертиза: доступность, касания, раскладка и адаптивность, плюс рекомендация стиля, палитры и шрифтов под тип продукта.",
  },
  tg: {
    title: "Малакаҳои тарроҳӣ",
    usedIn: "ЗС дар бахши «Тарроҳӣ» истифода мебарад",
    github: "Илова кардан аз GitHub",
    githubHint: "Истинод ба репозиторий, ҷузвдон ё файли SKILL.md гузоред. Дархостҳо танҳо ба github.com мераванд.",
    find: "Ёфтан",
    add: "Илова кардан",
    added: "Илова шуд",
    paste: "Илова кардани шахсӣ",
    pasteHint: "Қоидаҳоеро нависед, ки ЗС бояд риоя кунад.",
    name: "Ном",
    instructions: "Дастурҳо",
    save: "Нигоҳ доштан",
    cancel: "Бекор кардан",
    remove: "Нест кардани малака",
    notice: "Танҳо малакаҳоеро илова кунед, ки ба онҳо боварӣ доред: матни онҳо ба модели шумо ҳамчун дастур фиристода мешавад. Малакаҳо танҳо тавсия мебошанд ва фармон иҷро намекунанд.",
    found: "Ёфт шуд",
    builtin: "Дарунсохт",
    uiux: "Донишҳои тарроҳӣ: дастрасӣ, ламс, ҷойгиркунӣ ва мутобиқшавӣ, ва ҳамчунин тавсияи услуб, палитра ва шрифтҳо барои навъи маҳсулот.",
  },
};

function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={"relative h-6 w-11 shrink-0 rounded-full transition-colors " + (on ? "bg-ink-100" : "bg-white/[0.14]")}
    >
      <span
        className={"absolute top-0.5 size-5 rounded-full transition-all " + (on ? "left-[22px] bg-canvas" : "left-0.5 bg-ink-300")}
      />
    </button>
  );
}

export function SkillsSection() {
  const { lang } = useI18n();
  const L = lang === "tg" ? TEXT.tg : isRuLike(lang) ? TEXT.ru : TEXT.en;
  const skills = useSkills((s) => s.skills);
  const [url, setUrl] = useState("");
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<RemoteSkill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");

  const find = async () => {
    if (!url.trim() || finding) return;
    setFinding(true);
    setError(null);
    setFound([]);
    try {
      setFound(await findSkills(url));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFinding(false);
    }
  };

  const isAdded = (r: RemoteSkill) => skills.some((s) => !s.builtin && s.source === r.url);

  return (
    <Section title={L.title}>
      {skills.map((s) => (
        <Row
          key={s.id}
          title={s.name}
          hint={
            <>
              {s.builtin ? L.uiux : s.description || L.usedIn}
              {s.builtin && <span className="ml-1.5 rounded bg-white/[0.07] px-1.5 py-px text-[11px] text-ink-300">{L.builtin}</span>}
            </>
          }
        >
          <div className="flex items-center justify-end gap-2">
            {!s.builtin && (
              <Btn variant="danger" className="!px-2" title={L.remove} aria-label={L.remove} onClick={() => useSkills.getState().remove(s.id)}>
                <Trash2 size={15} />
              </Btn>
            )}
            <Switch on={s.enabled} onChange={() => useSkills.getState().toggle(s.id)} label={s.name} />
          </div>
        </Row>
      ))}

      <Row title={L.github} hint={L.githubHint}>
        <div className="flex items-center gap-2">
          <input
            value={url}
            placeholder="https://github.com/owner/repo"
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void find();
            }}
            className={inputClass}
          />
          <Btn onClick={() => void find()} disabled={finding || !url.trim()}>
            {finding ? <Loader2 size={14} className="animate-spin" /> : L.find}
          </Btn>
        </div>
      </Row>

      {error && <div className="px-5 py-3 text-[13px] text-red-400">{error}</div>}

      {found.length > 0 && (
        <div className="divide-y divide-line bg-canvas/40">
          <div className="px-5 py-2 text-[12px] text-ink-400">
            {L.found}: {found.length}
          </div>
          {found.map((r) => (
            <div key={r.url} className="flex items-start justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-ink-100">{r.name}</div>
                {r.description && <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-5 text-ink-400">{r.description}</div>}
                <div className="mt-0.5 truncate font-mono text-[11px] text-ink-600">{r.path}</div>
              </div>
              {isAdded(r) ? (
                <span className="mt-1 flex shrink-0 items-center gap-1 text-[13px] text-ink-300">
                  <Check size={14} />
                  {L.added}
                </span>
              ) : (
                <Btn
                  onClick={() =>
                    useSkills.getState().add({ name: r.name, description: r.description, instructions: r.instructions, source: r.url })
                  }
                >
                  <Plus size={14} />
                  {L.add}
                </Btn>
              )}
            </div>
          ))}
        </div>
      )}

      <Row title={L.paste} hint={L.pasteHint}>
        <Btn onClick={() => setFormOpen((v) => !v)}>
          <Plus size={14} />
          {L.paste}
        </Btn>
      </Row>

      {formOpen && (
        <div className="space-y-2.5 bg-canvas/40 px-5 py-4">
          <input value={name} maxLength={60} placeholder={L.name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          <textarea
            value={text}
            rows={6}
            placeholder={L.instructions}
            onChange={(e) => setText(e.target.value)}
            className="w-full resize-y rounded-lg border border-line-strong bg-canvas px-3 py-2 text-[13px] leading-5 text-ink-100 outline-none transition-colors placeholder:text-ink-500 focus:border-white/30"
          />
          <div className="flex items-center gap-2">
            <Btn
              variant="primary"
              disabled={!name.trim() || !text.trim()}
              onClick={() => {
                if (useSkills.getState().add({ name, instructions: text })) {
                  setName("");
                  setText("");
                  setFormOpen(false);
                }
              }}
            >
              {L.save}
            </Btn>
            <Btn variant="ghost" onClick={() => setFormOpen(false)}>
              {L.cancel}
            </Btn>
          </div>
        </div>
      )}

      <div className="px-5 py-3 text-[12.5px] leading-5 text-ink-500">{L.notice}</div>
    </Section>
  );
}
