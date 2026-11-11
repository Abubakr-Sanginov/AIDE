import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { fs } from "@/api/fs";
import { useWorkspace } from "@/stores/workspace";
import { Btn, Section } from "@/features/settings/SettingsPanel";

const areaClass =
  "h-64 w-full resize-y rounded-lg border border-line-strong bg-canvas px-3 py-2 font-mono text-[12.5px] leading-5 text-ink-100 outline-none transition-colors placeholder:text-ink-500 focus:border-white/30";

function Editor({
  value,
  onChange,
  onSave,
  saved,
  busy,
  placeholder,
  note,
  error,
  disabled,
  saveLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saved: boolean;
  busy: boolean;
  placeholder: string;
  note: string;
  error: string;
  disabled?: boolean;
  saveLabel: string;
}) {
  return (
    <div className="space-y-3 px-5 py-4">
      <textarea value={value} disabled={disabled} spellCheck={false} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={areaClass} />
      <div className="flex items-center gap-3">
        <Btn variant="primary" onClick={onSave} disabled={busy || disabled}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : saveLabel}
        </Btn>
        {saved && (
          <span className="flex items-center gap-1 text-[13px] text-ink-300">
            <Check size={13} />
          </span>
        )}
        {error && <span className="text-[13px] text-red-400">{error}</span>}
      </div>
      <p className="text-[12.5px] leading-5 text-ink-500">{note}</p>
    </div>
  );
}

/** Personal notes the agent always sees: preferences, style, things to remember. Kept in the app's data folder. */
export function MemorySection() {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void invoke<string>("memory_get").then(setText).catch(() => {});
  }, []);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await invoke("memory_set", { text });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={ru ? rt("Заметки для агента") : "Notes for the agent"}>
      <Editor
        value={text}
        onChange={(v) => {
          setText(v);
          setSaved(false);
        }}
        onSave={() => void save()}
        saved={saved}
        busy={busy}
        error={error}
        saveLabel={ru ? rt("Сохранить") : "Save"}
        placeholder={ru ? rt("Например: отвечай кратко; я пишу на TypeScript; комментарии на русском…") : "For example: keep answers short; I write TypeScript; comments in English…"}
        note={ru ? rt("Агент видит эти заметки в каждом запросе. До 20 000 символов. Файл лежит в папке данных приложения, не в проекте.") : "The agent sees these notes in every request. Up to 20,000 characters. Stored in the app's data folder, not in the project."}
      />
    </Section>
  );
}

/** AGENTS.md in the project root: rules every agent and crew role follows in this project. */
export function RulesSection() {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const root = useWorkspace((s) => s.root);
  const [text, setText] = useState("");
  const [exists, setExists] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!root) return;
    fs.readFile("AGENTS.md")
      .then((t) => {
        setText(t);
        setExists(true);
      })
      .catch(() => {
        setText("");
        setExists(false);
      });
  }, [root]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (!exists) {
        await fs.createEntry("AGENTS.md", false);
        setExists(true);
      }
      await fs.writeFile("AGENTS.md", text);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="AGENTS.md">
      {!root && <div className="px-5 py-4 text-[13px] text-ink-400">{ru ? rt("Откройте папку проекта, чтобы редактировать правила.") : "Open a project folder to edit its rules."}</div>}
      <Editor
        value={text}
        disabled={!root}
        onChange={(v) => {
          setText(v);
          setSaved(false);
        }}
        onSave={() => void save()}
        saved={saved}
        busy={busy}
        error={error}
        saveLabel={ru ? rt("Сохранить") : "Save"}
        placeholder={ru ? rt("Правила проекта: стек, соглашения, что нельзя трогать, как запускать тесты…") : "Project rules: stack, conventions, what not to touch, how to run tests…"}
        note={ru ? rt("Файл AGENTS.md в корне проекта (его же читают и другие инструменты). Агент AIDE подтягивает AGENTS.md и CLAUDE.md на каждый запрос, до 12 000 символов каждый.") : "AGENTS.md in the project root (other tools read it too). The AIDE agent loads AGENTS.md and CLAUDE.md on every request, up to 12,000 characters each."}
      />
    </Section>
  );
}
