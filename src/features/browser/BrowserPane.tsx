import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeft, ArrowRight, Bug, ChevronDown, ChevronUp, Eraser, Maximize2, Minimize2, Monitor, RotateCw, Smartphone, Tablet, Terminal } from "lucide-react";
import { create } from "zustand";
import { useI18n } from "@/i18n";

/** Address the agent (or anything else) wants the browser to open; the pane picks it up when shown. */
export const useBrowserIntent = create<{ url: string | null; set: (u: string | null) => void }>((set) => ({ url: null, set: (url) => set({ url }) }));

// Embedded browser: the page lives in a native child webview that the backend places over the
// viewport box below. The console is read back from the page by the backend and shown as text.

interface Entry {
  n: number;
  t: number;
  l: "log" | "info" | "warn" | "error" | "debug" | "in" | "out";
  m: string;
}

const MAX_ENTRIES = 1000;

/** Screen sizes (CSS pixels) the page can pretend to have. Keep in sync with DEVICES in browser_viewport.rs. */
const DEVICES = [
  { id: "mobile", w: 390, h: 844, Icon: Smartphone, ru: "Телефон", en: "Phone" },
  { id: "tablet", w: 820, h: 1180, Icon: Tablet, ru: "Планшет", en: "Tablet" },
  { id: "desktop", w: 1440, h: 900, Icon: Monitor, ru: "Компьютер", en: "Desktop" },
] as const;
type Viewport = { w: number; h: number } | null;
const sys = (l: Entry["l"], m: string): Entry => ({ n: -Date.now(), t: Date.now(), l, m });

/** "localhost:5173" -> http://, "example.com" -> https://; anything with a scheme is left to the backend to judge. */
function normalize(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(v)) return `http://${v}`;
  return `https://${v}`;
}

const TONE: Record<Entry["l"], string> = {
  log: "text-ink-200",
  info: "text-sky-300",
  debug: "text-ink-500",
  warn: "text-amber-300",
  error: "text-red-400",
  in: "text-teal-300",
  out: "text-ink-400",
};

/** Native webviews sit above the page, so they must step aside for dialogs and menus. */
function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(document.querySelector('[role="dialog"],[role="menu"],[role="listbox"],[aria-modal="true"]') !== null);
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return open;
}

