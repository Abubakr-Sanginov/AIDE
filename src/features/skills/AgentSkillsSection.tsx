import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Eye, EyeOff, FolderOpen, Globe, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { Btn, Section, inputClass } from "@/features/settings/SettingsPanel";
import { useWorkspace } from "@/stores/workspace";
import { looksLikeSource, skillsApi, type CatalogHit, type InstalledSkill, type SkillPreview } from "./api";
import { fill, useSkillText } from "./text";

const POPULAR = ["react", "nextjs", "typescript", "testing", "security", "python", "design", "supabase"];

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

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
      <span className={"absolute top-0.5 size-5 rounded-full transition-all " + (on ? "left-[22px] bg-canvas" : "left-0.5 bg-ink-300")} />
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 rounded bg-white/[0.07] px-1.5 py-px text-[11px] font-normal text-ink-300">{children}</span>;
}

function InstalledRow({ skill, onChanged }: { skill: InstalledSkill; onChanged: () => void }) {
  const L = useSkillText();
  const [body, setBody] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const scope = skill.scope === "builtin" ? L.builtin : skill.scope === "global" ? L.global : L.project;

  const toggleBody = async () => {
    if (body !== null) return setBody(null);
    try {
      setBody(await skillsApi.read(skill.id));
    } catch (e) {
      setError(errText(e));
    }
  };
  const remove = async () => {
    if (!confirm) return setConfirm(true);
    try {
      await skillsApi.remove(skill.id);
      onChanged();
    } catch (e) {
      setError(errText(e));
      setConfirm(false);
    }
  };

  return (
    <div className="px-5 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[14px] font-medium text-ink-100">
            <span className="truncate">{skill.name}</span>
            <Badge>{scope}</Badge>
            {skill.files.length > 0 && <Badge>{fill(L.files, { n: skill.files.length })}</Badge>}
          </div>
          {skill.description && <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-5 text-ink-400">{skill.description}</div>}
          {error && <div className="mt-1 text-[12.5px] text-red-400">{error}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Btn variant="ghost" className="!px-2" title={body !== null ? L.hide : L.view} aria-label={body !== null ? L.hide : L.view} onClick={() => void toggleBody()}>
            {body !== null ? <EyeOff size={15} /> : <Eye size={15} />}
          </Btn>
          {skill.removable && (
            <Btn variant="danger" className={confirm ? "" : "!px-2"} title={L.remove} aria-label={L.remove} onClick={() => void remove()} onBlur={() => setConfirm(false)}>
              <Trash2 size={15} />
              {confirm && L.confirmRemove}
            </Btn>
          )}
          <Switch
            on={skill.enabled}
            label={skill.name}
            onChange={() => {
              skillsApi.setEnabled(skill.id, !skill.enabled).then(onChanged, (e) => setError(errText(e)));
            }}
          />
        </div>
      </div>
      {body !== null && (
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] text-ink-300">
          {body}
        </pre>
      )}
    </div>
  );
}

interface Result {
  source: string;
  skillId: string;
  name: string;
  installs?: number;
}

function PreviewPane({
  preview,
  installedNames,
  onBack,
  onInstalled,
}: {
  preview: SkillPreview;
  installedNames: Set<string>;
  onBack: () => void;
  onInstalled: () => void;
}) {
  const L = useSkillText();
  const root = useWorkspace((s) => s.root);
  const [busy, setBusy] = useState<"global" | "project" | null>(null);
  const [error, setError] = useState("");
  const done = installedNames.has(preview.name.toLowerCase());

  const install = async (scope: "global" | "project") => {
    setBusy(scope);
    setError("");
    try {
      await skillsApi.install(preview.source, preview.skillId, scope);
      onInstalled();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 bg-canvas/40 px-5 py-4">
      <Btn variant="ghost" className="-ml-2" onClick={onBack}>
        <ArrowLeft size={14} />
        {L.back}
      </Btn>
      <div>
        <div className="flex flex-wrap items-center gap-1.5 text-[15px] font-medium text-ink-50">
          {preview.name}
          {done && (
            <span className="flex items-center gap-1 text-[12.5px] font-normal text-ink-300">
              <Check size={13} />
              {L.installed}
            </span>
          )}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-ink-500">
          {preview.source} · {preview.path} · {preview.sha.slice(0, 7)}
        </div>
        {preview.description && <p className="mt-1.5 text-[13px] leading-5 text-ink-300">{preview.description}</p>}
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] text-ink-300">
        {preview.body}
      </pre>
      <div className="text-[12px] leading-5 text-ink-500">
        {fill(L.refFiles, { n: preview.files.length })}
        {preview.skipped > 0 && <> · {fill(L.skipped, { n: preview.skipped })}</>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="primary" disabled={busy !== null} onClick={() => void install("global")}>
          {busy === "global" ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
          {L.installGlobal}
        </Btn>
        <Btn disabled={busy !== null || !root} title={root ? undefined : L.noProject} onClick={() => void install("project")}>
          {busy === "project" ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
          {L.installProject}
        </Btn>
      </div>
      {!root && <div className="text-[12px] text-ink-500">{L.noProject}</div>}
      {error && <div className="text-[12.5px] text-red-400">{error}</div>}
    </div>
  );
}

/** Agent skills: installed list (built-in, global, project) and the skills.sh catalog. */
export function AgentSkillsSection() {
  const L = useSkillText();
  const root = useWorkspace((s) => s.root);
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    skillsApi.list().then(setSkills, (e) => setError(errText(e)));
  }, []);
  useEffect(refresh, [refresh, root]);

  const installedNames = new Set(skills.map((s) => s.name.toLowerCase()));

  const openPreview = async (source: string, skillId: string) => {
    setLoadingId(`${source}/${skillId}`);
    setError("");
    try {
      setPreview(await skillsApi.preview(source, skillId));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoadingId(null);
    }
  };

  const run = async (text: string) => {
    const q = text.trim();
    if (q.length < 2 || busy) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setResults(null);
    try {
      if (looksLikeSource(q)) {
        const parsed = await skillsApi.parseInput(q);
        if (parsed.skillId) {
          await openPreview(parsed.source, parsed.skillId);
          return;
        }
        const list = await skillsApi.repo(parsed.source);
        setResults(list.map((s) => ({ source: parsed.source, skillId: s.skillId, name: s.skillId })));
      } else {
        const hits: CatalogHit[] = await skillsApi.search(q);
        setResults(hits);
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section title={L.title}>
        <div className="flex items-start justify-between gap-4 px-5 py-3.5">
          <p className="text-[12.5px] leading-5 text-ink-400">{L.intro}</p>
          <Btn variant="ghost" className="!px-2" title={L.refresh} aria-label={L.refresh} onClick={refresh}>
            <RefreshCw size={14} />
          </Btn>
        </div>
        {skills.map((s) => (
          <InstalledRow key={s.id} skill={s} onChanged={refresh} />
        ))}
      </Section>

      <Section title={L.catalog}>
        <div className="space-y-3 px-5 py-4">
          <p className="text-[12.5px] leading-5 text-ink-400">{L.catalogHint}</p>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(query);
            }}
          >
            <input
              value={query}
              maxLength={300}
              spellCheck={false}
              placeholder={L.placeholder}
              aria-label={L.search}
              onChange={(e) => setQuery(e.target.value)}
              className={inputClass}
            />
            <Btn type="submit" disabled={busy || query.trim().length < 2}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {L.search}
            </Btn>
          </form>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-ink-500">{L.popular}:</span>
            {POPULAR.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setQuery(p);
                  void run(p);
                }}
                className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-ink-300 transition-colors hover:border-line-strong hover:text-ink-100"
              >
                {p}
              </button>
            ))}
          </div>
          {error && <div className="text-[12.5px] leading-5 text-red-400">{error}</div>}
        </div>

        {preview ? (
          <PreviewPane
            preview={preview}
            installedNames={installedNames}
            onBack={() => setPreview(null)}
            onInstalled={refresh}
          />
        ) : (
          results && (
            <div className="divide-y divide-line">
              {results.length === 0 && <div className="px-5 py-3 text-[13px] text-ink-400">{L.noResults}</div>}
              {results.map((r) => {
                const key = `${r.source}/${r.skillId}`;
                const has = installedNames.has(r.name.toLowerCase()) || installedNames.has(r.skillId.toLowerCase());
                return (
                  <div key={key} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[14px] font-medium text-ink-100">
                        <span className="truncate">{r.name}</span>
                        {has && <Check size={13} className="shrink-0 text-ink-300" aria-label={L.installed} />}
                      </div>
                      <div className="truncate font-mono text-[11px] text-ink-500">
                        {r.source}
                        {r.installs ? ` · ${fill(L.installs, { n: r.installs.toLocaleString() })}` : ""}
                      </div>
                    </div>
                    <Btn disabled={loadingId !== null} onClick={() => void openPreview(r.source, r.skillId)}>
                      {loadingId === key ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                      {L.preview}
                    </Btn>
                  </div>
                );
              })}
            </div>
          )
        )}
        <div className="px-5 py-3 text-[12.5px] leading-5 text-ink-500">{L.notice}</div>
      </Section>
    </>
  );
}
