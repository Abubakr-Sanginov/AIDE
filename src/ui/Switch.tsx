/** On/off switch (role="switch"), the same look as the other settings toggles. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={"relative h-6 w-11 shrink-0 rounded-full transition-colors " + (on ? "bg-ink-100" : "bg-white/[0.14]")}
    >
      <span className={"absolute top-0.5 size-5 rounded-full transition-all " + (on ? "left-[22px] bg-canvas" : "left-0.5 bg-ink-300")} />
    </button>
  );
}
