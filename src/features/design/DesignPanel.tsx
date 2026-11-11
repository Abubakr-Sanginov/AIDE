import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@/ui/Markdown";
import { ArrowUp, Brain, ChevronDown, CircleAlert, Globe, Layers, Moon, Plus, RefreshCw, SlidersHorizontal, Smartphone, Square, Trash2, Wand2, X, type LucideIcon } from "lucide-react";
import { Select } from "@/ui/Select";
import { ChatSessionButtons, type ChatItem } from "@/ui/ChatHistory";
import { useAi } from "@/stores/ai";
import { buildLayers, guessTitle } from "@/features/design/dom";
import { LayersTab } from "@/features/design/LayersTab";
import { PropertiesTab } from "@/features/design/PropertiesTab";
import { splitReply } from "@/features/design/reply";
import { useDesign } from "@/features/design/store";
import { useDesignText } from "@/features/design/strings";

export function DesignPanel() {
  const T = useDesignText();
  const leftTab = useDesign((s) => s.leftTab);
  const setLeftTab = useDesign((s) => s.setLeftTab);
  const width = useDesign((s) => s.panelWidth);

  const textTab = (id: "ai", label: string) => (
    <button
      role="tab"
      aria-selected={leftTab === id}
      onClick={() => setLeftTab(id)}
      className={
        "flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-[14px] font-medium transition-colors " +
        (leftTab === id ? "bg-white/[0.06] text-ink-50" : "text-ink-400 hover:text-ink-100")
      }
    >
      {label}
    </button>
  );

  // Secondary views are compact icon tabs so the title row never wraps.
  const iconTab = (id: "layers" | "props", label: string, Icon: LucideIcon) => (
    <button
      role="tab"
      aria-selected={leftTab === id}
      title={label}
      aria-label={label}
      onClick={() => setLeftTab(id)}
      className={
        "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors " +
        (leftTab === id ? "bg-white/[0.06] text-ink-50" : "text-ink-400 hover:bg-white/[0.04] hover:text-ink-100")
      }
    >
      <Icon size={16} />
    </button>
  );

  return (
    <aside style={{ width }} className="aide-flat flex shrink-0 select-none flex-col">
      <div role="tablist" className="flex h-11 shrink-0 items-center gap-1 px-2">
        {textTab("ai", T.refineWithAi)}
        {iconTab("layers", T.layers, Layers)}
        {iconTab("props", T.properties, SlidersHorizontal)}
        <div className="ml-auto flex shrink-0 items-center">
          <SessionButtons />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {leftTab === "ai" ? <AiTab /> : leftTab === "layers" ? <LayersTab /> : <PropertiesTab />}
      </div>
    </aside>
  );
}

