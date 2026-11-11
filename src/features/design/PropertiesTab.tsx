import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  Bold,
  ChevronsDown,
  ChevronsUp,
  CopyPlus,
  Eye,
  EyeOff,
  Group,
  Italic,
  Lock,
  LockOpen,
  Trash2,
  Underline,
  Ungroup,
  ArrowUpToLine,
  X,
  type LucideIcon,
} from "lucide-react";
import { Select } from "@/ui/Select";
import { isLeafElement } from "@/features/design/dom";
import { liveEl, readTranslate } from "@/features/design/live";
import { useDesign } from "@/features/design/store";
import { useDesignText } from "@/features/design/strings";

/* ── Reading values from the live element ───────────────────── */

const FONTS = [
  { value: 'system-ui, -apple-system, "Segoe UI", sans-serif', label: "System" },
  { value: 'Georgia, "Times New Roman", serif', label: "Serif" },
  { value: 'ui-monospace, "Cascadia Code", Consolas, monospace', label: "Mono" },
  { value: '"Trebuchet MS", "Segoe UI", sans-serif', label: "Rounded" },
];

const SHADOWS: Record<string, string> = {
  none: "none",
  soft: "0 2px 8px rgba(0,0,0,0.12)",
  medium: "0 8px 24px rgba(0,0,0,0.18)",
  strong: "0 16px 48px rgba(0,0,0,0.28)",
};

function toHex(css: string): string | null {
  const m = css.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  const h = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
}

interface Info {
  tag: string;
  leaf: boolean;
  text: string;
  color: string | null;
  bg: string | null;
  gradient: { angle: number; from: string; to: string } | "custom" | null;
  font: string;
  fontSize: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  textAlign: string;
  lineHeight: number;
  letterSpacing: number;
  borderWidth: number;
  borderColor: string | null;
  radius: number;
  shadow: string;
  display: string;
  direction: string;
  justify: string;
  alignItems: string;
  gap: number;
  padding: number;
  width: number;
  height: number;
  x: number;
  y: number;
  opacity: number;
  hidden: boolean;
  locked: boolean;
}

function readInfo(id: string | null): Info | null {
  const el = liveEl(id);
  if (!el) return null;
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!cs) return null;
  const r = el.getBoundingClientRect();
  const t = readTranslate(el);
  const fs = parseFloat(cs.fontSize) || 16;
  const lh = cs.lineHeight === "normal" ? 1.2 : (parseFloat(cs.lineHeight) || fs * 1.2) / fs;
  const family = cs.fontFamily.toLowerCase();
  const font = family.includes("georgia") ? FONTS[1].value : /mono|consolas/.test(family) ? FONTS[2].value : family.includes("trebuchet") ? FONTS[3].value : FONTS[0].value;
  const inlineShadow = el.style.boxShadow;
  const shadowKey = !inlineShadow
    ? cs.boxShadow === "none"
      ? "none"
      : "custom"
    : (Object.entries(SHADOWS).find(([, v]) => v.replace(/\s/g, "") === inlineShadow.replace(/\s/g, ""))?.[0] ?? "custom");
  let gradient: Info["gradient"] = null;
  if (/gradient/i.test(cs.backgroundImage)) {
    const m = el.style.backgroundImage.match(/linear-gradient\(\s*(\d+)deg\s*,\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/i);
    gradient = m ? { angle: Number(m[1]), from: m[2], to: m[3] } : "custom";
  }
  const bw = parseFloat(cs.borderTopWidth) || 0;
  return {
    tag: el.tagName.toLowerCase(),
    leaf: isLeafElement(el),
    text: el.textContent ?? "",
    color: toHex(cs.color),
    bg: toHex(cs.backgroundColor),
    gradient,
    font,
    fontSize: Math.round(fs),
    weight: Math.round((parseFloat(cs.fontWeight) || 400) / 100) * 100,
    italic: cs.fontStyle === "italic",
    underline: cs.textDecorationLine.includes("underline"),
    textAlign: cs.textAlign === "start" ? "left" : cs.textAlign === "end" ? "right" : cs.textAlign,
    lineHeight: Math.round(lh * 100) / 100,
    letterSpacing: parseFloat(cs.letterSpacing) || 0,
    borderWidth: bw,
    borderColor: bw > 0 ? toHex(cs.borderTopColor) : null,
    radius: Math.round(parseFloat(cs.borderTopLeftRadius) || 0),
    shadow: shadowKey,
    display: cs.display,
    direction: cs.flexDirection,
    justify: cs.justifyContent,
    alignItems: cs.alignItems,
    gap: Math.round(parseFloat(cs.columnGap) || 0),
    padding: Math.round(parseFloat(cs.paddingTop) || 0),
    width: Math.round(r.width),
    height: Math.round(r.height),
    x: Math.round(t.x),
    y: Math.round(t.y),
    opacity: Math.round((parseFloat(cs.opacity) || 1) * 100),
    hidden: el.style.display === "none",
    locked: el.hasAttribute("data-locked"),
  };
}

