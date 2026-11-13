import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { loadTasks, openCount } from "@/lib/sessionTasks";
import { Markdown } from "@/ui/Markdown";
import { ComputerConsent } from "@/features/chat/ComputerConsent";
import { grantComputerConsent, hasComputerConsent } from "@/lib/computerMode";
import { SlashMenu } from "@/features/chat/SlashMenu";
import { fillPrompt, filterItems, loadProjectCommands, skillCommands, type SlashItem } from "@/features/chat/slash";
import { useSkills } from "@/features/design/skills/store";
import { useWorkspace } from "@/stores/workspace";
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Copy,
  CircleAlert,
  Clock,
  FileText,
  FolderCode,
  Monitor,
  Paperclip,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Square,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { Select } from "@/ui/Select";
import { ChatSessionButtons, type ChatItem } from "@/ui/ChatHistory";
import { titleOf, useChats } from "@/stores/chats";
import { useAi, type AiMode, type ToolEvent } from "@/stores/ai";
import { ToolActivity } from "@/ui/ToolActivity";
import { AgentChanges } from "@/features/chat/AgentChanges";
import { Indicator, useIndicator } from "@/ui/Indicator";
import { type Attachment, type PermissionMode, type TokenUsage } from "@/api/ai";
import { addQueued, nextQueued, prioritizeQueued, removeQueued, type QueuedItem } from "@/lib/queue";
import { appendHist, nextIndex, prevIndex } from "@/lib/inputHistory";
import { fs } from "@/api/fs";
import { basename } from "@/lib/fsUtils";
import { AIDE_PATH_MIME, isFileDrag } from "@/lib/dnd";