function AiTab() {
  const T = useDesignText();
  const messages = useDesign((s) => s.messages);
  const status = useDesign((s) => s.status);
  const html = useDesign((s) => s.html);
  const hasContent = useDesign((s) => s.frames.some((f) => f.html.trim().length > 0));
  const selectedId = useDesign((s) => s.selectedId);
  const layers = useMemo(() => buildLayers(html), [html]);
  const selected = layers.find((l) => l.id === selectedId) ?? null;
  const models = useAi((s) => s.models);
  const model = useAi((s) => s.model);
  const setModel = useAi((s) => s.setModel);
  const hasKey = useAi((s) => s.hasKey);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streaming = status === "streaming";

  const liveSize = useDesign((s) => s.buffer.length + s.thinking.length);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, liveSize]);

  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  const submit = () => {
    if (!input.trim() || streaming) return;
    useDesign.getState().send(input);
    setInput("");
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="pt-6 text-center text-[13px] leading-5 text-ink-500">{T.emptySubtitle}</p>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="aide-msg-user flex justify-end">
              <div className="max-w-[88%] whitespace-pre-wrap rounded-[26px] bg-raised px-4 py-2.5 text-[14px] leading-6 text-ink-50">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.id} className="aide-msg-ai text-[14px] leading-6 text-ink-100">
              {m.thinking && <ThinkingBlock text={m.thinking} />}
              <div className="flex items-start gap-2">
                {m.error && <CircleAlert size={15} className="mt-1 shrink-0 text-accent" />}
                <div className="min-w-0 flex-1">
                  <div className="break-words"><Markdown content={m.text} /></div>
                  {m.retryable && m.id === messages[messages.length - 1]?.id && !streaming && (
                    <div className="mt-2">
                      <button
                        onClick={() => useDesign.getState().retry()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-canvas transition-[filter] hover:brightness-110"
                      >
                        <RefreshCw size={13} />
                        {T.retry}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ),
        )}
        {streaming && <LiveReply />}
      </div>

      {hasContent && !streaming && (
        <div className="flex shrink-0 flex-wrap gap-1.5 px-3 pb-1.5">
          <QuickChip onClick={() => useDesign.getState().adaptFrame(useDesign.getState().activeFrameId)}>
            <Smartphone size={13} />
            {T.adapt}
          </QuickChip>
          <QuickChip onClick={() => useDesign.getState().send(T.quickDarkPrompt)}>
            <Moon size={13} />
            {T.quickDark}
          </QuickChip>
          <QuickChip onClick={() => useDesign.getState().send(T.quickScreenPrompt)}>
            <Plus size={13} />
            {T.quickScreen}
          </QuickChip>
          <QuickChip onClick={() => useDesign.getState().send(T.quickImprovePrompt)}>
            <Wand2 size={13} />
            {T.quickImprove}
          </QuickChip>
          <QuickChip onClick={() => useDesign.getState().setSiteDialog(true)}>
            <Globe size={13} />
            {T.siteChip}
          </QuickChip>
        </div>
      )}

      <div className="shrink-0 px-2 pb-2 pt-1">
        <div className="aide-composer rounded-2xl border border-line-strong bg-raised px-1.5 pb-1.5 pt-1" data-busy={streaming}>
          {selected && (
            <div className="px-1.5 pt-1.5">
              <span className="aide-pop inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white/[0.07] py-0.5 pl-2 pr-1 text-[12.5px] text-ink-100">
                <span className="font-mono text-[#6ea8ff]">&lt;{selected.tag}&gt;</span>
                {selected.label && <span className="truncate text-ink-300">“{selected.label}”</span>}
                <button
                  title={T.clearSelection}
                  aria-label={T.clearSelection}
                  onClick={() => useDesign.getState().select(null)}
                  className="rounded p-0.5 text-ink-400 hover:bg-white/[0.1] hover:text-ink-50"
                >
                  <X size={12} />
                </button>
              </span>
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder={hasContent ? T.askPlaceholder : T.createPlaceholder}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="block max-h-40 min-h-9 w-full resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-[14px] leading-5 text-ink-100 placeholder:text-ink-500 focus:outline-none"
          />
          <div className="flex h-8 items-center gap-1">
            <button
              title={T.siteTitle}
              aria-label={T.siteTitle}
              disabled={streaming}
              onClick={() => useDesign.getState().setSiteDialog(true)}
              className="aide-icon-button size-7 disabled:opacity-40"
            >
              <Globe size={15} />
            </button>
            {selected && (
              <button
                title={T.deleteEl}
                aria-label={T.deleteEl}
                onClick={() => useDesign.getState().deleteSelected()}
                className="aide-icon-button size-7"
              >
                <Trash2 size={15} />
              </button>
            )}
            <div className="ml-auto flex min-w-0 items-center gap-0.5">
              {hasKey && models.length > 0 && (
                <Select
                  value={model}
                  onChange={setModel}
                  options={models.map((m) => ({ value: m, label: m }))}
                  className="min-w-0 max-w-40"
                  menuMinWidth={240}
                />
              )}
              {streaming ? (
                <button
                  onClick={() => useDesign.getState().stop()}
                  title={T.stop}
                  aria-label={T.stop}
                  className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.1] text-ink-50 hover:bg-white/[0.16]"
                >
                  <Square size={11} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={submit}
                  title={T.send}
                  aria-label={T.send}
                  disabled={!input.trim()}
                  className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-canvas transition-colors hover:bg-white disabled:bg-white/[0.06] disabled:text-ink-600"
                >
                  <ArrowUp size={15} strokeWidth={2.4} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionButtons() {
  const chats = useDesign((s) => s.chats);
  const chatId = useDesign((s) => s.chatId);
  const messages = useDesign((s) => s.messages);
  const status = useDesign((s) => s.status);
  const firstUser = messages.find((m) => m.role === "user")?.text.slice(0, 48) ?? "";
  const items: ChatItem[] = chats
    .filter((c) => c.id === chatId || c.frames.some((f) => f.html) || c.messages.length > 0)
    .map((c) => ({
      id: c.id,
      title: (c.id === chatId ? c.title || firstUser : c.title) || guessTitle(c.frames.find((f) => f.html)?.html ?? ""),
      updatedAt: c.updatedAt,
      active: c.id === chatId,
    }));
  return (
    <ChatSessionButtons
      items={items}
      busy={status === "streaming"}
      onNew={() => useDesign.getState().newChat()}
      onOpen={(id) => useDesign.getState().openChat(id)}
      onDelete={(id) => useDesign.getState().deleteChat(id)}
    />
  );
}

/** The model's reasoning, collapsed by default. */
function ThinkingBlock({ text, live }: { text: string; live?: boolean }) {
  const T = useDesignText();
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const expanded = open || !!live;
  useEffect(() => {
    if (live && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, live]);
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12px] text-ink-400 transition-colors hover:bg-white/[0.05] hover:text-ink-200"
      >
        <Brain size={13} className={"shrink-0 " + (live ? "animate-pulse text-ink-200" : "")} />
        {T.thinking}
        <ChevronDown size={12} className={"shrink-0 transition-transform duration-150 " + (expanded ? "rotate-180" : "")} />
      </button>
      {expanded && (
        <div
          ref={bodyRef}
          className="aide-scroll mt-1 max-h-44 overflow-auto whitespace-pre-wrap border-l border-line-strong pl-3 text-[12px] leading-5 text-ink-500"
        >
          {text}
        </div>
      )}
    </div>
  );
}

/** The reply as it streams: reasoning, the message to the user, and a "designing" marker. */
function LiveReply() {
  const T = useDesignText();
  const buffer = useDesign((s) => s.buffer);
  const thinking = useDesign((s) => s.thinking);
  const reply = useMemo(() => splitReply(buffer), [buffer]);
  const job = useDesign((s) => s.job);
  const startedAt = useDesign((s) => s.startedAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const idle = !buffer && !thinking; // nothing has arrived yet
  return (
    <div className="text-[14px] leading-6 text-ink-100">
      {thinking && <ThinkingBlock text={thinking} live />}
      {reply.text && <div className="break-words"><Markdown content={reply.text} /></div>}
      <div className="mt-1 flex items-center gap-2 text-[13px] text-ink-400">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ink-300 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-ink-200" />
        </span>
        {job
          ? T.jobProgress.replace("{label}", job.label).replace("{i}", String(job.index + 1)).replace("{n}", String(job.total))
          : reply.designing
            ? T.designing
            : T.working}
        <span className="font-mono text-[12px] tabular-nums text-ink-500">{clock}</span>
      </div>
      {idle && elapsed >= 45 && <div className="mt-1 text-[12.5px] leading-5 text-ink-500">{T.slowModel}</div>}
    </div>
  );
}

function QuickChip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-3 text-[12.5px] text-ink-300 transition-colors hover:bg-white/[0.06] hover:text-ink-50"
    >
      {children}
    </button>
  );
}
