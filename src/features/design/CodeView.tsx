import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { prettyHtml } from "@/features/design/dom";
import { useDesign } from "@/features/design/store";
import { useDesignText } from "@/features/design/strings";

// Read-only HTML source of the active screen (switch screens with the chips).
export function CodeView() {
  const T = useDesignText();
  const frames = useDesign((s) => s.frames);
  const activeFrameId = useDesign((s) => s.activeFrameId);
  const html = useDesign((s) => s.html);
  const code = useMemo(() => prettyHtml(html), [html]);
  const [copied, setCopied] = useState(false);

  if (!frames.some((f) => f.html.trim())) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-ink-500">{T.noDesign}</div>;
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {frames.length > 1 && (
        <div className="aide-scroll flex shrink-0 items-center gap-1 overflow-x-auto px-3 pt-3">
          {frames.map((f) => (
            <button
              key={f.id}
              onClick={() => useDesign.getState().activateFrame(f.id)}
              className={
                "h-7 shrink-0 rounded-lg px-2.5 text-[12.5px] transition-colors " +
                (f.id === activeFrameId ? "bg-white/[0.09] text-ink-50" : "text-ink-400 hover:bg-white/[0.04] hover:text-ink-100")
              }
            >
              {f.name}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
        className="absolute right-4 top-3 z-10 flex items-center gap-1.5 rounded-lg bg-white/[0.07] px-2.5 py-1.5 text-[12.5px] text-ink-200 transition-colors hover:bg-white/[0.12]"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? T.copied : T.copy}
      </button>
      <pre className="aide-scroll min-h-0 flex-1 overflow-auto px-5 py-4 font-mono text-[12.5px] leading-5 text-ink-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}
