import type { ReactNode } from "react";
import type { RoleId } from "./roles";
import type { Mood } from "./store";

// Hand-drawn vector portraits of the crew, one per role (viewBox 100x100, head and shoulders).
// Flat shapes with a little shading so they stay readable from 26 px up to the call screen.

type Mouth = "smile" | "half" | "grin" | "flat" | "kind" | "big";
type Eyes = "normal" | "wide" | "wink" | "calm";
type Glasses = "round" | "rect" | "reading";

interface Look {
  skin: string;
  shade: string;
  /** Behind the head: back hair, hood. */
  back?: ReactNode;
  /** Shoulders and clothes. */
  body: ReactNode;
  /** In front of the face: hair, hat. */
  front?: ReactNode;
  /** Drawn last: jewellery, patches. */
  extra?: ReactNode;
  eyes?: Eyes;
  mouth: Mouth;
  brows: string;
  /** Raise one eyebrow (skeptical look). */
  raised?: boolean;
  glasses?: { kind: Glasses; color: string };
  beard?: string;
  freckles?: boolean;
}

const INK = "#1d1a18";

const SHOULDERS = "M10 100 C10 83 26 75 50 75 C74 75 90 83 90 100 Z";

function Shoulders({ fill, shade }: { fill: string; shade?: string }) {
  return (
    <>
      <path d={SHOULDERS} fill={fill} />
      {shade && <path d="M10 100 C10 90 16 84 26 80 C22 88 22 94 24 100 Z" fill={shade} opacity={0.5} />}
    </>
  );
}

// Hair pieces reused by several roles.
const CAP_SHORT = "M31 45 C29 27 40 21 51 21 C62 21 71 27 69 45 C66 36 60 31 50 31 C42 31 35 36 31 45 Z";
const CAP_CROP = "M31 42 C30 28 40 22 50 22 C60 22 70 28 69 42 C66 35 59 31 50 31 C41 31 34 35 31 42 Z";