/* ── Tab ───────────────────────────────────────────────────── */

export function PropertiesTab() {
  const T = useDesignText();
  const selectedId = useDesign((s) => s.selectedId);
  const multi = useDesign((s) => s.multi);
  const styleRev = useDesign((s) => s.styleRev);
  const docRev = useDesign((s) => s.docRev);
  const reloadKey = useDesign((s) => s.reloadKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const info = useMemo(() => readInfo(selectedId), [selectedId, styleRev, docRev, reloadKey]);

  if (!selectedId || !info) {
    return <p className="px-6 pt-8 text-center text-[13px] leading-5 text-ink-500">{T.pickElement}</p>;
  }
  const st = useDesign.getState();
  const set = (styles: Record<string, string>, key?: string) => st.updateSelectionStyles(styles, key);
  const count = multi.length + 1;
  const isFlex = info.display === "flex" || info.display === "inline-flex";

  return (
    <div className="aide-scroll h-full overflow-y-auto px-4 pb-8">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] text-ink-300">
          {count > 1 ? T.multiSelected.replace("{n}", String(count)) : <span className="font-mono text-[#6ea8ff]">&lt;{info.tag}&gt;</span>}
        </span>
        <button
          onClick={() => st.selectParent()}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-ink-300 transition-colors hover:bg-white/[0.06] hover:text-ink-50"
        >
          <ArrowUpToLine size={13} />
          {T.selectParent}
        </button>
      </div>

      <div className="mb-3 flex items-center gap-0.5 rounded-xl bg-white/[0.04] p-1">
        <IconBtn icon={CopyPlus} label={T.duplicate} onClick={() => st.duplicateSelected()} />
        <IconBtn icon={Group} label={T.group} onClick={() => st.group()} />
        <IconBtn icon={Ungroup} label={T.ungroup} onClick={() => st.ungroup()} />
        <IconBtn icon={ChevronsUp} label={T.bringFront} onClick={() => st.reorder("front")} />
        <IconBtn icon={ChevronsDown} label={T.sendBack} onClick={() => st.reorder("back")} />
        <IconBtn icon={info.hidden ? EyeOff : Eye} label={info.hidden ? T.show : T.hide} onClick={() => st.toggleHidden(selectedId)} />
        <IconBtn icon={info.locked ? Lock : LockOpen} label={info.locked ? T.unlock : T.lock} onClick={() => st.toggleLocked(selectedId)} />
        <IconBtn icon={Trash2} label={T.deleteSelected} danger onClick={() => st.deleteSelected()} />
      </div>

      {count > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-0.5 rounded-xl bg-white/[0.04] p-1">
          <IconBtn icon={AlignHorizontalJustifyStart} label={T.alignLeft} onClick={() => st.align("left")} />
          <IconBtn icon={AlignHorizontalJustifyCenter} label={T.alignCenter} onClick={() => st.align("center")} />
          <IconBtn icon={AlignHorizontalJustifyEnd} label={T.alignRight} onClick={() => st.align("right")} />
          <span className="mx-1 h-5 w-px bg-line-strong" />
          <IconBtn icon={AlignVerticalJustifyStart} label={T.alignTop} onClick={() => st.align("top")} />
          <IconBtn icon={AlignVerticalJustifyCenter} label={T.alignMiddle} onClick={() => st.align("middle")} />
          <IconBtn icon={AlignVerticalJustifyEnd} label={T.alignBottom} onClick={() => st.align("bottom")} />
          <span className="mx-1 h-5 w-px bg-line-strong" />
          <IconBtn icon={AlignHorizontalSpaceBetween} label={T.distributeX} disabled={count < 3} onClick={() => st.distribute("x")} />
          <IconBtn icon={AlignVerticalSpaceBetween} label={T.distributeY} disabled={count < 3} onClick={() => st.distribute("y")} />
        </div>
      )}

      {info.leaf && (
        <Section title={T.textLabel}>
          <textarea
            value={info.text}
            rows={2}
            onChange={(e) => st.updateText(selectedId, e.target.value)}
            className="w-full resize-none rounded-lg border border-line-strong bg-canvas px-2.5 py-1.5 text-[13px] leading-5 text-ink-100 outline-none focus:border-white/30"
          />
        </Section>
      )}

      <Section title={T.typography}>
        <Field label={T.font}>
          <Select variant="field" value={info.font} onChange={(v) => set({ "font-family": v })} options={FONTS} menuMinWidth={160} />
        </Field>
        <Grid>
          <Field label={T.fontSize}>
            <NumberField value={info.fontSize} min={6} max={200} onChange={(v) => set({ "font-size": `${v}px` })} />
          </Field>
          <Field label={T.weight}>
            <Select
              variant="field"
              value={String(info.weight)}
              onChange={(v) => set({ "font-weight": v })}
              options={["300", "400", "500", "600", "700", "800"].map((w) => ({ value: w, label: w }))}
              menuMinWidth={100}
            />
          </Field>
          <Field label={T.lineHeight}>
            <NumberField value={info.lineHeight} step={0.05} min={0.8} max={4} onChange={(v) => set({ "line-height": String(v) })} />
          </Field>
          <Field label={T.letterSpacing}>
            <NumberField value={info.letterSpacing} step={0.1} min={-5} max={40} onChange={(v) => set({ "letter-spacing": `${v}px` })} />
          </Field>
        </Grid>
        <div className="mb-3 flex items-center gap-2">
          <Seg
            value={info.textAlign}
            onChange={(v) => set({ "text-align": v })}
            items={[
              { value: "left", icon: AlignLeft, label: T.textAlign },
              { value: "center", icon: AlignCenter, label: T.alignCenter },
              { value: "right", icon: AlignRight, label: T.alignRight },
            ]}
          />
          <Toggle icon={Bold} label={T.bold} on={info.weight >= 600} onClick={() => set({ "font-weight": info.weight >= 600 ? "400" : "700" })} />
          <Toggle icon={Italic} label={T.italic} on={info.italic} onClick={() => set({ "font-style": info.italic ? "normal" : "italic" })} />
          <Toggle icon={Underline} label={T.underline} on={info.underline} onClick={() => set({ "text-decoration": info.underline ? "none" : "underline" })} />
        </div>
        <Field label={T.textColor}>
          <ColorField value={info.color} onChange={(v) => set({ color: v })} />
        </Field>
      </Section>

      <Section title={T.fill}>
        <TextSeg
          value={info.gradient ? "gradient" : "solid"}
          onChange={(v) => {
            if (v === "gradient") set({ "background-image": `linear-gradient(135deg, ${info.bg ?? "#6366f1"}, #8b5cf6)` });
            else set({ "background-image": "" });
          }}
          items={[
            { value: "solid", label: T.solid },
            { value: "gradient", label: T.gradient },
          ]}
        />
        {info.gradient && info.gradient !== "custom" ? (
          <>
            <Grid>
              <Field label={T.gradientFrom}>
                <ColorField value={info.gradient.from} onChange={(v) => set({ "background-image": `linear-gradient(${info.gradient && info.gradient !== "custom" ? info.gradient.angle : 135}deg, ${v}, ${info.gradient && info.gradient !== "custom" ? info.gradient.to : "#8b5cf6"})` })} />
              </Field>
              <Field label={T.gradientTo}>
                <ColorField value={info.gradient.to} onChange={(v) => set({ "background-image": `linear-gradient(${info.gradient && info.gradient !== "custom" ? info.gradient.angle : 135}deg, ${info.gradient && info.gradient !== "custom" ? info.gradient.from : "#6366f1"}, ${v})` })} />
              </Field>
            </Grid>
            <Field label={T.gradientAngle}>
              <NumberField
                value={info.gradient.angle}
                min={0}
                max={360}
                suffix="°"
                onChange={(v) => info.gradient && info.gradient !== "custom" && set({ "background-image": `linear-gradient(${v}deg, ${info.gradient.from}, ${info.gradient.to})` })}
              />
            </Field>
          </>
        ) : (
          !info.gradient && (
            <Field label={T.background}>
              <ColorField
                value={info.bg}
                onChange={(v) => set({ "background-color": v })}
                onClear={() => set({ "background-color": "transparent" })}
                clearLabel={T.clear}
              />
            </Field>
          )
        )}
      </Section>

      <Section title={T.border}>
        <Grid>
          <Field label={T.borderWidth}>
            <NumberField
              value={info.borderWidth}
              min={0}
              max={40}
              onChange={(v) => set({ "border-width": `${v}px`, "border-style": v > 0 ? "solid" : "none", ...(info.borderColor ? {} : { "border-color": "#d1d5db" }) })}
            />
          </Field>
          <Field label={T.borderColor}>
            <ColorField value={info.borderColor} onChange={(v) => set({ "border-color": v, "border-style": "solid", "border-width": info.borderWidth > 0 ? `${info.borderWidth}px` : "1px" })} />
          </Field>
          <Field label={T.radius}>
            <NumberField value={info.radius} min={0} max={999} onChange={(v) => set({ "border-radius": `${v}px` })} />
          </Field>
          <Field label={T.shadow}>
            <Select
              variant="field"
              value={info.shadow}
              onChange={(v) => v !== "custom" && set({ "box-shadow": SHADOWS[v] })}
              options={[
                { value: "none", label: T.shadowNone },
                { value: "soft", label: T.shadowSoft },
                { value: "medium", label: T.shadowMedium },
                { value: "strong", label: T.shadowStrong },
                ...(info.shadow === "custom" ? [{ value: "custom", label: T.shadowCustom }] : []),
              ]}
              menuMinWidth={140}
            />
          </Field>
        </Grid>
      </Section>

      <Section title={T.layout}>
        <TextSeg
          value={isFlex ? "flex" : "block"}
          onChange={(v) => set({ display: v })}
          items={[
            { value: "block", label: "Block" },
            { value: "flex", label: "Flex" },
          ]}
        />
        {isFlex && (
          <>
            <Grid>
              <Field label={T.direction}>
                <Select
                  variant="field"
                  value={info.direction.startsWith("column") ? "column" : "row"}
                  onChange={(v) => set({ "flex-direction": v })}
                  options={[
                    { value: "row", label: T.row },
                    { value: "column", label: T.column },
                  ]}
                  menuMinWidth={120}
                />
              </Field>
              <Field label={T.gap}>
                <NumberField value={info.gap} min={0} max={400} onChange={(v) => set({ gap: `${v}px` })} />
              </Field>
              <Field label={T.justify}>
                <Select
                  variant="field"
                  value={info.justify === "normal" ? "flex-start" : info.justify}
                  onChange={(v) => set({ "justify-content": v })}
                  options={["flex-start", "center", "flex-end", "space-between", "space-around"].map((v) => ({ value: v, label: v.replace("flex-", "") }))}
                  menuMinWidth={150}
                />
              </Field>
              <Field label={T.alignItems}>
                <Select
                  variant="field"
                  value={info.alignItems === "normal" ? "stretch" : info.alignItems}
                  onChange={(v) => set({ "align-items": v })}
                  options={["flex-start", "center", "flex-end", "stretch"].map((v) => ({ value: v, label: v.replace("flex-", "") }))}
                  menuMinWidth={150}
                />
              </Field>
            </Grid>
          </>
        )}
        <Field label={T.padding}>
          <NumberField value={info.padding} min={0} max={400} onChange={(v) => set({ padding: `${v}px` })} />
        </Field>
      </Section>

      <Section title={T.size}>
        <Grid>
          <Field label={T.width}>
            <NumberField value={info.width} min={8} max={4000} onChange={(v) => set({ width: `${v}px` })} />
          </Field>
          <Field label={T.height}>
            <NumberField value={info.height} min={8} max={4000} onChange={(v) => set({ height: `${v}px` })} />
          </Field>
          <Field label={T.offsetX}>
            <NumberField value={info.x} min={-4000} max={4000} onChange={(v) => set({ translate: `${v}px ${info.y}px` })} />
          </Field>
          <Field label={T.offsetY}>
            <NumberField value={info.y} min={-4000} max={4000} onChange={(v) => set({ translate: `${info.x}px ${v}px` })} />
          </Field>
        </Grid>
      </Section>

      <Section title={T.appearance}>
        <Field label={T.opacity}>
          <NumberField value={info.opacity} min={0} max={100} suffix="%" onChange={(v) => set({ opacity: String(v / 100) })} />
        </Field>
      </Section>

      <p className="mt-2 text-[12px] leading-5 text-ink-500">{T.editHint}</p>
    </div>
  );
}

