// Built-in skill: UI/UX Pro Max (https://github.com/nextlevelbuilder/ui-ux-pro-max-skill, MIT,
// © Next Level Builder). The rules below condense the skill's priority table and quick
// reference; `uiux-data.json` is a compact extract of its product / palette / typography /
// style data (see UI-UX-PRO-MAX.LICENSE).

export const UIUX_SOURCE = "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill";

export const UIUX_RULES = [
  "Follow these design rules, in priority order:",
  "1. Accessibility (critical): text contrast >= 4.5:1 (large text 3:1); visible focus styles; meaningful alt text and aria-labels for icon-only buttons; always visible form labels (never placeholder-only); sequential heading levels; never convey meaning by color alone (add an icon or text); respect prefers-reduced-motion.",
  "2. Touch & interaction (critical): interactive targets >= 44x44px with >= 8px between them; never rely on hover alone; show hover, pressed, focus, disabled and loading states; exactly one primary CTA per screen, secondary actions visually subordinate; error messages next to the field.",
  "3. Style selection: match the style to the product type and keep it consistent across screens; vector (inline SVG) icons only, never emoji as icons; one icon style (consistent stroke width and size tokens); one consistent elevation/shadow scale; design light and dark variants together (dark mode uses desaturated tonal variants, not inverted colors; verify contrast separately).",
  "4. Layout & responsive: mobile-first thinking; systematic breakpoints 390 / 768 / 1024 / 1440; no horizontal scroll; body text >= 16px on phones; line length 35-60 characters on phones and 60-75 on desktop; 4/8px spacing scale; one consistent max container width on desktop; core content first on phones; fixed bars must reserve space for content.",
  "5. Typography & color: base 16px, body line-height 1.5-1.75; a consistent type scale (12 14 16 18 24 32); weight hierarchy (600-700 headings, 400 body, 500 labels); semantic color tokens as CSS custom properties (--primary, --surface, --on-surface, --border, --error) instead of repeated raw hex; tabular numbers for prices and data; prefer wrapping over truncation.",
  "6. Motion: 150-300ms, animate only transform and opacity, 1-2 animated elements per view, ease-out on enter and ease-in on exit.",
  "7. Forms: visible labels, helper text, inline validation, errors near the field, progressive disclosure for long forms.",
  "8. Navigation: predictable and shallow; bottom navigation with at most 5 items on phones; always show where the user is.",
  "9. Charts & data: legends or direct labels, accessible colors, never color-only meaning.",
  "Before delivering, check: no emoji icons, contrast, touch target sizes, defined hover/focus/pressed states, light/dark parity, consistent spacing rhythm, one primary action per screen, and a layout designed for each viewport.",
].join("\n");

interface Profile {
  n: string;
  k: string[];
  style: string;
  style2: string;
  pattern: string;
  dash: string;
  mood: string;
  note: string;
  type: string;
  fx: string;
  avoid: string;
  pal: Record<string, string>;
}
interface Font {
  n: string;
  cat: string;
  h: string;
  b: string;
  mood: string;
  best: string;
}
interface StyleRow {
  n: string;
  kw: string;
  fx: string;
  css: string;
  best: string;
}
interface UiuxData {
  profiles: Profile[];
  fonts: Font[];
  styles: StyleRow[];
}

let dataPromise: Promise<UiuxData> | null = null;

/** Loaded lazily (about 200 KB) the first time a design is requested. */
function loadData(): Promise<UiuxData> {
  dataPromise ??= import("./uiux-data.json").then((m) => (m as unknown as { default: UiuxData }).default);
  return dataPromise;
}