const LOOKS: Record<RoleId, Look> = {
  // Calm man in his forties, graying hair, rolled sleeves, compass pin.
  lead: {
    skin: "#8a5a3c",
    shade: "#6f4630",
    brows: "#cfcfd6",
    mouth: "half",
    body: (
      <>
        <Shoulders fill="#2b3150" shade="#1f2440" />
        <path d="M43 75 L50 88 L57 75 Z" fill="#e7e7ee" />
        <path d="M43 75 L50 88 L47 76 Z M57 75 L50 88 L53 76 Z" fill="#cfd0dc" />
      </>
    ),
    front: <path d={CAP_SHORT} fill="#b5b6bf" />,
    extra: (
      <>
        <circle cx="66" cy="86" r="3.6" fill="#d9b44a" />
        <path d="M66 83.6 L67.2 86 L66 88.4 L64.8 86 Z" fill="#7a5a14" />
      </>
    ),
  },

  // Creative woman in her late twenties: black bob, pink streak, round glasses, pencil.
  design: {
    skin: "#f2cfb1",
    shade: "#dcae8c",
    brows: "#1c1a1f",
    mouth: "smile",
    glasses: { kind: "round", color: "#b98a4e" },
    back: <path d="M28 52 C25 26 38 19 50 19 C62 19 75 26 72 52 L72 68 L65 68 L65 46 L35 46 L35 68 L28 68 Z" fill="#1c1a1f" />,
    body: (
      <>
        <Shoulders fill="#6b4f8f" shade="#52397a" />
        <path d="M42 75 Q50 82 58 75" stroke="#51397a" strokeWidth="2" fill="none" />
      </>
    ),
    front: (
      <>
        <path d="M31 43 C34 29 44 25 54 27 C64 29 69 35 69 43 C62 35 50 33 40 38 C36 40 33 42 31 43 Z" fill="#1c1a1f" />
        <path d="M33 41 C36 33 42 30 47 29.5 C42 32 38 36 35 42 Z" fill="#ec7fb0" />
      </>
    ),
    extra: (
      <g transform="rotate(22 71 40)">
        <rect x="69.4" y="24" width="3.2" height="22" rx="1" fill="#f2c94c" />
        <path d="M69.4 46 L71 50.5 L72.6 46 Z" fill="#e8c9a0" />
        <rect x="69.4" y="24" width="3.2" height="3.4" rx="1" fill="#e07a8e" />
      </g>
    ),
  },

  // Energetic guy in his mid twenties: curls, hoodie, headphones on the neck.
  front: {
    skin: "#c68e5b",
    shade: "#a8723f",
    brows: "#2b1b12",
    mouth: "grin",
    back: (
      <g fill="#2b1b12">
        <circle cx="34" cy="33" r="8" />
        <circle cx="43" cy="25" r="8.5" />
        <circle cx="53" cy="23" r="8.5" />
        <circle cx="63" cy="27" r="8.5" />
        <circle cx="69" cy="37" r="7.5" />
        <circle cx="30" cy="43" r="6.5" />
        <circle cx="71" cy="46" r="5.5" />
      </g>
    ),
    body: (
      <>
        <Shoulders fill="#3f7565" shade="#2f5c4f" />
        <path d="M33 77 C36 70 64 70 67 77 C62 80 38 80 33 77 Z" fill="#2f5c4f" />
        <path d="M45 78 L44 92 M55 78 L56 92" stroke="#e9efe9" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M32 70 C34 86 66 86 68 70" stroke="#23232b" strokeWidth="3" fill="none" strokeLinecap="round" />
        <rect x="28" y="64" width="9" height="13" rx="4" fill="#23232b" />
        <rect x="63" y="64" width="9" height="13" rx="4" fill="#23232b" />
        <rect x="30" y="67" width="3" height="7" rx="1.5" fill="#5eead4" opacity={0.8} />
        <rect x="67" y="67" width="3" height="7" rx="1.5" fill="#5eead4" opacity={0.8} />
      </>
    ),
    front: <path d="M32 41 C34 30 42 27 50 27 C58 27 66 30 68 41 C64 34 58 32 50 32 C42 32 36 34 32 41 Z" fill="#2b1b12" />,
  },

  // Focused backend dev in his thirties: neat beard, dark sweater, screen glow.
  back: {
    skin: "#a56b45",
    shade: "#8a5636",
    brows: "#1a1210",
    mouth: "flat",
    beard: "#1a1210",
    body: (
      <>
        <Shoulders fill="#3a2e4a" shade="#2a2038" />
        <path d="M42 75 Q50 83 58 75" stroke="#2a2038" strokeWidth="2.4" fill="none" />
      </>
    ),
    front: <path d={CAP_CROP} fill="#1a1210" />,
    extra: <ellipse cx="50" cy="48" rx="19" ry="22" fill="#5aa2ff" opacity={0.07} />,
  },

  // Meticulous tester: tight bun, thin glasses, one raised eyebrow, magnifier pendant.
  qa: {
    skin: "#f6d6c0",
    shade: "#e0b49a",
    brows: "#7a3f22",
    mouth: "half",
    raised: true,
    freckles: true,
    glasses: { kind: "rect", color: "#4a4a55" },
    back: <circle cx="50" cy="17" r="9" fill="#8a4b2b" />,
    body: (
      <>
        <Shoulders fill="#c9b27a" shade="#a99358" />
        <path d="M42 75 L50 83 L58 75" stroke="#a99358" strokeWidth="2" fill="none" />
      </>
    ),
    front: <path d={CAP_SHORT} fill="#8a4b2b" />,
    extra: (
      <>
        <path d="M43 76 L50 90 L57 76" stroke="#d8c98a" strokeWidth="1.2" fill="none" />
        <circle cx="50" cy="92" r="4.2" stroke="#e8d99a" strokeWidth="1.8" fill="#e8d99a" fillOpacity={0.15} />
        <path d="M53 95 L56 98.5" stroke="#e8d99a" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },

  // Relaxed DevOps: knitted beanie, utility jacket with a rocket patch.
  devops: {
    skin: "#d9a273",
    shade: "#bc8556",
    brows: "#3a2a1c",
    mouth: "grin",
    body: (
      <>
        <Shoulders fill="#4b5a44" shade="#394634" />
        <path d="M50 75 L50 100" stroke="#394634" strokeWidth="1.6" />
        <path d="M36 80 L36 100 M64 80 L64 100" stroke="#394634" strokeWidth="1" opacity={0.6} />
      </>
    ),
    front: (
      <>
        <path d="M30 42 C29 22 40 14 50 14 C60 14 71 22 70 42 Z" fill="#4a6fa5" />
        <path d="M30 37 H70 V45 H30 Z" fill="#6c8fc4" />
        <path d="M33 37 V45 M38 37 V45 M43 37 V45 M48 37 V45 M53 37 V45 M58 37 V45 M63 37 V45 M68 37 V45" stroke="#4a6fa5" strokeWidth="1" opacity={0.7} />
        <circle cx="50" cy="13" r="4.5" fill="#6c8fc4" />
      </>
    ),
    extra: (
      <>
        <path d="M65 81 C68.4 84.5 68.4 91 65 95 C61.6 91 61.6 84.5 65 81 Z" fill="#ececf2" />
        <circle cx="65" cy="87" r="1.5" fill="#4a6fa5" />
        <path d="M63 94 L61.5 97 M67 94 L68.5 97" stroke="#e8745f" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },

  // Thoughtful analyst around forty: side-parted hair, thin glasses, crisp shirt, chart pin.
  analyst: {
    skin: "#c99572",
    shade: "#ab7a58",
    brows: "#2a1d17",
    mouth: "half",
    glasses: { kind: "rect", color: "#9aa1ad" },
    back: <path d="M29 50 C27 26 39 20 50 20 C61 20 73 26 71 50 L71 63 L64 63 L64 44 L36 44 L36 63 L29 63 Z" fill="#2a1d17" />,
    body: (
      <>
        <Shoulders fill="#e8e9ee" shade="#cfd1da" />
        <path d="M42 75 L50 86 L58 75 Z" fill="#c99572" />
        <path d="M42 75 L50 86 L45 77 Z M58 75 L50 86 L55 77 Z" fill="#fff" />
      </>
    ),
    front: <path d="M31 43 C33 30 43 25 54 27 C63 29 69 35 69 43 C60 34 46 33 36 40 C34 41 32 42 31 43 Z" fill="#2a1d17" />,
    extra: (
      <>
        <rect x="31" y="88" width="2.6" height="5" fill="#5eead4" />
        <rect x="34.8" y="85" width="2.6" height="8" fill="#e9a96b" />
        <rect x="38.6" y="87" width="2.6" height="6" fill="#7aa2f7" />
      </>
    ),
  },

  // Composed lawyer: cropped natural hair, charcoal blazer, silk scarf, scales brooch.
  lawyer: {
    skin: "#5b3a28",
    shade: "#472c1d",
    brows: "#120c09",
    mouth: "kind",
    body: (
      <>
        <Shoulders fill="#3b3b41" shade="#2b2b30" />
        <path d="M42 75 L50 92 L58 75 Z" fill="#b86b7a" />
        <path d="M42 75 L50 92 L40 82 Z M58 75 L50 92 L60 82 Z" fill="#2b2b30" />
        <path d="M46 78 Q50 86 54 78" stroke="#9a4f5f" strokeWidth="1.4" fill="none" />
      </>
    ),
    front: <path d={CAP_CROP} fill="#120c09" />,
    extra: (
      <>
        <circle cx="33" cy="88" r="3" fill="#d9b44a" />
        <path d="M31 88 H35 M33 85.5 V90.5" stroke="#7a5a14" strokeWidth="0.9" />
      </>
    ),
  },

  // Kind accountant in his fifties: gray hair, cardigan, reading glasses on a chain.
  accountant: {
    skin: "#f1d4c1",
    shade: "#d9b39c",
    brows: "#a3a6ae",
    mouth: "kind",
    glasses: { kind: "reading", color: "#7a5a3a" },
    body: (
      <>
        <Shoulders fill="#587a52" shade="#456440" />
        <path d="M43 75 L50 100 L57 75 Z" fill="#efe9dc" />
        <path d="M45 82 H47 M45 88 H47 M45 94 H47" stroke="#456440" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    front: <path d={CAP_SHORT} fill="#b9bcc4" />,
    extra: <path d="M35.5 50 C27 61 29 76 40 81" stroke="#d9b44a" strokeWidth="1.1" fill="none" strokeLinecap="round" />,
  },

  // Bright marketer around thirty: long wavy hair, mustard jacket, bold earrings.
  marketer: {
    skin: "#d9a07a",
    shade: "#bc835c",
    brows: "#4a2b1a",
    mouth: "big",
    back: <path d="M26 48 C22 24 36 17 50 17 C64 17 78 24 74 48 C77 62 73 76 66 86 L34 86 C27 76 23 62 26 48 Z" fill="#5a3524" />,
    body: (
      <>
        <Shoulders fill="#dba52b" shade="#b98a1c" />
        <path d="M42 75 L50 90 L58 75 Z" fill="#f7efe3" />
        <path d="M42 75 L50 90 L38 82 Z M58 75 L50 90 L62 82 Z" fill="#b98a1c" />
      </>
    ),
    front: <path d="M31 44 C32 30 42 24 52 24 C64 25 70 33 69 44 C64 36 56 31 46 33 C40 35 34 40 31 44 Z" fill="#5a3524" />,
    extra: (
      <>
        <circle cx="30.5" cy="57" r="3" fill="#f2c94c" />
        <circle cx="69.5" cy="57" r="3" fill="#f2c94c" />
      </>
    ),
  },

  // Eager intern around twenty: messy fringe, plain tee, badge on a lanyard, wide eyes.
  intern: {
    skin: "#f1cdb0",
    shade: "#d8ad8c",
    brows: "#5a3a22",
    mouth: "smile",
    eyes: "wide",
    body: (
      <>
        <Shoulders fill="#7ea36c" shade="#678a56" />
        <path d="M42 75 Q50 81 58 75" stroke="#678a56" strokeWidth="2" fill="none" />
        <path d="M41 76 L47 93 M59 76 L53 93" stroke="#3b6fd0" strokeWidth="2" strokeLinecap="round" />
        <rect x="43.5" y="91" width="13" height="9" rx="1.8" fill="#f4f4f8" />
        <rect x="46" y="94" width="8" height="1.5" rx="0.7" fill="#c9cad6" />
      </>
    ),
    front: <path d="M31 44 C28 28 40 20 52 21 C64 22 72 30 69 44 L66 36 L61 41 L57 33 L51 40 L45 33 L40 41 L35 35 Z" fill="#5a3a22" />,
  },

  // Team joker: wild red curls, wink, wide grin, patterned shirt, party hat.
  joker: {
    skin: "#efc3a5",
    shade: "#d6a283",
    brows: "#a8421f",
    mouth: "grin",
    eyes: "wink",
    freckles: true,
    back: (
      <g fill="#c4532a">
        <circle cx="33" cy="34" r="8.5" />
        <circle cx="42" cy="26" r="9" />
        <circle cx="53" cy="24" r="9" />
        <circle cx="64" cy="28" r="9" />
        <circle cx="70" cy="39" r="8" />
        <circle cx="29" cy="46" r="7" />
        <circle cx="72" cy="50" r="6.5" />
      </g>
    ),
    body: (
      <>
        <Shoulders fill="#5a7bd6" shade="#4563b8" />
        <g fill="#f2c94c">
          <circle cx="26" cy="90" r="2.4" />
          <circle cx="38" cy="96" r="2.4" />
          <circle cx="62" cy="96" r="2.4" />
          <circle cx="74" cy="90" r="2.4" />
        </g>
        <g fill="#ef6f8e">
          <circle cx="32" cy="83" r="2" />
          <circle cx="68" cy="83" r="2" />
          <circle cx="50" cy="96" r="2" />
        </g>
        <path d="M42 75 L50 84 L58 75 Z" fill="#f7efe3" />
      </>
    ),
    front: (
      <>
        <path d="M32 42 C34 31 42 28 50 28 C58 28 66 31 68 42 C64 36 58 34 50 34 C42 34 36 36 32 42 Z" fill="#c4532a" />
        <g transform="rotate(-14 52 24)">
          <path d="M43 25 L61 25 L52 2 Z" fill="#ef6f8e" />
          <path d="M45.5 19 L58.5 19 M48 12.5 L56 12.5" stroke="#f7efe3" strokeWidth="2" />
          <circle cx="52" cy="3" r="3.2" fill="#f2c94c" />
        </g>
      </>
    ),
  },
};

function MouthArt({ kind, beard, talking }: { kind: Mouth; beard?: boolean; talking?: boolean }) {
  const lip = beard ? "#c98a73" : "#8c3d33";
  if (talking && kind !== "grin" && kind !== "big") {
    // Closed-lip mouths open and close like syllables while the person speaks.
    return (
      <g className="face-talk">
        <path d="M43 57 Q50 56 57 57 Q56.5 66.5 50 66.5 Q43.5 66.5 43 57 Z" fill="#7a2a2a" />
        <ellipse cx="50" cy="64.4" rx="3.6" ry="1.7" fill="#d9606a" />
      </g>
    );
  }
  let art: ReactNode;
  switch (kind) {
    case "grin":
      art = (
        <>
          <path d="M41.5 56.5 Q50 69 58.5 56.5 Z" fill="#7a2a2a" />
          <path d="M43 57 Q50 59.6 57 57 L56 59.6 Q50 62 44 59.6 Z" fill="#fff" />
        </>
      );
      break;
    case "big":
      art = (
        <>
          <path d="M40.5 56 Q50 71 59.5 56 Z" fill="#8a2f3a" />
          <path d="M42.5 56.6 Q50 59.4 57.5 56.6 L56.4 59.6 Q50 62 43.6 59.6 Z" fill="#fff" />
        </>
      );
      break;
    case "smile":
      art = <path d="M43 58 Q50 64 57 58" stroke={lip} strokeWidth="2" fill="none" strokeLinecap="round" />;
      break;
    case "kind":
      art = <path d="M43.5 58.5 Q50 63 56.5 58.5" stroke={lip} strokeWidth="2.2" fill="none" strokeLinecap="round" />;
      break;
    case "half":
      art = <path d="M44 59 Q50 61.4 57.5 57.4" stroke={lip} strokeWidth="2" fill="none" strokeLinecap="round" />;
      break;
    default:
      art = <path d="M44.5 59.4 H55.5" stroke={lip} strokeWidth="2" strokeLinecap="round" />;
  }
  // Mouths that are already open just pulse a little while speaking.
  return talking ? <g className="face-talk-soft">{art}</g> : <>{art}</>;
}

function FaceFeatures({ look, talking }: { look: Look; talking: boolean }) {
  const wide = look.eyes === "wide";
  const rx = wide ? 2.7 : 2.2;
  const ry = wide ? 3.3 : 2.6;
  return (
    <>
      <g className="face-brows">
        <g stroke={look.brows} strokeWidth="2.2" strokeLinecap="round" fill="none">
          <path d={wide ? "M37.5 38.5 Q42 35.5 46.5 38.5" : "M37.5 40.5 Q42 38 46.5 40.2"} />
          <path d={look.raised ? "M53.5 36.5 Q58.5 33.5 63 37.5" : wide ? "M53.5 38.5 Q58 35.5 62.5 38.5" : "M53.5 40.2 Q58 38 62.5 40.5"} />
        </g>
      </g>
      <g className="face-eyes">
        <g className="face-look">
          {look.eyes === "wink" ? (
            <>
              <path d="M37.8 46.5 Q42 43 46.2 46.5" stroke={INK} strokeWidth="2.2" fill="none" strokeLinecap="round" />
              <ellipse cx="58" cy="46.5" rx={rx} ry={ry} fill={INK} />
              <circle cx="58.8" cy="45.4" r="0.9" fill="#fff" />
            </>
          ) : (
            <>
              <ellipse cx="42" cy="46.5" rx={rx} ry={ry} fill={INK} />
              <ellipse cx="58" cy="46.5" rx={rx} ry={ry} fill={INK} />
              <circle cx="42.8" cy="45.4" r="0.9" fill="#fff" />
              <circle cx="58.8" cy="45.4" r="0.9" fill="#fff" />
            </>
          )}
        </g>
      </g>
      <path d="M50.5 48.5 Q47.5 54 50.5 54.6" stroke={look.shade} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <MouthArt kind={look.mouth} beard={!!look.beard} talking={talking} />
    </>
  );
}

function GlassesArt({ kind, color }: { kind: Glasses; color: string }) {
  if (kind === "round") {
    return (
      <g stroke={color} strokeWidth="1.8" fill="#ffffff" fillOpacity={0.08}>
        <circle cx="42" cy="46.5" r="6.4" />
        <circle cx="58" cy="46.5" r="6.4" />
        <path d="M48.4 46 Q50 44.6 51.6 46 M35.6 45 L31 43.5 M64.4 45 L69 43.5" fill="none" />
      </g>
    );
  }
  if (kind === "reading") {
    return (
      <g stroke={color} strokeWidth="1.6" fill="#ffffff" fillOpacity={0.1}>
        <rect x="35.5" y="48.5" width="12" height="7.5" rx="2.6" />
        <rect x="52.5" y="48.5" width="12" height="7.5" rx="2.6" />
        <path d="M47.5 50.6 Q50 49.4 52.5 50.6" fill="none" />
      </g>
    );
  }
  return (
    <g stroke={color} strokeWidth="1.5" fill="#ffffff" fillOpacity={0.08}>
      <rect x="35" y="42.4" width="14" height="9.6" rx="2.2" />
      <rect x="51" y="42.4" width="14" height="9.6" rx="2.2" />
      <path d="M49 46 H51 M35 44.5 L31 43.5 M65 44.5 L69 43.5" fill="none" />
    </g>
  );
}

/** The portrait itself, to be placed inside a square box. */
export function FaceArt({ role, uid, tint, mood = "idle", delay = 0, dots = false }: { role: RoleId; uid: string; tint: string; mood?: Mood; delay?: number; dots?: boolean }) {
  const look = LOOKS[role];
  return (
    <svg
      className="face-art"
      data-mood={mood}
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      aria-hidden
      focusable="false"
      style={{ display: "block", ["--face-d" as string]: `${delay}s` }}
    >
      <defs>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="42%" r="58%">
          <stop offset="0%" stopColor={tint} stopOpacity="0.62" />
          <stop offset="100%" stopColor={tint} stopOpacity="0.05" />
        </radialGradient>
        <linearGradient id={`${uid}-face`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={look.skin} />
          <stop offset="100%" stopColor={look.shade} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${uid}-glow)`} />
      <g className="face-fig">
      {look.back}
      {look.body}
      <rect x="43" y="62" width="14" height="17" rx="5" fill={look.shade} />
      <ellipse cx="31.2" cy="49" rx="3.4" ry="5.2" fill={look.skin} />
      <ellipse cx="68.8" cy="49" rx="3.4" ry="5.2" fill={look.skin} />
      <ellipse cx="50" cy="47" rx="19" ry="22" fill={`url(#${uid}-face)`} />
      <ellipse cx="50" cy="47" rx="19" ry="22" fill={look.skin} opacity={0.82} />
      {look.freckles && (
        <g fill={look.shade} opacity={0.75}>
          <circle cx="38" cy="53" r="0.95" />
          <circle cx="41.5" cy="55" r="0.95" />
          <circle cx="36.5" cy="56" r="0.95" />
          <circle cx="62" cy="53" r="0.95" />
          <circle cx="58.5" cy="55" r="0.95" />
          <circle cx="63.5" cy="56" r="0.95" />
        </g>
      )}
      {look.beard && <path d="M32.5 52 C32 68 40 72 50 72 C60 72 68 68 67.5 52 C64.5 60 58 63.5 50 63.5 C42 63.5 35.5 60 32.5 52 Z" fill={look.beard} />}
      <FaceFeatures look={look} talking={mood === "speaking"} />
      {look.glasses && <GlassesArt kind={look.glasses.kind} color={look.glasses.color} />}
      {look.front}
      {look.extra}
      </g>
      {dots && mood === "thinking" && (
        <g className="face-dots" fill="#fff">
          <circle cx="79" cy="26" r="2.2" />
          <circle cx="85" cy="18" r="3" />
          <circle cx="91" cy="8" r="4" />
        </g>
      )}
    </svg>
  );
}
