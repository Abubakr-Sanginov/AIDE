import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Info, X, XCircle } from "lucide-react";
import { useExtHost, type Dialog, type Toast } from "./store";

// UI requested by extensions: notifications, quick pick, input box and output channels.
// Everything is rendered as plain text (never as HTML).

function ToastView({ t }: { t: Toast }) {
  const dismiss = useExtHost((s) => s.dismissToast);
  const Icon = t.level === "error" ? XCircle : t.level === "warn" ? AlertTriangle : Info;
  const tone = t.level === "error" ? "text-red-400" : t.level === "warn" ? "text-amber-300" : "text-teal-300";
  return (
    <div role="status" className="aide-fade-in pointer-events-auto w-[360px] rounded-xl border border-line-strong bg-overlay p-3 shadow-2xl shadow-black/60">
      <div className="flex items-start gap-2.5">
        <Icon size={16} className={"mt-0.5 shrink-0 " + tone} />
        <div className="max-h-40 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words text-[13px] leading-5 text-ink-100">{t.message}</div>
        <button aria-label="Close" onClick={() => dismiss(t.id, null)} className="aide-icon-button size-6 shrink-0">
          <X size={13} />
        </button>
      </div>
      {t.items.length > 0 && (
        <div className="mt-2.5 flex flex-wrap justify-end gap-2">
          {t.items.map((label, i) => (
            <button key={i} onClick={() => dismiss(t.id, i)} className={"h-8 rounded-lg px-3 text-[13px] " + (i === 0 ? "bg-teal-300 font-medium text-canvas hover:bg-teal-200" : "bg-white/[0.08] text-ink-100 hover:bg-white/[0.14]")}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickPick({ d }: { d: Extract<Dialog, { kind: "quickpick" }> }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(d.items.flatMap((x, i) => (x.picked ? [i] : []))));
  const ref = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => d.items.map((it, i) => ({ it, i })).filter(({ it }) => (it.label + " " + (it.description ?? "")).toLowerCase().includes(q.toLowerCase())).slice(0, 200), [d.items, q]);
  useEffect(() => ref.current?.focus(), []);
  const close = (v: number | number[] | null) => {
    useExtHost.setState((s) => ({ dialogs: s.dialogs.filter((x) => x.id !== d.id) }));
    d.resolve(v);
  };
  const choose = (i: number) => (d.many ? setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; }) : close(i));
  return (
    <div className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-line-strong bg-overlay shadow-2xl shadow-black/70" onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        value={q}
        placeholder={d.placeHolder}
        onChange={(e) => { setQ(e.target.value); setSel(0); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") close(null);
          else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(shown.length - 1, s + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          else if (e.key === "Enter") { if (d.many) close([...picked]); else if (shown[sel]) choose(shown[sel].i); }
        }}
        className="h-11 w-full border-b border-line bg-transparent px-4 text-[14px] text-ink-100 outline-none placeholder:text-ink-500"
      />
      <ul className="aide-scroll max-h-[50vh] overflow-auto py-1">
        {shown.map(({ it, i }, k) => (
          <li key={i}>
            <button onClick={() => choose(i)} onMouseEnter={() => setSel(k)} className={"flex w-full items-start gap-2 px-4 py-1.5 text-left " + (k === sel ? "bg-white/[0.07]" : "")}>
              {d.many && <input type="checkbox" readOnly checked={picked.has(i)} className="mt-1" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-ink-100">{it.label}</span>
                {(it.description || it.detail) && <span className="block truncate text-[12px] text-ink-500">{[it.description, it.detail].filter(Boolean).join(" · ")}</span>}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-4 py-3 text-[13px] text-ink-500">—</li>}
      </ul>
      {d.many && (
        <div className="flex justify-end border-t border-line p-2">
          <button onClick={() => close([...picked])} className="h-8 rounded-lg bg-teal-300 px-4 text-[13px] font-medium text-canvas hover:bg-teal-200">OK</button>
        </div>
      )}
    </div>
  );
}

function InputBox({ d }: { d: Extract<Dialog, { kind: "input" }> }) {
  const [v, setV] = useState(d.value ?? "");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const close = (val: string | null) => {
    useExtHost.setState((s) => ({ dialogs: s.dialogs.filter((x) => x.id !== d.id) }));
    d.resolve(val);
  };
  return (
    <div className="w-[520px] max-w-[92vw] rounded-xl border border-line-strong bg-overlay p-3 shadow-2xl shadow-black/70" onPointerDown={(e) => e.stopPropagation()}>
      {d.prompt && <div className="mb-2 px-1 text-[13px] text-ink-300">{d.prompt}</div>}
      <input
        ref={ref}
        value={v}
        type={d.password ? "password" : "text"}
        placeholder={d.placeHolder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") close(v); else if (e.key === "Escape") close(null); }}
        className="h-10 w-full rounded-lg border border-line-strong bg-canvas px-3 text-[14px] text-ink-100 outline-none focus:border-teal-300/50"
      />
    </div>
  );
}

function OutputPanel() {
  const open = useExtHost((s) => s.outputOpen);
  const outputs = useExtHost((s) => s.outputs);
  const close = useExtHost((s) => s.closeOutput);
  const ref = useRef<HTMLPreElement>(null);
  const text = open ? outputs[open] ?? "" : "";
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text.length, open]);
  if (!open) return null;
  return (
    <div className="pointer-events-auto fixed bottom-9 left-3 z-[60] flex h-64 w-[640px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-line-strong bg-overlay shadow-2xl shadow-black/60">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        {Object.keys(outputs).map((name) => (
          <button key={name} aria-pressed={name === open} onClick={() => useExtHost.setState({ outputOpen: name })} className="h-7 rounded-md px-2.5 text-[12.5px] text-ink-400 hover:text-ink-50 aria-pressed:bg-white/[0.08] aria-pressed:text-ink-50">
            {name}
          </button>
        ))}
        <button aria-label="Close" onClick={close} className="aide-icon-button ml-auto size-7">
          <X size={14} />
        </button>
      </div>
      <pre ref={ref} className="aide-scroll min-h-0 flex-1 select-text overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[12px] leading-5 text-ink-200">{text}</pre>
    </div>
  );
}

export function ExtHostUi() {
  const toasts = useExtHost((s) => s.toasts);
  const dialog = useExtHost((s) => s.dialogs[0]);
  return createPortal(
    <>
      <div className="pointer-events-none fixed bottom-10 right-3 z-[70] flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastView key={t.id} t={t} />
        ))}
      </div>
      <OutputPanel />
      {dialog && (
        <div
          className="fixed inset-0 z-[85] flex items-start justify-center bg-black/40 pt-[12vh]"
          onPointerDown={() => {
            useExtHost.setState((s) => ({ dialogs: s.dialogs.filter((x) => x.id !== dialog.id) }));
            if (dialog.kind === "input") dialog.resolve(null);
            else dialog.resolve(null);
          }}
        >
          {dialog.kind === "quickpick" ? <QuickPick key={dialog.id} d={dialog} /> : <InputBox key={dialog.id} d={dialog} />}
        </div>
      )}
    </>,
    document.body,
  );
}
