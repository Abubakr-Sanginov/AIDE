import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FileWarning, Maximize2, Music2, ZoomIn, ZoomOut } from "lucide-react";
import { useI18n } from "@/i18n";
import type { Tab } from "@/stores/tabs";

// Shows photos, videos, sound and PDFs that live in the open project. The file is streamed by the
// Tauri asset protocol, whose scope is the open project only (see open_workspace); nothing is copied into memory.

const TEXT = {
  ru: {
    fit: "Вписать",
    actual: "100%",
    zoomIn: "Приблизить",
    zoomOut: "Отдалить",
    size: "Размер",
    failed: "Не удалось показать файл",
    failedHint: "Возможно, формат не поддерживается окном приложения (например, mkv, avi, heic).",
    noSupport: "Ваш браузер не поддерживает этот плеер.",
  },
  en: {
    fit: "Fit",
    actual: "100%",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    size: "Size",
    failed: "Could not show the file",
    failedHint: "The format may not be supported by the app window (for example mkv, avi, heic).",
    noSupport: "Your browser does not support this player.",
  },
  tg: {
    fit: "Мувофиқ кардан",
    actual: "100%",
    zoomIn: "Калон кардан",
    zoomOut: "Хурд кардан",
    size: "Андоза",
    failed: "Файл нишон дода нашуд",
    failedHint: "Шояд формат аз ҷониби равзанаи барнома дастгирӣ намешавад (масалан, mkv, avi, heic).",
    noSupport: "Браузери шумо ин плеерро дастгирӣ намекунад.",
  },
};

function Failed({ L }: { L: (typeof TEXT)["en"] }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <FileWarning size={30} className="text-ink-500" />
      <div className="text-[14px] font-medium text-ink-200">{L.failed}</div>
      <div className="max-w-sm text-[12.5px] leading-5 text-ink-500">{L.failedHint}</div>
    </div>
  );
}

const STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8];

function ImageView({ src, name, L }: { src: string; name: string; L: (typeof TEXT)["en"] }) {
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [failed, setFailed] = useState(false);
  if (failed) return <Failed L={L} />;
  const step = (dir: 1 | -1) => {
    const cur = zoom === "fit" ? 1 : zoom;
    const i = STEPS.findIndex((s) => s >= cur - 1e-6);
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, (i < 0 ? STEPS.length - 1 : i) + dir))];
    setZoom(next);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 px-3 text-[12.5px] text-ink-400">
        <button aria-label={L.zoomOut} title={L.zoomOut} onClick={() => step(-1)} className="aide-icon-button size-7">
          <ZoomOut size={15} />
        </button>
        <button aria-label={L.zoomIn} title={L.zoomIn} onClick={() => step(1)} className="aide-icon-button size-7">
          <ZoomIn size={15} />
        </button>
        <button aria-pressed={zoom === "fit"} title={L.fit} onClick={() => setZoom("fit")} className="aide-icon-button h-7 gap-1.5 px-2">
          <Maximize2 size={13} />
          {L.fit}
        </button>
        <button aria-pressed={zoom === 1} onClick={() => setZoom(1)} className="aide-icon-button h-7 px-2">
          {L.actual}
        </button>
        <span className="ml-2 tabular-nums">{zoom === "fit" ? "" : `${Math.round(zoom * 100)}%`}</span>
        <span className="ml-auto tabular-nums text-ink-500">{dim ? `${dim.w} × ${dim.h}` : ""}</span>
      </div>
      <div
        className="aide-scroll min-h-0 flex-1 overflow-auto"
        style={{
          backgroundColor: "#161615",
          backgroundImage: "linear-gradient(45deg, rgba(255,255,255,.035) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.035) 75%), linear-gradient(45deg, rgba(255,255,255,.035) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.035) 75%)",
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 10px 10px",
        }}
      >
        <div className="flex min-h-full min-w-full items-center justify-center p-6">
          <img
            src={src}
            alt={name}
            draggable={false}
            onLoad={(e) => setDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
            className="aide-fade rounded-md shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
            style={zoom === "fit" ? { maxWidth: "100%", maxHeight: "calc(100vh - 220px)", objectFit: "contain" } : { width: dim ? dim.w * zoom : undefined, maxWidth: "none", imageRendering: zoom >= 2 ? "pixelated" : "auto" }}
          />
        </div>
      </div>
    </div>
  );
}

/** Photo, video, sound or PDF of the open project. */
export function MediaViewer({ tab }: { tab: Tab }) {
  const { lang } = useI18n();
  const L = TEXT[lang === "tg" ? "tg" : lang === "ru" ? "ru" : "en"];
  const [failed, setFailed] = useState(false);
  const src = useMemo(() => {
    try {
      return convertFileSrc(tab.path);
    } catch {
      return "";
    }
  }, [tab.path]);

  if (!src || failed) return <Failed L={L} />;

  if (tab.media === "image") return <ImageView src={src} name={tab.name} L={L} />;

  if (tab.media === "video") {
    return (
      <div className="flex h-full items-center justify-center bg-black/40 p-4">
        <video
          key={src}
          src={src}
          controls
          preload="metadata"
          onError={() => setFailed(true)}
          className="aide-fade max-h-full max-w-full rounded-xl bg-black shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
        >
          {L.noSupport}
        </video>
      </div>
    );
  }

  if (tab.media === "audio") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 px-8">
        <div className="aide-float flex size-24 items-center justify-center rounded-[32px] border border-white/10 bg-white/[0.04] text-teal-200 shadow-[0_12px_40px_-10px_rgba(94,234,212,0.45)]">
          <Music2 size={38} />
        </div>
        <div className="max-w-full truncate text-[14px] font-medium text-ink-100">{tab.name}</div>
        <audio key={src} src={src} controls preload="metadata" onError={() => setFailed(true)} className="w-full max-w-md">
          {L.noSupport}
        </audio>
      </div>
    );
  }

  // PDF: the window's built-in viewer
  return <iframe key={src} src={src} title={tab.name} className="h-full w-full border-0 bg-white" />;
}