export function BrowserPane() {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const boxRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(true);
  // Full screen: the page fills the whole window (and the window itself goes full screen). Esc leaves it.
  const [full, setFull] = useState(false);
  const consoleBeforeFull = useRef(true);
  const [viewport, setViewport] = useState<Viewport>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [expr, setExpr] = useState("");
  const sinceRef = useRef(0);
  const epochRef = useRef("");
  const logRef = useRef<HTMLDivElement>(null);
  const overlay = useOverlayOpen();
  const intent = useBrowserIntent((s) => s.url);

  const rect = useCallback(() => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width < 2 || r.height < 2) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, []);

  const go = useCallback(
    async (raw: string) => {
      const url = normalize(raw);
      if (!url) return;
      setError("");
      // The panel may still be animating in or laid out: wait (up to ~1.5 s) for the viewport box to get a size.
      let r = rect();
      for (let i = 0; i < 30 && !r; i++) {
        await new Promise((res) => setTimeout(res, 50));
        r = rect();
      }
      if (!r) {
        setError(ru ? rt("Область браузера слишком мала: расширьте панель.") : "The browser area is too small: widen the panel.");
        return;
      }
      try {
        await invoke("bv_open", { url, x: r.x, y: r.y, w: r.w, h: r.h, newTab: false });
        setOpened(true);
        setAddress(url);
      } catch (e) {
        setError(String(e));
      }
    },
    [rect, ru],
  );

  // Coming back to this tab: the native page is still alive, so show it again instead of the empty start screen.
  useEffect(() => {
    let alive = true;
    void invoke<string | null>("bv_info")
      .then((url) => {
        if (!alive || !url) return;
        const attempt = (tries: number) => {
          const r = rect();
          if (!r) {
            if (tries < 30) requestAnimationFrame(() => attempt(tries + 1));
            return;
          }
          void invoke("bv_open", { x: r.x, y: r.y, w: r.w, h: r.h, newTab: false })
            .then(() => {
              if (!alive) return;
              setOpened(true);
              setAddress(url);
            })
            .catch(() => {});
        };
        attempt(0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [rect]);

  // The agent asked for a page: open it once the viewport box has a size.
  useEffect(() => {
    if (!intent) return;
    let tries = 0;
    const attempt = () => {
      if (rect()) {
        useBrowserIntent.getState().set(null);
        void go(intent);
      } else if (tries++ < 30) {
        requestAnimationFrame(attempt);
      }
    };
    attempt();
  }, [intent, rect, go]);

  useEffect(() => {
    if (!full) return;
    consoleBeforeFull.current = consoleOpen;
    setConsoleOpen(false); // the whole screen is for the site
    let win: ReturnType<typeof getCurrentWindow> | null = null;
    try {
      win = getCurrentWindow();
      void win.setFullscreen(true).catch(() => {});
    } catch {
      /* plain browser preview: no window to resize */
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      setConsoleOpen(consoleBeforeFull.current);
      try {
        void win?.setFullscreen(false).catch(() => {});
      } catch {
        /* nothing to restore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

  // Keep the native view glued to the viewport box; hide it while a dialog/menu is open or this tab is gone.
  useEffect(() => {
    if (!opened) return;
    const sync = () => {
      const r = rect();
      if (r) void invoke("bv_bounds", { x: r.x, y: r.y, w: r.w, h: r.h }).catch(() => {});
    };
    const ro = new ResizeObserver(sync);
    if (boxRef.current) ro.observe(boxRef.current);
    window.addEventListener("resize", sync);
    const tick = window.setInterval(sync, 500); // catches moves without a resize (panel dragging, layout shifts)
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.clearInterval(tick);
    };
  }, [opened, rect, consoleOpen, full]);

  useEffect(() => {
    if (!opened) return;
    void invoke("bv_visible", { visible: !overlay }).catch(() => {});
  }, [opened, overlay]);
  useEffect(() => () => void invoke("bv_visible", { visible: false }).catch(() => {}), []);

  useEffect(() => {
    const offs: (() => void)[] = [];
    void listen<{ url: string; loading: boolean }>("bv-nav", (e) => {
      setLoading(e.payload.loading);
      if (e.payload.url && e.payload.url !== "about:blank") {
        setAddress(e.payload.url);
      }
    }).then((f) => offs.push(f));
    void listen<{ title: string }>("bv-title", (e) => setTitle(e.payload.title)).then((f) => offs.push(f));
    return () => offs.forEach((f) => f());
  }, []);

  // Console polling while the page exists.
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    const poll = async () => {
      try {
        const raw = await invoke<string>("bv_console", { since: sinceRef.current });
        if (!alive || !raw) return;
        const data = JSON.parse(raw) as { epoch?: unknown; total?: unknown; entries?: unknown };
        const epoch = String(data.epoch ?? "");
        const fresh = Array.isArray(data.entries) ? (data.entries as Entry[]) : [];
        if (epoch !== epochRef.current) {
          // New document: the page's buffer restarted, so ask again from the beginning.
          const first = epochRef.current === "";
          epochRef.current = epoch;
          sinceRef.current = 0;
          if (!first) setEntries((e) => [...e, sys("out", ru ? rt("— страница перезагружена —") : "— page reloaded —")].slice(-MAX_ENTRIES));
          return;
        }
        if (fresh.length > 0) {
          sinceRef.current = Math.max(sinceRef.current, ...fresh.map((x) => Number(x.n) || 0));
          const clean: Entry[] = fresh
            .filter((x) => x && typeof x.m === "string")
            .map((x) => ({ n: Number(x.n) || 0, t: Number(x.t) || Date.now(), l: (["log", "info", "warn", "error", "debug"] as const).includes(x.l as "log") ? x.l : "log", m: x.m.slice(0, 2000) }));
          setEntries((e) => [...e, ...clean].slice(-MAX_ENTRIES));
        }
      } catch {
        /* page not ready yet */
      }
    };
    const id = window.setInterval(() => void poll(), 1000);
    void poll();
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [opened, ru]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, consoleOpen]);

  // The page's screen size: set here or by the agent (it announces changes with an event).
  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void invoke<[number, number] | null>("bv_viewport_get")
      .then((v) => alive && setViewport(v ? { w: v[0], h: v[1] } : null))
      .catch(() => {});
    void listen<{ width: number | null; height: number | null }>("bv-viewport", (e) => {
      const { width, height } = e.payload;
      setViewport(width && height ? { w: width, h: height } : null);
    }).then((f) => (alive ? (off = f) : f()));
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  // Own size: two fields under the page. Both empty = fit the panel; limits match the backend.
  const [wText, setWText] = useState("");
  const [hText, setHText] = useState("");
  useEffect(() => {
    setWText(viewport ? String(viewport.w) : "");
    setHText(viewport ? String(viewport.h) : "");
  }, [viewport]);
  const applySize = () => {
    const w = Number(wText), h = Number(hText);
    if (!wText.trim() && !hText.trim()) {
      void invoke("bv_viewport", {}).then(() => setViewport(null)).catch((e) => setError(String(e)));
      return;
    }
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 200 || w > 3840 || h < 200 || h > 2400) {
      setError(ru ? rt("Размер окна: ширина 200–3840, высота 200–2400 пикселей") : "Window size: width 200–3840, height 200–2400 pixels");
      return;
    }
    setError("");
    void invoke("bv_viewport", { width: w, height: h }).then(() => setViewport({ w, h })).catch((e) => setError(String(e)));
  };

  const pickDevice = (d: (typeof DEVICES)[number]) => {
    const same = viewport?.w === d.w && viewport?.h === d.h;
    // Pressing the active size again goes back to "fit the panel".
    void invoke("bv_viewport", same ? {} : { width: d.w, height: d.h })
      .then(() => setViewport(same ? null : { w: d.w, h: d.h }))
      .catch((e) => setError(String(e)));
  };

  const act = (a: "back" | "forward" | "reload" | "stop") => void invoke("bv_action", { action: a }).catch(() => {});

  const runExpr = async () => {
    const code = expr.trim();
    if (!code || !opened) return;
    setExpr("");
    setEntries((e) => [...e, sys("in", `> ${code}`)].slice(-MAX_ENTRIES));
    try {
      const out = await invoke<string>("bv_eval", { code });
      setEntries((e) => [...e, sys("out", out)].slice(-MAX_ENTRIES));
    } catch (err) {
      setEntries((e) => [...e, sys("error", String(err))].slice(-MAX_ENTRIES));
    }
  };

  const errors = entries.filter((e) => e.l === "error").length;

  const exitLabel = ru ? rt("Выйти из полноэкранного режима") : "Exit full screen";
  const enterLabel = ru ? rt("На весь экран") : "Full screen";
  const tree = (
    <div className={full ? "fixed inset-0 z-[90] flex flex-col bg-canvas" : "flex h-full min-h-0 flex-col"}>
      <div className="flex h-10 shrink-0 items-center gap-1 px-2">
        <button aria-label={ru ? rt("Назад") : "Back"} disabled={!opened} onClick={() => act("back")} className="aide-icon-button size-7 disabled:opacity-40">
          <ArrowLeft size={14} />
        </button>
        <button aria-label={ru ? rt("Вперёд") : "Forward"} disabled={!opened} onClick={() => act("forward")} className="aide-icon-button size-7 disabled:opacity-40">
          <ArrowRight size={14} />
        </button>
        <button aria-label={ru ? rt("Обновить") : "Reload"} disabled={!opened} onClick={() => act(loading ? "stop" : "reload")} className={"aide-icon-button size-7 disabled:opacity-40 " + (loading ? "animate-spin" : "")}>
          <RotateCw size={14} />
        </button>
        <input
          value={address}
          spellCheck={false}
          placeholder={ru ? rt("Адрес сайта или localhost:порт") : "Site address or localhost:port"}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void go(address);
          }}
          className="h-7 min-w-0 flex-1 rounded-lg bg-white/[0.06] px-2.5 text-[13px] text-ink-100 outline-none placeholder:text-ink-500 focus:bg-white/[0.09]"
        />
        {DEVICES.map((d) => {
          const on = viewport?.w === d.w && viewport?.h === d.h;
          const label = `${ru ? rt(d.ru) : d.en} ${d.w}×${d.h}`;
          return (
            <button key={d.id} aria-label={label} title={label} aria-pressed={on} disabled={!opened} onClick={() => pickDevice(d)} className="aide-icon-button size-7 disabled:opacity-40 aria-pressed:bg-white/[0.08]">
              <d.Icon size={14} />
            </button>
          );
        })}
        <button
          aria-label={ru ? rt("Консоль") : "Console"}
          aria-pressed={consoleOpen}
          onClick={() => setConsoleOpen((v) => !v)}
          className="aide-icon-button relative size-7 aria-pressed:bg-white/[0.08]"
        >
          <Terminal size={14} />
          {errors > 0 && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-red-400" />}
        </button>
        <button aria-label={full ? exitLabel : enterLabel} title={(full ? exitLabel : enterLabel) + (full ? " (Esc)" : "")} aria-pressed={full} onClick={() => setFull((v) => !v)} className="aide-icon-button size-7 aria-pressed:bg-white/[0.08]">
          {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        {import.meta.env.DEV && (
          <button aria-label="DevTools" disabled={!opened} onClick={() => void invoke("bv_devtools").catch((e) => setError(String(e)))} className="aide-icon-button size-7 disabled:opacity-40">
            <Bug size={14} />
          </button>
        )}
      </div>

      <div ref={boxRef} className="relative min-h-0 flex-1 bg-black/20">
        {!opened && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="text-[14px] font-medium text-ink-200">{ru ? rt("Встроенный браузер") : "Built-in browser"}</div>
            <div className="text-[13px] text-ink-500">{ru ? rt("Откройте свой проект (localhost:5173) или любой сайт.") : "Open your project (localhost:5173) or any site."}</div>
          </div>
        )}
        {error && <div className="absolute inset-x-0 top-0 z-10 bg-red-950/80 px-3 py-1.5 text-[12.5px] text-red-200">{error}</div>}
      </div>
      {opened && (
        <div className="flex items-center gap-2 px-3 py-1 text-[12px] text-ink-500">
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <form
            className="flex shrink-0 items-center gap-1 font-mono"
            onSubmit={(e) => {
              e.preventDefault();
              applySize();
            }}
          >
            <input aria-label={ru ? rt("Ширина окна, px") : "Window width, px"} value={wText} placeholder="W" inputMode="numeric" maxLength={4} onChange={(e) => setWText(e.target.value.replace(/\D/g, ""))} onBlur={() => (wText !== String(viewport?.w ?? "") || hText !== String(viewport?.h ?? "")) && applySize()} className="h-5 w-12 rounded bg-white/[0.06] px-1 text-center text-ink-200 outline-none placeholder:text-ink-600 focus:bg-white/[0.1]" />
            <span>×</span>
            <input aria-label={ru ? rt("Высота окна, px") : "Window height, px"} value={hText} placeholder="H" inputMode="numeric" maxLength={4} onChange={(e) => setHText(e.target.value.replace(/\D/g, ""))} onBlur={() => (wText !== String(viewport?.w ?? "") || hText !== String(viewport?.h ?? "")) && applySize()} className="h-5 w-12 rounded bg-white/[0.06] px-1 text-center text-ink-200 outline-none placeholder:text-ink-600 focus:bg-white/[0.1]" />
          </form>
        </div>
      )}

      <div className="flex shrink-0 flex-col border-t border-line/60" style={{ height: consoleOpen ? 200 : 30 }}>
        <div className="flex h-[30px] shrink-0 items-center gap-2 px-3 text-[12.5px] text-ink-300">
          <button onClick={() => setConsoleOpen((v) => !v)} className="flex items-center gap-1 hover:text-ink-50">
            {consoleOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            {ru ? rt("Консоль") : "Console"}
            {errors > 0 && <span className="rounded-full bg-red-400/20 px-1.5 text-[11px] text-red-300">{errors}</span>}
          </button>
          <button aria-label={ru ? rt("Очистить") : "Clear"} onClick={() => setEntries([])} className="ml-auto text-ink-500 hover:text-ink-100">
            <Eraser size={13} />
          </button>
        </div>
        {consoleOpen && (
          <>
            <div ref={logRef} className="aide-scroll min-h-0 flex-1 select-text overflow-y-auto px-3 font-mono text-[12px] leading-5">
              {entries.length === 0 && <div className="text-ink-600">{ru ? rt("Сообщений консоли пока нет.") : "No console messages yet."}</div>}
              {entries.map((e, i) => (
                <div key={i} className={"whitespace-pre-wrap break-words " + TONE[e.l]}>
                  {e.m}
                </div>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-2 px-3 py-1">
              <span className="font-mono text-[12px] text-teal-300">›</span>
              <input
                value={expr}
                disabled={!opened}
                spellCheck={false}
                placeholder={ru ? rt("Выражение для страницы (Enter)") : "Expression for the page (Enter)"}
                onChange={(e) => setExpr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runExpr();
                }}
                className="h-6 w-full bg-transparent font-mono text-[12px] text-ink-200 outline-none placeholder:text-ink-600"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
  return full ? createPortal(tree, document.body) : tree;
}
