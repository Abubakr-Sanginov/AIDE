import { ArrowUpRight, Monitor, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import { useDesign, type Device } from "@/features/design/store";
import { useDesignText } from "@/features/design/strings";

// Title-bar controls shown while the Design section is active.
export function DesignToolbar() {
  const T = useDesignText();
  const view = useDesign((s) => s.view);
  const setView = useDesign((s) => s.setView);
  const device = useDesign((s) => s.frames.find((f) => f.id === s.activeFrameId)?.device ?? "desktop");
  const setDevice = useDesign((s) => s.setDevice);

  const seg = (id: "canvas" | "code", label: string) => (
    <button
      onClick={() => setView(id)}
      aria-pressed={view === id}
      className={
        "h-8 rounded-lg px-3.5 text-[14px] font-medium transition-colors " +
        (view === id ? "bg-white/[0.08] text-ink-50" : "text-ink-400 hover:text-ink-100")
      }
    >
      {label}
    </button>
  );

  const dev = (id: Device, Icon: LucideIcon, label: string) => (
    <button
      key={id}
      title={label}
      aria-label={label}
      aria-pressed={device === id}
      onClick={() => setDevice(id)}
      className={
        "flex size-8 items-center justify-center rounded-lg transition-colors " +
        (device === id ? "bg-white/[0.09] text-ink-50" : "text-ink-400 hover:bg-white/[0.05] hover:text-ink-100")
      }
    >
      <Icon size={16} />
    </button>
  );

  return (
    <div className="flex items-center gap-3" onDoubleClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-0.5">
        {seg("canvas", T.canvas)}
        {seg("code", T.code)}
      </div>
      <div className="h-5 w-px bg-line-strong" />
      <div className="flex items-center gap-0.5">
        {dev("desktop", Monitor, T.desktop)}
        {dev("tablet", Tablet, T.tablet)}
        {dev("mobile", Smartphone, T.mobile)}
      </div>
    </div>
  );
}

export function CreateInProjectButton() {
  const T = useDesignText();
  const hasDesign = useDesign((s) => s.frames.some((f) => f.html.trim().length > 0));
  return (
    <button
      disabled={!hasDesign}
      onClick={() => useDesign.getState().setCreateDialog(true)}
      onDoubleClick={(e) => e.stopPropagation()}
      className="mr-2 flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[14px] font-medium text-canvas transition-[filter] hover:brightness-110 disabled:opacity-40"
    >
      <ArrowUpRight size={15} />
      {T.createInProject}
    </button>
  );
}