// Russian terms the data set does not know, mapped to its English vocabulary.
const RU_EN: [RegExp, string][] = [
  [/лендинг|посадочн/, "landing page saas"],
  [/магазин|корзин|товар|маркетплейс/, "e-commerce shop"],
  [/дашборд|панел[ьи] управления|аналитик|админк/, "dashboard analytics admin"],
  [/банк|финанс|финтех|платеж|платёж|кошел/, "banking fintech finance"],
  [/крипт|блокчейн/, "crypto"],
  [/ресторан|кафе|меню|еда|доставк/, "restaurant food delivery"],
  [/спа|салон|красот|косметик/, "beauty spa wellness"],
  [/фитнес|тренировк|спорт/, "fitness sports"],
  [/клиник|врач|здоров|медицин|больниц/, "healthcare medical clinic"],
  [/образован|курс|обучен|школ|универс/, "education learning course"],
  [/игр|гейм/, "gaming"],
  [/блог|статьи|новост|журнал/, "blog news editorial"],
  [/портфолио|фотограф|студи/, "portfolio creative"],
  [/мессенджер|чат/, "messaging chat"],
  [/соцсет|социальн|сообществ/, "social network community"],
  [/недвижим|аренд|квартир/, "real estate"],
  [/путешеств|тур|отел|бронирован|авиа/, "travel booking hotel"],
  [/музык|подкаст|стрим|видео/, "music streaming media"],
  [/форм[аы] входа|вход|логин|авторизац|регистрац|пароль/, "login authentication signup"],
  [/мобильн|приложен/, "mobile app"],
  [/страхов/, "insurance"],
  [/юрист|юридич|адвокат/, "legal law"],
  [/благотвор|нко|фонд/, "nonprofit charity"],
  [/стартап|saas|сервис|подписк/, "saas startup"],
];

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s&/+-]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function expandQuery(query: string): string[] {
  const lower = query.toLowerCase();
  let extra = "";
  for (const [re, en] of RU_EN) if (re.test(lower)) extra += ` ${en}`;
  return tokens(`${lower} ${extra}`);
}

function scoreProfile(p: Profile, q: string[]): number {
  const name = tokens(p.n);
  const kw = new Set(p.k.flatMap((k) => tokens(k)));
  let score = 0;
  for (const t of q) {
    if (name.includes(t)) score += 3;
    else if (name.some((n) => n.startsWith(t) || t.startsWith(n)) && t.length > 3) score += 1.5;
    if (kw.has(t)) score += 2;
  }
  return score;
}

function pickFonts(data: UiuxData, p: Profile): Font {
  const moodWords = tokens(`${p.type} ${p.mood} ${p.style} ${p.n}`);
  let best = data.fonts[0];
  let bestScore = -1;
  for (const f of data.fonts) {
    const hay = new Set(tokens(`${f.mood} ${f.best} ${f.cat}`));
    let s = 0;
    for (const w of moodWords) if (hay.has(w)) s += 1;
    for (const w of tokens(p.n)) if (hay.has(w)) s += 2;
    if (s > bestScore) {
      bestScore = s;
      best = f;
    }
  }
  return best;
}

function pickStyle(data: UiuxData, p: Profile): StyleRow | null {
  const first = p.style.split("+")[0].trim().toLowerCase();
  return data.styles.find((s) => s.n.toLowerCase().startsWith(first.slice(0, 10))) ?? null;
}

/** A design-system recommendation for this request (the skill's `--design-system` step). */
export async function uiuxDesignSystem(query: string): Promise<string> {
  const data = await loadData();
  const q = expandQuery(query);
  let best: Profile | null = null;
  let bestScore = 0;
  for (const p of data.profiles) {
    const s = scoreProfile(p, q);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  const matched = best !== null && bestScore >= 2;
  const profile = best && matched ? best : (data.profiles.find((p) => p.n === "SaaS (General)") ?? data.profiles[0]);
  const font = pickFonts(data, profile);
  const style = pickStyle(data, profile);
  const pal = profile.pal;
  const lines = [
    matched
      ? `Design system recommendation (closest product type: ${profile.n}):`
      : `Design system recommendation (no close product match, using general defaults: ${profile.n}):`,
    `- Page pattern: ${profile.pattern}`,
    `- Style: ${profile.style}${profile.style2 ? ` (secondary: ${profile.style2})` : ""}`,
    style ? `- Style details: ${style.fx}. CSS hints: ${style.css}` : "",
    `- Color mood: ${profile.mood}`,
    `- Palette (define as CSS custom properties, light theme): primary ${pal.primary}, secondary ${pal.secondary}, accent/CTA ${pal.accent}, background ${pal.background}, foreground ${pal.foreground}, card ${pal.card}, muted ${pal.muted}, muted-foreground ${pal.mutedFg}, border ${pal.border}, destructive ${pal.destructive}`,
    `- Typography: heading "${font.h}", body "${font.b}" (${font.mood}). Remote fonts cannot be loaded, so write font-family as "${font.h}", system-ui, sans-serif and "${font.b}", system-ui, sans-serif`,
    profile.fx ? `- Effects: ${profile.fx}` : "",
    profile.avoid ? `- Avoid: ${profile.avoid}` : "",
    profile.note ? `- Consider: ${profile.note}` : "",
    "Derive the dark theme from this palette (desaturated tonal variants, not inverted) and keep contrast >= 4.5:1.",
  ];
  return lines.filter(Boolean).join("\n");
}
