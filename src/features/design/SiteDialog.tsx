import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, Loader2, Monitor, Smartphone, Tablet, X, type LucideIcon } from "lucide-react";
import { buildSiteBrief, fetchSite, normalizeUrl } from "@/features/design/site";
import { useDesign, type Device } from "@/features/design/store";
import { useDesignText } from "@/features/design/strings";

const DEVICE_OPTIONS: { id: Device; icon: LucideIcon; labelKey: "desktop" | "tablet" | "mobile" }[] = [
  { id: "desktop", icon: Monitor, labelKey: "desktop" },
  { id: "tablet", icon: Tablet, labelKey: "tablet" },
  { id: "mobile", icon: Smartphone, labelKey: "mobile" },
];

/** "Site as an example": paste a link, pick devices, the AI recreates the page's design. */
export function SiteDialog() {
  const T = useDesignText();
  const open = useDesign((s) => s.siteDialog);
  const close = () => useDesign.getState().setSiteDialog(false);
  const [url, setUrl] = useState("");
  const [devices, setDevices] = useState<Device[]>(["desktop"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) useDesign.getState().setSiteDialog(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading]);

  if (!open) return null;

  const submit = async () => {
    if (loading) return;
    const normalized = normalizeUrl(url);
    const pasted = html.trim();
    // The address is required to download a page; with pasted source it is optional.
    if ((!pasted && !normalized) || (url.trim() && !normalized)) {
      setError(T.siteBadUrl);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const snapshot = await fetchSite(normalized ?? "", pasted || undefined);
      const brief = buildSiteBrief(snapshot);
      if (!brief.url) brief.url = brief.name;
      useDesign.getState().copySite(brief, devices);
      setUrl("");
      setHtml("");
      setShowPaste(false);
      useDesign.getState().setSiteDialog(false);
    } catch (e) {
      const message = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
      setError(message);
      // A refused download: offer the manual way right away.
      if (/Ctrl\+U|не разрешил/i.test(message)) setShowPaste(true);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (d: Device) =>
    setDevices((cur) => (cur.includes(d) ? (cur.length > 1 ? cur.filter((x) => x !== d) : cur) : [...cur, d]));

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/55 px-4 pt-[14vh]"
      onPointerDown={() => !loading && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={T.siteTitle}
        className="aide-fade-in w-full max-w-[480px] rounded-2xl border border-line-strong bg-overlay p-5 shadow-2xl shadow-black/70"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink-50">
            <Globe size={17} className="text-ink-300" />
            {T.siteTitle}
          </h2>
          <button onClick={close} disabled={loading} aria-label={T.cancel} className="aide-icon-button size-7 disabled:opacity-40">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-[13px] leading-5 text-ink-400">{T.siteHint}</p>

        <label className="mb-1.5 block text-[12.5px] text-ink-300" htmlFor="site-url">
          {T.siteUrl}
        </label>
        <input
          id="site-url"
          ref={inputRef}
          value={url}
          disabled={loading}
          spellCheck={false}
          autoComplete="off"
          placeholder="https://example.com"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          className="h-10 w-full rounded-lg border border-line-strong bg-canvas px-3 text-[14px] text-ink-100 outline-none transition-colors placeholder:text-ink-500 focus:border-white/30 disabled:opacity-60"
        />

        <div className="mb-1.5 mt-4 text-[12.5px] text-ink-300">{T.siteDevices}</div>
        <div className="flex gap-2">
          {DEVICE_OPTIONS.map(({ id, icon: Icon, labelKey }) => {
            const on = devices.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                disabled={loading}
                onClick={() => toggle(id)}
                className={
                  "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border text-[13px] transition-colors disabled:opacity-60 " +
                  (on ? "border-white/30 bg-white/[0.1] text-ink-50" : "border-line-strong text-ink-400 hover:bg-white/[0.05] hover:text-ink-100")
                }
              >
                <Icon size={15} />
                {T[labelKey]}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => setShowPaste((v) => !v)}
          className="mt-3 text-[12.5px] text-ink-400 underline decoration-ink-600 underline-offset-2 transition-colors hover:text-ink-100 disabled:opacity-50"
        >
          {T.sitePasteToggle}
        </button>
        {showPaste && (
          <div className="mt-2">
            <p className="mb-1.5 text-[12px] leading-5 text-ink-500">{T.sitePasteHint}</p>
            <textarea
              value={html}
              disabled={loading}
              rows={5}
              spellCheck={false}
              placeholder={T.sitePastePlaceholder}
              onChange={(e) => setHtml(e.target.value)}
              className="aide-scroll w-full resize-y rounded-lg border border-line-strong bg-canvas px-3 py-2 font-mono text-[12px] leading-5 text-ink-100 outline-none transition-colors placeholder:text-ink-500 focus:border-white/30 disabled:opacity-60"
            />
          </div>
        )}

        {error && <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] leading-5 text-red-300">{error}</div>}

        <p className="mt-4 text-[12px] leading-5 text-ink-500">{T.siteNote}</p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={close}
            disabled={loading}
            className="h-9 rounded-lg px-3.5 text-[13px] text-ink-300 transition-colors hover:bg-white/[0.06] hover:text-ink-50 disabled:opacity-40"
          >
            {T.cancel}
          </button>
          <button
            onClick={() => void submit()}
            disabled={loading || (!url.trim() && !html.trim())}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-medium text-canvas transition-[filter] hover:brightness-110 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {T.siteLoading}
              </>
            ) : (
              T.siteStart
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
