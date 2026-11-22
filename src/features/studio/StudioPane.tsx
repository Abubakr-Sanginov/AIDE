import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Box, Image as ImageIcon, FolderOpen, Trash2 } from "lucide-react";
import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useI18n } from "@/i18n";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { useStudio, type AssetInfo } from "@/features/studio/store";
import { ModelViewer } from "@/features/studio/ModelViewer";
import { dataUri } from "@/lib/studioPreview";

/** The "3D Studio" tab: a live preview (renders, viewport screenshots, GLB models) above the agent chat. */
export function StudioPane() {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const L = (r: string, e: string) => (ru ? rt(r) : e);
  const { items, index, model, view, open, error, select, step, setOpen, clear, openFile, listAssets } = useStudio();
  const [files, setFiles] = useState<AssetInfo[] | null>(null);
  const current = items[index];
  const showModel = view === "model" && model;

  const toggleFiles = async () => setFiles(files ? null : await listAssets());

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line/60">
        <div className="flex h-8 items-center gap-1 px-2 text-[12px] text-ink-300">
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex items-center gap-1 rounded px-1 py-0.5 font-medium text-ink-100 hover:bg-white/5"
          >
            <ChevronDown size={14} className={open ? "" : "-rotate-90"} />
            {L("Предпросмотр", "Preview")}
          </button>
          <span className="truncate text-ink-500">{showModel ? model.name : current ? current.name : ""}</span>
          <span className="ml-auto flex items-center gap-0.5">
            {items.length > 0 && (
              <>
                <button aria-label={L("Назад", "Previous")} disabled={index <= 0} onClick={() => step(-1)} className="aide-icon-button size-6 disabled:opacity-30">
                  <ChevronLeft size={14} />
                </button>
                <span className="min-w-[2.5rem] text-center tabular-nums text-ink-400">
                  {index + 1}/{items.length}
                </span>
                <button aria-label={L("Вперёд", "Next")} disabled={index >= items.length - 1} onClick={() => step(1)} className="aide-icon-button size-6 disabled:opacity-30">
                  <ChevronRight size={14} />
                </button>
              </>
            )}
            {model && (
              <button
                aria-label={view === "model" ? L("Показать картинки", "Show images") : L("Показать модель", "Show model")}
                title={view === "model" ? L("Показать картинки", "Show images") : L("Показать модель", "Show model")}
                onClick={() => useStudio.setState({ view: view === "model" ? "image" : "model" })}
                className="aide-icon-button size-6"
              >
                {view === "model" ? <ImageIcon size={14} /> : <Box size={14} />}
              </button>
            )}
            <button aria-label={L("Файлы проекта", "Project files")} title={L("Файлы проекта: картинки и модели", "Project files: images and models")} onClick={() => void toggleFiles()} className="aide-icon-button size-6">
              <FolderOpen size={14} />
            </button>
            <button
              aria-label={L("Очистить", "Clear")}
              title={L("Очистить предпросмотр", "Clear preview")}
              disabled={items.length === 0 && !model}
              onClick={clear}
              className="aide-icon-button size-6 disabled:opacity-30"
            >
              <Trash2 size={14} />
            </button>
          </span>
        </div>

        {files && (
          <ul className="aide-scroll max-h-40 overflow-auto border-t border-line/60 bg-canvas/40 py-1 text-[12.5px]">
            {files.length === 0 && <li className="px-3 py-1 text-ink-500">{L("В проекте нет .png, .jpg, .glb, .gltf", "No .png, .jpg, .glb, .gltf in the project")}</li>}
            {files.map((f) => (
              <li key={f.path}>
                <button
                  onClick={() => {
                    void openFile(f.path);
                    setFiles(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1 text-left text-ink-200 hover:bg-white/5"
                >
                  {f.kind === "model" ? <Box size={13} className="shrink-0" /> : <ImageIcon size={13} className="shrink-0" />}
                  <span className="truncate">{f.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {open && (
          <div className="h-[40vh] min-h-[180px] bg-black/30">
            {showModel ? (
              <ModelViewer key={model.path + model.data.length} name={model.name} mime={model.mime} data={model.data} />
            ) : current ? (
              <img src={dataUri(current)} alt={current.name} className="h-full w-full object-contain" draggable={false} />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-[12.5px] leading-5 text-ink-500">
                {L(
                  "Здесь появятся снимки вьюпорта и рендеры, которые вернут Blender, Unity, Unreal или Godot, а также модели .glb из проекта.",
                  "Viewport screenshots and renders returned by Blender, Unity, Unreal or Godot appear here, plus .glb models from the project.",
                )}
              </div>
            )}
          </div>
        )}
        {open && items.length > 1 && (
          <div className="aide-scroll flex gap-1 overflow-x-auto px-2 py-1.5">
            {items.map((it, i) => (
              <button
                key={it.id}
                onClick={() => select(i)}
                aria-label={`${i + 1}`}
                className={"size-10 shrink-0 overflow-hidden rounded border " + (i === index && !showModel ? "border-ink-100" : "border-line/60 opacity-70 hover:opacity-100")}
              >
                <img src={dataUri(it)} alt="" className="h-full w-full object-cover" draggable={false} />
              </button>
            ))}
          </div>
        )}
        {error && <div className="px-3 py-1.5 text-[12px] text-red-400">{error}</div>}
      </div>
      <div className="min-h-0 flex-1">
        <ChatPanel studioTab />
      </div>
    </div>
  );
}