function ThinkingBlock({ text }: { text: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12px] text-ink-400 transition-colors hover:bg-white/[0.05] hover:text-ink-200"
      >
        <Brain size={13} className="shrink-0" />
        {t("chat.thinking")}
        <ChevronDown
          size={12}
          className={`shrink-0 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap border-l border-line-strong pl-3 text-[12px] leading-5 text-ink-500">
          {text}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({
  content,
  thinking,
  error,
  errorText,
  tools,
  live,
}: {
  content: string;
  thinking?: string;
  error?: boolean;
  errorText?: string;
  tools?: ToolEvent[];
  live?: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  if (error && !content) {
    const detail = errorText && errorText !== "canceled" ? errorText : "";
    return (
      <div title={detail} className="flex items-start gap-2 text-[13px] text-ink-300">
        <CircleAlert size={15} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <div className="font-medium text-ink-100">{t("chat.error")}</div>
          {detail && (
            <div className="mt-0.5 break-words text-ink-400">
              {detail.length > 400 ? `${detail.slice(0, 400)}…` : detail}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="group relative text-[14px] leading-6 text-ink-100">
      {thinking && <ThinkingBlock text={thinking} />}
      {content && (
        <div className={live ? "aide-live-caret" : undefined}>
        {live ? <div className="whitespace-pre-wrap break-words">{content}</div> : <Markdown content={content} />}
        </div>
      )}
      {tools && tools.length > 0 && <ToolActivity items={tools} live={live} />}
      {content && (
        <button
          title={t("chat.copyTitle")}
          aria-label={t("chat.copyTitle")}
          onClick={copy}
          className="aide-icon-button mt-1 size-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        >
          {copied ? <Check key="ok" size={13} className="aide-icon-in text-emerald-300" /> : <Copy key="copy" size={13} />}
        </button>
      )}
    </div>
  );
}

/** "Tokens: 12,345 · in 11,000 (8,000 cached) · out 1,345" under a finished answer. */
function TokenLine({ usage, lang }: { usage: TokenUsage; lang: string }) {
  const nf = new Intl.NumberFormat(lang === "ru" || lang === "tg" ? "ru" : "en");
  const total = usage.input + usage.output;
  const T =
    lang === "tg"
      ? { head: "Токенҳо", inn: "вурудӣ", cached: "аз кэш", out: "баромад" }
      : lang === "ru"
        ? { head: "Токенов", inn: "вход", cached: "из кэша", out: "выход" }
        : { head: "Tokens", inn: "in", cached: "cached", out: "out" };
  return (
    <div className="aide-fade mt-1.5 pl-1 text-[11.5px] tabular-nums text-ink-500" title={`${nf.format(usage.input)} + ${nf.format(usage.output)}`}>
      {T.head}: <span className="text-ink-300">{nf.format(total)}</span> · {T.inn} {nf.format(usage.input)}
      {usage.cached > 0 ? ` (${T.cached} ${nf.format(usage.cached)})` : ""} · {T.out} {nf.format(usage.output)}
    </div>
  );
}

function AttachmentChip({
  att,
  onRemove,
}: {
  att: Attachment;
  onRemove?: () => void;
}) {
  const isImage = att.mime.startsWith("image/");
  return (
    <div className="aide-pop flex max-w-[200px] items-center gap-1.5 rounded-lg bg-white/[0.06] py-0.5 pl-1.5 pr-1">
      {isImage ? (
        <img
          src={`data:${att.mime};base64,${att.data}`}
          alt={att.name}
          className="size-5 shrink-0 rounded object-cover"
        />
      ) : (
        <FileText size={12} className="shrink-0 text-ink-400" />
      )}
      <span className="truncate text-[12px] text-ink-200">{att.name}</span>
      {onRemove && (
        <button
          aria-label="Remove"
          onClick={onRemove}
          className="shrink-0 rounded p-0.5 text-ink-500 hover:bg-white/[0.1] hover:text-ink-100"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

function AttachmentsGrid({ atts }: { atts: Attachment[] }) {
  if (!atts || atts.length === 0) return null;
  const images = atts.filter((a) => a.mime.startsWith("image/"));
  const files = atts.filter((a) => !a.mime.startsWith("image/"));
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {images.map((a, i) => (
        <img
          key={i}
          src={`data:${a.mime};base64,${a.data}`}
          alt={a.name}
          className="size-14 rounded-lg border border-line object-cover"
        />
      ))}
      {files.map((a, i) => (
        <AttachmentChip key={i} att={a} />
      ))}
    </div>
  );
}

/** "vibe": full-width agent workspace — no tab row, centered column, provider in the composer. */
export function ChatPanel({ variant = "panel" }: { variant?: "panel" | "vibe" } = {}) {
  const vibe = variant === "vibe";
  const column = vibe ? "px-[max(1rem,calc((100%-820px)/2))]" : "px-4";
  const composerColumn = vibe ? "px-[max(0.5rem,calc((100%-836px)/2))]" : "px-2";
  const { t, lang } = useI18n();
  const {
    messages, streaming, streamingId, error, attachFile, hasKey, mode, model,
    providers, providerId, models, setMode, setProvider, setModel,
    permissionMode, setPermissionMode, autoCheck, setAutoCheck, attachments,
    addFiles, removeAttachment,
    send, retry, stop, clear, setAttachFile,
  } = useAi();
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  // ArrowUp/ArrowDown history of the input: sent messages, plus the draft that was there
  // before browsing started (so walking down past the newest restores what you typed).
  const [hist, setHist] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [histDraft, setHistDraft] = useState("");
  const ru = isRuLike(lang);

  useEffect(() => {
    if (!attachNote) return;
    const id = window.setTimeout(() => setAttachNote(null), 9000);
    return () => window.clearTimeout(id);
  }, [attachNote]);

  // A drag that ends outside the panel (or is cancelled) must not leave the drop overlay on screen.
  useEffect(() => {
    const reset = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, []);

  /** Attaches files (picked, dropped or pasted) and says which ones did not fit and why. */
  const attach = async (files: File[]) => {
    if (files.length === 0) return;
    const { skipped } = await addFiles(files);
    if (skipped.length === 0) {
      setAttachNote(null);
      return;
    }
    const why = (r: string) =>
      r === "size"
        ? ru ? rt("больше 8 МБ") : "larger than 8 MB"
        : r === "total"
          ? ru ? rt("вместе с другими больше 20 МБ") : "over 20 MB together with the others"
          : r === "count"
            ? ru ? rt("не больше 20 файлов за раз") : "20 files at most"
            : ru ? rt("не читается (папку прикрепить нельзя)") : "cannot be read (folders are not supported)";
    const list = skipped.slice(0, 4).map((x) => `${x.name} — ${why(x.reason)}`).join("; ");
    setAttachNote((ru ? rt("Не прикреплено: ") : "Not attached: ") + list + (skipped.length > 4 ? ` (+${skipped.length - 4})` : ""));
  };

  /** A file dragged from the project tree: read through the workspace (no access outside the project). */
  const attachProjectFile = async (path: string) => {
    try {
      const text = await fs.readFile(path);
      await attach([new File([text], basename(path), { type: "text/plain" })]);
    } catch (e) {
      setAttachNote((ru ? rt("Не удалось прочитать файл: ") : "Could not read the file: ") + String(e).slice(0, 200));
    }
  };

  const onDragEnter = (e: ReactDragEvent) => {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth.current += 1;
    if (!dragging) setDragging(true);
  };
  const onDragOver = (e: ReactDragEvent) => {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: ReactDragEvent) => {
    if (!isFileDrag(e.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: ReactDragEvent) => {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const path = e.dataTransfer.getData(AIDE_PATH_MIME);
    if (path) void attachProjectFile(path);
    else void attach(Array.from(e.dataTransfer.files));
  };
  const modeIndicator = useIndicator(mode);

  const PERMISSIONS: { id: PermissionMode; label: string }[] = [
    { id: "ask", label: t("permission.ask") },
    { id: "auto", label: t("permission.auto") },
    { id: "full", label: t("permission.full") },
  ];


  const MODES: { id: AiMode; label: string; icon: typeof Sparkles; active: string }[] = [
    { id: "chat", label: t("chat.modeChat"), icon: Sparkles, active: "border-transparent bg-white/10 text-ink-50" },
    { id: "plan", label: t("chat.modePlan"), icon: Brain, active: "border-transparent bg-white/10 text-ink-50" },
    { id: "agent", label: t("chat.modeAgent"), icon: FolderCode, active: "border-transparent bg-white/10 text-ink-50" },
    { id: "computer", label: ru ? rt("Компьютер") : "Computer", icon: Monitor, active: "border-transparent bg-white/10 text-ink-50" },
  ];

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    // Measure the new height, then let the box grow / shrink to it smoothly.
    const from = textarea.offsetHeight;
    textarea.style.transition = "none";
    textarea.style.height = "auto";
    const to = Math.min(textarea.scrollHeight, 240);
    textarea.style.height = `${from}px`;
    void textarea.offsetHeight;
    textarea.style.transition = "";
    textarea.style.height = `${to}px`;
  }, [input]);

  // Messages written while the agent works wait and are sent when it finishes.
  // They stay visible as a numbered list («В очереди N») above the input: the arrow sends the
  // first one right away (once the current step ends), pencil edits, trash removes, chevron folds.
  const [queued, setQueued] = useState<QueuedItem[]>([]);
  const [queuedOpen, setQueuedOpen] = useState(true);
  useEffect(() => {
    if (!streaming && queued.length > 0) {
      const nxt = nextQueued(queued);
      if (nxt) {
        setQueued(nxt.rest);
        void send(nxt.first.text);
      }
    }
  }, [streaming, queued, send]);

  const queueText = (text: string) => {
    setQueued((q) => addQueued(q, text));
    setQueuedOpen(true);
  };

  // ── "/" commands ──
  const root = useWorkspace((s) => s.root);
  const [projectCmds, setProjectCmds] = useState<SlashItem[]>([]);
  const [slashIdx, setSlashIdx] = useState(0);
  const [slashOff, setSlashOff] = useState<string | null>(null);
  const slashActive = input.startsWith("/") && !/s/.test(input);
  useEffect(() => {
    if (!slashActive) return;
    let live = true;
    void loadProjectCommands().then((c) => live && setProjectCmds(c));
    return () => { live = false; };
  }, [slashActive, root]);
  const skills = useSkills((x) => x.skills);
  const BUILTIN_NAMES = ["new", "clear", "chat", "plan", "agent", "explain", "bugs", "tests"];
  const slashItems: SlashItem[] = [
    { name: "new", desc: ru ? rt("Новый чат") : "New chat", source: "builtin", action: "new" },
    { name: "clear", desc: ru ? rt("Очистить этот чат") : "Clear this chat", source: "builtin", action: "clear" },
    { name: "chat", desc: ru ? rt("Режим: вопросы без изменений") : "Mode: ask only", source: "builtin", action: "chat" },
    { name: "plan", desc: ru ? rt("Режим: план без изменений файлов") : "Mode: plan, no file changes", source: "builtin", action: "plan" },
    { name: "agent", desc: ru ? rt("Режим: агент сам правит проект") : "Mode: the agent edits the project", source: "builtin", action: "agent" },
    { name: "explain", desc: t("chat.suggestExplain"), source: "builtin", prompt: t("chat.suggestExplain") },
    { name: "bugs", desc: t("chat.suggestBugs"), source: "builtin", prompt: t("chat.suggestBugs") },
    { name: "tests", desc: t("chat.suggestTests"), source: "builtin", prompt: t("chat.suggestTests") },
    ...projectCmds.filter((c) => !BUILTIN_NAMES.includes(c.name)),
  ];
  slashItems.push(...skillCommands(skills, new Set(slashItems.map((c) => c.name))));
  const slashQuery = /^\/([^\s/]*)$/.exec(input)?.[1];
  const slashRows = slashQuery !== undefined && slashOff !== input ? filterItems(slashItems, slashQuery) : [];
  const slashOpen = slashRows.length > 0;
  const runSlash = (item: SlashItem, args: string) => {
    if (item.action === "new") useChats.getState().newChat();
    else if (item.action === "clear") clear();
    else if (item.action) setMode(item.action);
    else if (item.prompt) {
      const text = fillPrompt(item.prompt, args).trim();
      if (streaming) queueText(text);
      else void send(text);
    }
    setInput("");
    setHistIdx(null);
  };
  const pickSlash = (i: number) => {
    const row = slashRows[i];
    if (!row) return;
    // Commands that need no text run right away; templates wait for arguments (Enter again sends).
    if (row.item.action || row.item.source === "builtin") runSlash(row.item, "");
    else {
      setInput("/" + row.item.name + " ");
      inputRef.current?.focus();
    }
  };

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    const m = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text);
    const cmd = m ? slashItems.find((c) => c.name === m[1]) : undefined;
    if (m && cmd) {
      runSlash(cmd, (m[2] ?? "").trim());
      return;
    }
    setInput("");
    setHist((h) => appendHist(h, text));
    setHistIdx(null);
    if (streaming) queueText(text);
    else void send(text);
  };

  return (
    <div
      className="relative flex h-full flex-col bg-transparent"
      data-dropzone
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Tab row */}
      {!vibe && (
      <div className="flex h-10 shrink-0 items-center justify-end gap-2 px-2">
        <div className="flex min-w-0 items-center gap-1">
          {hasKey && (
            <Select
              title={t("settings.provider")}
              value={providerId}
              onChange={setProvider}
              options={providers.map((p) => ({ value: p.id, label: p.name }))}
              className="max-w-[160px] text-[13px] text-ink-300"
              menuMinWidth={200}
            />
          )}
          <SessionButtons />
          {messages.length > 0 && (
            <button
              title={t("chat.clearChat")}
              aria-label={t("chat.clearChat")}
              onClick={clear}
              className="aide-icon-button size-8"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
      )}

      {/* Messages */}
      <div ref={listRef} className={"aide-scroll min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden py-3 " + column}>
        {messages.length === 0 && !error && (
          <div className="aide-stagger relative flex h-full flex-col items-center justify-center gap-4 overflow-hidden px-4">
            <div aria-hidden className="aide-ambient" />
            <div aria-hidden className="aide-float relative flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-teal-200 shadow-[0_10px_40px_-10px_rgba(94,234,212,0.45)]">
              <Sparkles size={20} />
            </div>
            <div className="relative text-center">
              <div className="text-[15px] font-medium text-ink-100">{t("chat.emptyTitle")}</div>
              <div className="mt-0.5 text-[13px] text-ink-500">{t("chat.emptySubtitle")}</div>
            </div>
            {hasKey && model && (
              <div className="aide-stagger relative flex w-full max-w-xs flex-col gap-1">
                {[t("chat.suggestExplain"), t("chat.suggestBugs"), t("chat.suggestTests")].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                    className="aide-lift rounded-lg border border-transparent px-3 py-1.5 text-left text-[13px] text-ink-300 hover:border-white/10 hover:bg-white/[0.05] hover:text-ink-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="aide-msg-user flex justify-end">
              <div className="max-w-[85%]">
                <AttachmentsGrid atts={m.attachments ?? []} />
                <div className="whitespace-pre-wrap rounded-[26px] bg-raised px-4 py-2.5 text-[14px] leading-6 text-ink-50">
                  {m.content}
                </div>
              </div>
            </div>
          ) : (
            <div key={m.id} className="aide-msg-ai flex justify-start">
              <div className="min-w-0 max-w-[95%] flex-1">
                {m.tools && m.tools.length > 0 && (
                  <div className="mb-1.5 flex items-center gap-1.5 pl-1 text-[11px] text-ink-600">
                    <div className="h-px flex-1 bg-ink-800/40" />
                    <span>{mode === "agent" ? t("chat.modeAgent") : mode === "plan" ? t("chat.modePlan") : mode === "computer" ? (ru ? rt("Компьютер") : "Computer") : t("chat.modeChat")}</span>
                    {m.iterations !== undefined && (
                      <span className="text-ink-700">· {t("chat.iteration")} {m.iterations + 1}</span>
                    )}
                    <div className="h-px flex-1 bg-ink-800/40" />
                  </div>
                )}
                <AssistantMessage
                  content={m.content}
                  thinking={m.thinking}
                  error={m.error}
                  errorText={m.errorText}
                  tools={m.tools}
                  live={m.id === streamingId && streaming}
                />
                <AgentChanges requestId={m.id} />
                {m.usage && !(m.id === streamingId && streaming) && <TokenLine usage={m.usage} lang={lang} />}
                {m.id === streamingId && streaming && (
                  <div className="mt-1.5 flex items-center gap-1.5 pl-1 text-[11px] text-ink-500">
                    <div className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
                    </div>
                    <span className="aide-fade">
                      {(m.retryStatus
                        ? `${t("common.retry")} ${m.retryStatus.attempt}/${m.retryStatus.max}`
                        : m.tools && m.tools.length > 0
                        ? `${t("chat.iteration")} ${(m.tools[m.tools.length - 1]?.iteration ?? 0) + 1}`
                        : m.thinking && !m.content
                          ? t("chat.thinkingDots")
                          : t("chat.generating")
                      ).replace(/[.…]+$/, "")}
                    </span>
                    <span className="aide-dots" aria-hidden>
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {error && !streaming && (
          <div className="aide-shake rounded-[28px] border border-line bg-raised p-4">
            <div className="flex items-start gap-2.5">
              <CircleAlert size={16} className="mt-0.5 shrink-0 text-accent" />
              <div className="max-h-40 min-w-0 flex-1 overflow-auto break-words text-[13px] leading-5 text-ink-300">
                {error}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => void retry()}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-canvas transition-[filter] hover:brightness-110"
              >
                <RefreshCw size={13} />
                {t("common.retry")}
              </button>
              <button
                onClick={() => { void navigator.clipboard.writeText(error); }}
                className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[13px] text-ink-100 transition-colors hover:bg-white/[0.1]"
              >
                <Copy size={13} />
                {t("chat.copyError")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Prompt input */}
      <div className={"relative shrink-0 pb-3 pt-1 " + composerColumn}>
        {slashOpen && <SlashMenu rows={slashRows} index={Math.min(slashIdx, slashRows.length - 1)} onPick={pickSlash} onHover={setSlashIdx} />}
        {queued.length > 0 && (
          <div className="aide-pop mb-2 overflow-hidden rounded-[20px] border border-line-strong bg-raised">
            <button
              onClick={() => setQueuedOpen((v) => !v)}
              aria-expanded={queuedOpen}
              className="flex h-9 w-full items-center gap-2 px-3 text-[12.5px] text-ink-300 hover:bg-white/[0.03]"
            >
              <Clock size={13} className="shrink-0 text-accent" />
              <span className="font-semibold text-ink-100">{ru ? rt("В очереди") : "Queue"}</span>
              <span className="flex size-5 items-center justify-center rounded-full bg-white/[0.08] text-[11px] text-ink-200">
                {queued.length}
              </span>
              <span className="truncate text-ink-500">
                {ru ? rt("Отправится, когда агент закончит") : "Will be sent when the agent finishes"}
              </span>
              <ChevronDown size={14} className={`ml-auto shrink-0 transition-transform ${queuedOpen ? "rotate-180" : ""}`} />
            </button>
            {queuedOpen && (
              <div className="aide-scroll max-h-40 overflow-y-auto border-t border-line/60">
                {queued.map((item, idx) => (
                  <div key={item.id} className="group flex items-center gap-2 border-b border-line/40 px-3 py-2 last:border-b-0">
                    <span className="size-5 shrink-0 rounded-md bg-white/[0.06] text-center text-[11px] leading-5 text-ink-400">
                      {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-100">{item.text}</span>
                    <button
                      title={ru ? rt("Отправить первым, как только агент закончит шаг") : "Send first, as soon as the agent finishes the step"}
                      aria-label={ru ? rt("Отправить первым") : "Send first"}
                      onClick={() => {
                        if (streaming) {
                          // The arrow never drops the message: it jumps to the front of the queue.
                          setQueued((q) => prioritizeQueued(q, item.id));
                          return;
                        }
                        setQueued((q) => removeQueued(q, item.id));
                        void send(item.text);
                      }}
                      className="aide-icon-button size-7 shrink-0"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      title={ru ? rt("Редактировать") : "Edit"}
                      aria-label={ru ? rt("Редактировать") : "Edit"}
                      onClick={() => {
                        setInput(item.text);
                        setQueued((q) => removeQueued(q, item.id));
                        inputRef.current?.focus();
                      }}
                      className="aide-icon-button size-7 shrink-0"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      title={ru ? rt("Удалить") : "Delete"}
                      aria-label={ru ? rt("Удалить") : "Delete"}
                      onClick={() => setQueued((q) => removeQueued(q, item.id))}
                      className="aide-icon-button size-7 shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div
          className="aide-composer aide-rise rounded-[30px] border border-line-strong bg-raised px-2 pb-2 pt-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.25)]"
          data-busy={streaming}
          data-drag={dragging}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1.5 pt-1.5">
              {attachments.map((a, i) => (
                <AttachmentChip key={i} att={a} onRemove={() => removeAttachment(i)} />
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder={
              hasKey
                ? streaming
                  ? isRuLike(lang)
                    ? rt("Следующее сообщение — отправится, когда агент закончит")
                    : "Next message — sent when the agent finishes"
                  : mode === "computer"
                  ? (ru ? rt("Что сделать на компьютере? Например: проверь бота в Telegram") : "What should I do on the computer? For example: test the Telegram bot")
                  : mode === "agent"
                  ? t("chat.placeholderAgent")
                  : mode === "plan"
                    ? t("chat.placeholderPlan")
                    : t("chat.placeholderChat")
                : t("chat.placeholderNoKey")
            }
            onChange={(e) => {
              setInput(e.target.value);
              setSlashIdx(0);
              if (histIdx !== null) setHistIdx(null);
            }}
            onPaste={(e) => {
              // Screenshots and files copied in Explorer arrive as clipboard files.
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length > 0) {
                e.preventDefault();
                void attach(files);
              }
            }}
            onKeyDown={(e) => {
              // ArrowUp/ArrowDown recall previous messages (like a terminal).
              // Only when the cursor is on the first / last line, so multi-line
              // editing still moves within the text.
              if (e.key === "ArrowUp" && !e.shiftKey && !e.altKey) {
                const pos = e.currentTarget.selectionStart ?? 0;
                const before = e.currentTarget.value.slice(0, pos);
                if (!before.includes("\n")) {
                  const next = prevIndex(hist, histIdx);
                  if (next !== null) {
                    e.preventDefault();
                    if (histIdx === null) setHistDraft(input);
                    setHistIdx(next);
                    setInput(hist[next]);
                  }
                }
              }
              if (e.key === "ArrowDown" && !e.shiftKey && !e.altKey) {
                const pos = e.currentTarget.selectionStart ?? 0;
                const after = e.currentTarget.value.slice(pos);
                if (!after.includes("\n")) {
                  const next = nextIndex(hist, histIdx);
                  if (next !== null) {
                    e.preventDefault();
                    setHistIdx(next);
                    setInput(hist[next]);
                  } else if (histIdx !== null) {
                    e.preventDefault();
                    setHistIdx(null);
                    setInput(histDraft);
                  }
                }
              }
              if (slashOpen) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIdx((i) => (i + (e.key === "ArrowDown" ? 1 : slashRows.length - 1)) % slashRows.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pickSlash(Math.min(slashIdx, slashRows.length - 1));
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSlashOff(input);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="block max-h-56 min-h-11 w-full resize-none overflow-y-auto bg-transparent px-2.5 py-2.5 text-[14.5px] leading-6 text-ink-100 placeholder:text-ink-500 focus:outline-none"
          />
          <div className="flex items-center gap-1 px-0.5 pt-0.5">
            <button
              onClick={() => fileInputRef.current?.click()}
              title={t("chat.attachFiles")}
              aria-label={t("chat.attachFiles")}
              className="aide-icon-button size-8 rounded-full"
              aria-pressed={attachments.length > 0}
            >
              <Paperclip size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) void attach(files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              title={attachFile ? t("chat.detachFile") : t("chat.attachFile")}
              aria-label={attachFile ? t("chat.detachFile") : t("chat.attachFile")}
              aria-pressed={attachFile}
              onClick={() => setAttachFile(!attachFile)}
              className="aide-icon-button size-8 rounded-full aria-pressed:bg-white/[0.08] aria-pressed:text-ink-50"
            >
              <FileText size={16} />
            </button>
            <div ref={modeIndicator.ref} role="group" className="relative isolate ml-1 flex min-w-0 items-center gap-0.5 rounded-full bg-white/[0.04] p-0.5">
              <Indicator box={modeIndicator.box} radius={999} />
              {MODES.map((item) => {
                const Icon = item.icon;
                const selected = mode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    aria-label={item.label}
                    aria-pressed={selected}
                    onClick={() => (item.id === "computer" && !hasComputerConsent() ? setConsentOpen(true) : setMode(item.id))}
                    className={
                      "flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full text-[12.5px] font-medium transition-colors " +
                      (selected ? "px-2.5 text-ink-50" : "w-7 text-ink-500 hover:text-ink-200")
                    }
                  >
                    <Icon size={14} className={"transition-transform duration-300 " + (selected ? "rotate-[-8deg] scale-110" : "")} />
                    {selected && <span key={item.id} className="aide-slide-in truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
            <div className="ml-auto shrink-0">
              {streaming ? (
                <button
                  onClick={stop}
                  title={t("chat.stop")}
                  aria-label={t("chat.stop")}
                  className="aide-working flex size-8 items-center justify-center rounded-full bg-teal-300 text-canvas transition-colors hover:bg-teal-200"
                >
                  <Square size={12} fill="currentColor" className="aide-icon-in" />
                </button>
              ) : (
                <button
                  onClick={submit}
                  title={t("common.send")}
                  aria-label={t("common.send")}
                  disabled={!input.trim()}
                  className={
                    "flex size-8 items-center justify-center rounded-full bg-ink-100 text-canvas transition-colors hover:bg-white disabled:bg-white/[0.06] disabled:text-ink-600 " +
                    (input.trim() ? "aide-send-pop" : "")
                  }
                >
                  <ArrowUp size={16} strokeWidth={2.4} className="aide-icon-in" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-0.5 border-t border-white/[0.06] px-0.5 pt-1.5">
            {vibe && hasKey && (
              <Select
                title={t("settings.provider")}
                value={providerId}
                onChange={setProvider}
                options={providers.map((p) => ({ value: p.id, label: p.name }))}
                className="min-w-0 max-w-32"
                menuMinWidth={200}
              />
            )}
            {hasKey && models.length > 0 && (
              <Select
                title={t("settings.model")}
                value={model}
                onChange={setModel}
                options={models.map((m) => ({ value: m, label: m }))}
                className="min-w-0 max-w-[11rem]"
                menuMinWidth={240}
              />
            )}
            {mode === "agent" && (
              <button
                type="button"
                aria-pressed={autoCheck}
                aria-label={t("autocheck.label")}
                title={`${t("autocheck.label")}: ${t("autocheck.hint")}`}
                onClick={() => setAutoCheck(!autoCheck)}
                className={
                  "ml-auto flex h-7 shrink-0 items-center gap-1 rounded-lg px-1.5 text-[12px] transition-colors " +
                  (autoCheck ? "bg-teal-300/10 text-teal-200 hover:bg-teal-300/15" : "text-ink-500 hover:bg-white/5 hover:text-ink-200")
                }
              >
                <ShieldCheck size={13} />
                <span className="hidden sm:inline">{t("autocheck.short")}</span>
              </button>
            )}
            <Select
              title={t("permission.label")}
              value={permissionMode}
              onChange={(v) => setPermissionMode(v as PermissionMode)}
              options={PERMISSIONS.map((p) => ({ value: p.id, label: p.label }))}
              className={(mode === "agent" ? "" : "ml-auto ") + "max-w-28 shrink-0"}
              menuMinWidth={150}
            />
          </div>
        </div>
        {mode === "computer" && (
          <div role="note" className={"mt-1.5 flex items-start gap-1.5 px-2 text-[12px] leading-5 " + (permissionMode === "full" ? "text-amber-300" : "text-ink-500")}>
            <Monitor size={13} className="mt-1 shrink-0" />
            <span className="min-w-0 flex-1 break-words">
              {permissionMode === "full"
                ? (ru ? rt("Режим «Свобода»: клики и ввод выполняются без подтверждения. Остановить: «Стоп» или мышь в левый верхний угол.") : "“Full” mode: clicks and typing run without confirmation. Stop: the Stop button or the mouse in the top-left corner.")
                : (ru ? rt("Агент смотрит на экран и управляет мышью и клавиатурой. Остановить: «Стоп» или мышь в левый верхний угол.") : "The agent looks at the screen and uses the mouse and keyboard. Stop: the Stop button or the mouse in the top-left corner.")}
            </span>
          </div>
        )}
        {attachNote && (
          <div role="alert" className="mt-1.5 flex items-start gap-1.5 px-2 text-[12.5px] leading-5 text-red-300">
            <CircleAlert size={13} className="mt-1 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{attachNote}</span>
            <button aria-label={ru ? rt("Закрыть") : "Close"} onClick={() => setAttachNote(null)} className="mt-0.5 rounded p-0.5 text-ink-500 hover:text-ink-100">
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      {consentOpen && (
        <ComputerConsent
          onCancel={() => setConsentOpen(false)}
          onAccept={() => {
            grantComputerConsent();
            setConsentOpen(false);
            setMode("computer");
          }}
        />
      )}

      {dragging && (
        <div className="aide-fade pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-[30px] border-2 border-dashed border-teal-300/60 bg-canvas/85 px-6 text-center backdrop-blur-sm">
          <div className="aide-pop flex size-12 items-center justify-center rounded-2xl bg-teal-300/15 text-teal-200 shadow-[0_10px_40px_-10px_rgba(94,234,212,0.6)]">
            <Paperclip size={22} />
          </div>
          <div className="text-[14px] font-medium text-ink-50">{ru ? rt("Отпустите, чтобы прикрепить") : "Drop to attach"}</div>
          <div className="text-[12px] text-ink-400">{ru ? rt("Файлы с компьютера или из дерева проекта · до 8 МБ каждый") : "Files from your computer or the project tree · up to 8 MB each"}</div>
        </div>
      )}
    </div>
  );
}

// New chat + history for the main chat.
function SessionButtons() {
  const chats = useChats((s) => s.chats);
  const activeId = useChats((s) => s.activeId);
  const messages = useAi((s) => s.messages);
  const streaming = useAi((s) => s.streaming);
  // Tasks the agent keeps per chat (stored apart from the chats); read again whenever the list changes.
  const taskMap = useMemo(() => loadTasks(), [chats, messages.length, streaming]);
  const items: ChatItem[] = [
    ...(messages.length > 0
      ? [
          {
            id: activeId ?? "current",
            title: titleOf(messages),
            updatedAt: chats.find((c) => c.id === activeId)?.updatedAt ?? Date.now(),
            active: true,
            tasks: openCount(taskMap, activeId ?? "current"),
          },
        ]
      : []),
    ...chats.filter((c) => c.id !== activeId).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, active: false, tasks: openCount(taskMap, c.id) })),
  ];
  return (
    <ChatSessionButtons
      items={items}
      busy={streaming}
      onNew={() => useChats.getState().newChat()}
      onOpen={(id) => useChats.getState().openChat(id)}
      onDelete={(id) => (id === "current" ? useAi.getState().clear() : useChats.getState().deleteChat(id))}
    />
  );
}
