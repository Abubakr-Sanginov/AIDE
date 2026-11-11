import { useId } from "react";
import { FaceArt } from "./Faces";
import { ROLE_BY_ID, type RoleId } from "./roles";
import type { Mood } from "./store";

/** Stable pseudo-random blink offset per role, so a row of faces does not blink in unison. */
function blinkDelay(role: RoleId): number {
  let h = 0;
  for (const c of role) h = (h * 31 + c.charCodeAt(0)) % 997;
  return -((h % 50) / 10);
}

/** Crew member portrait: a hand-drawn face on a rounded tile tinted with the role's color. */
export function Avatar({ role, size = 28, ring = false, mood = "idle" }: { role: RoleId; size?: number; ring?: boolean; mood?: Mood }) {
  const r = ROLE_BY_ID[role];
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <span
      role="img"
      aria-label={r.name.en}
      className={"inline-flex shrink-0 overflow-hidden " + (ring ? "ring-2 ring-canvas" : "")}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.5),
        background: `color-mix(in srgb, ${r.tint} 14%, #181716)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${r.tint} 32%, transparent)`,
      }}
    >
      <FaceArt role={role} uid={uid} tint={r.tint} mood={mood} delay={blinkDelay(role)} dots={size >= 44} />
    </span>
  );
}