/* ── Controls ──────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4 border-t border-line pt-3">
      <h3 className="mb-2.5 text-[12px] font-medium uppercase tracking-wide text-ink-500">{title}</h3>
      {children}
    </section>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-3">{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[12px] text-ink-400">{label}</div>
      {children}
    </div>
  );
}

function IconBtn({
  icon: Icon,
  label,
  danger,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={
        "flex size-7 items-center justify-center rounded-lg transition-colors disabled:opacity-30 " +
        (danger ? "text-ink-300 enabled:hover:bg-red-500/15 enabled:hover:text-red-300" : "text-ink-300 enabled:hover:bg-white/[0.09] enabled:hover:text-ink-50")
      }
    >
      <Icon size={15} />
    </button>
  );
}

function Toggle({ icon: Icon, label, on, onClick }: { icon: LucideIcon; label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={
        "flex size-8 items-center justify-center rounded-lg border transition-colors " +
        (on ? "border-white/25 bg-white/[0.12] text-ink-50" : "border-line-strong text-ink-400 hover:bg-white/[0.05] hover:text-ink-100")
      }
    >
      <Icon size={15} />
    </button>
  );
}

function Seg({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (v: string) => void;
  items: { value: string; icon: LucideIcon; label: string }[];
}) {
  return (
    <div className="flex items-center rounded-lg border border-line-strong p-0.5">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          title={it.label}
          aria-label={it.label}
          aria-pressed={value === it.value}
          onClick={() => onChange(it.value)}
          className={"flex size-7 items-center justify-center rounded-md transition-colors " + (value === it.value ? "bg-white/[0.12] text-ink-50" : "text-ink-400 hover:text-ink-100")}
        >
          <it.icon size={15} />
        </button>
      ))}
    </div>
  );
}

function TextSeg({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: { value: string; label: string }[] }) {
  return (
    <div className="mb-3 flex rounded-lg border border-line-strong p-0.5">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          aria-pressed={value === it.value}
          onClick={() => onChange(it.value)}
          className={"h-7 flex-1 rounded-md text-[12.5px] transition-colors " + (value === it.value ? "bg-white/[0.12] text-ink-50" : "text-ink-400 hover:text-ink-100")}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function NumberField({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setLocal(String(value));
  }, [value, focused]);
  return (
    <div className="relative">
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        step={step}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setLocal(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="h-9 w-full rounded-lg border border-line-strong bg-canvas px-2.5 text-[13px] tabular-nums text-ink-100 outline-none focus:border-white/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-500">{suffix}</span>}
    </div>
  );
}

function ColorField({
  value,
  onChange,
  onClear,
  clearLabel,
}: {
  value: string | null;
  onChange: (hex: string) => void;
  onClear?: () => void;
  clearLabel?: string;
}) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-canvas pl-1.5 pr-2">
      <label
        className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-md border border-line-strong"
        style={{ background: value ?? "repeating-conic-gradient(#3d3c39 0% 25%, #1b1a18 0% 50%) 50% / 8px 8px" }}
      >
        <input type="color" value={value ?? "#ffffff"} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </label>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-300">{value ?? "—"}</span>
      {onClear && value && (
        <button onClick={onClear} title={clearLabel} aria-label={clearLabel} className="rounded p-0.5 text-ink-500 hover:text-ink-50">
          <X size={12} />
        </button>
      )}
    </div>
  );
}
