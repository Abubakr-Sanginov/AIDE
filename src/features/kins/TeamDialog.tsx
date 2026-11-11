import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, Sparkles, X } from "lucide-react";
import { useSkills } from "@/features/design/skills/store";
import { RoleSkills } from "./RoleSkills";
import { Select } from "@/ui/Select";
import { useAi } from "@/stores/ai";
import { lang } from "./engine";
import { Avatar } from "./Avatar";
import { PRESETS, REQUIRED, ROLES, type RoleId } from "./roles";
import { useKins } from "./store";
import { useKinsText } from "./strings";

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={
        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 " + (on ? "bg-teal-300" : "bg-white/[0.12]")
      }
    >
      <span className={"absolute top-0.5 size-5 rounded-full bg-canvas transition-all " + (on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

/** Roster editor: which roles take part and which model each one uses. */
export function TeamDialog() {
  const T = useKinsText();
  const presetId = useKins((s) => s.teamDialog);
  const team = useKins((s) => s.team);
  const models = useAi((s) => s.models);
  const [showAll, setShowAll] = useState(false);
  const [skillsFor, setSkillsFor] = useState<RoleId | null>(null);
  const allSkills = useSkills((s) => s.skills);

  const isOpen = !!presetId;
  useEffect(() => {
    if (!isOpen) return;
    setShowAll(false);
    setSkillsFor(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useKins.getState().openTeamDialog(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Only on open / close: switching to the custom team while editing must keep the list as it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!presetId) return null;
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const l = lang();
  const active: RoleId[] = presetId === "custom" ? team.customRoles : preset.roles;
  const rest = ROLES.filter((r) => !active.includes(r.id));
  const shown = showAll ? [...ROLES.filter((r) => active.includes(r.id)), ...rest] : ROLES.filter((r) => active.includes(r.id));
  const close = () => useKins.getState().openTeamDialog(null);

  const toggle = (id: RoleId, on: boolean) => {
    const k = useKins.getState();
    if (k.team.preset !== "custom") {
      // Editing a ready-made team turns it into a custom one with the same starting roles.
      useKins.setState({ team: { ...k.team, preset: "custom", customRoles: [...active] } });
    }
    // The dialog lists the roles of the team it was opened for: follow the team into "custom",
    // otherwise the list keeps showing the ready-made preset and nothing seems to change.
    if (presetId !== "custom") k.openTeamDialog("custom");
    useKins.getState().setRoleEnabled(id, on);
  };

  const options = [{ value: "", label: T.defaultModel }, ...models.map((m) => ({ value: m, label: m }))];

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/55 px-4 pt-[8vh]" onPointerDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={T.teamTitle(preset.name[l])}
        className="aide-fade-in flex max-h-[80vh] w-full max-w-[640px] flex-col rounded-xl border border-line-strong bg-overlay shadow-2xl shadow-black/70"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pb-2 pt-4">
          <div>
            <h2 className="text-[17px] font-semibold text-ink-50">{T.teamTitle(preset.name[l])}</h2>
            <p className="text-[13px] text-ink-400">{T.teamSub(active.length)}</p>
          </div>
          <button onClick={close} aria-label={T.done} className="aide-icon-button size-8">
            <X size={16} />
          </button>
        </div>

        <div className="aide-scroll min-h-0 flex-1 overflow-y-auto px-3">
          {shown.map((role) => {
            const on = active.includes(role.id);
            return (
              <div key={role.id} className="aide-fade-in border-b border-line/60 last:border-b-0">
              <div className="flex items-center gap-3 px-2 py-2.5">
                <div className={on ? "" : "opacity-50"}>
                  <Avatar role={role.id} size={34} />
                </div>
                <div className={"min-w-0 flex-1 " + (on ? "" : "opacity-50")}>
                  <div className="text-[14px] font-medium text-ink-50">{role.name[l]}</div>
                  <div className="truncate text-[12.5px] text-ink-400">{role.blurb[l]}</div>
                </div>
                {on && (
                  <Select
                    title={role.name[l]}
                    value={team.models[role.id] ?? ""}
                    options={options}
                    onChange={(v) => useKins.getState().setRoleModel(role.id, v)}
                    className="w-[170px] rounded-lg bg-white/[0.05] px-2.5 text-[13px] text-ink-200"
                    menuMinWidth={260}
                  />
                )}
                {on && (
                  <button
                    onClick={() => setSkillsFor(skillsFor === role.id ? null : role.id)}
                    aria-expanded={skillsFor === role.id}
                    title={isRuLike(l) ? rt("Навыки роли") : "Role skills"}
                    className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-white/[0.05] px-2 text-[12.5px] text-ink-300 hover:bg-white/[0.1] hover:text-ink-50"
                  >
                    <Sparkles size={13} />
                    {allSkills.filter((s) => s.roles?.includes(role.id)).length || ""}
                    <ChevronDown size={12} className={skillsFor === role.id ? "rotate-180" : ""} />
                  </button>
                )}
                <Toggle on={on} disabled={REQUIRED.includes(role.id)} label={role.name[l]} onChange={(v) => toggle(role.id, v)} />
              </div>
              {on && skillsFor === role.id && <RoleSkills role={role.id} />}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-5 py-3">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="flex items-center gap-1.5 text-[13px] text-ink-300 transition-colors hover:text-ink-50"
          >
            {showAll ? <X size={14} /> : <Plus size={14} />}
            {showAll ? T.hideRest : T.showAll}
          </button>
          <button
            onClick={close}
            className="h-9 rounded-lg bg-teal-300 px-5 text-[14px] font-medium text-canvas transition-colors hover:bg-teal-200"
          >
            {T.done}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
