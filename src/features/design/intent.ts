// Detects what the user wants from a chat message, so the app can create separate
// screens itself instead of relying on the model to follow the multi-screen format.

export interface Intent {
  /** Make a dark / light version of the existing screens. */
  theme: "dark" | "light" | null;
  /** Make tablet and phone versions. */
  adapt: boolean;
  /** Add new screens (sign-up, settings, ...). */
  newScreens: boolean;
}

const DARK = /(тёмн|темн|ночн|\bdark)/i;
const LIGHT = /(светл\w*\s+(тем|верси|вариант|режим|оформл)|\blight\s+(theme|mode|version))/i;
const THEME_CTX = /(тем[аыуеой](?![а-яё])|theme|верси|вариант|variant|\bmode\b|режим|оформлен)/i;

const DEVICE = /(планшет|tablet|телефон|мобил|mobile|адаптив|адаптац|responsive|ipad|iphone|смартфон)/i;
const ADD_VERB = /(добав|созда|сдела|нужн|нарису|адапт|хочу|и для|\badd\b|create|make|build|draw|need|want|adapt|also)/i;

// Specific screens always mean "add a new screen"; generic words only when nothing else is asked.
const SPECIFIC_SCREEN =
  /(регистрац|sign.?up|signup|register|login|вход|логин|авторизац|восстановлен|forgot|профил|profile|настройк|settings|корзин|\bcart\b|checkout|оплат|payment|онбординг|onboarding|dashboard|дашборд|лендинг|landing|каталог|catalog)/i;
const GENERIC_SCREEN = /(экран|страниц|screen|\bpage\b|главн|\bhome\b|форм[ауы]|список)/i;

/**
 * `knownNames` are names of existing screens: a screen called "Sign in" must not make
 * "add a tablet version of sign in" look like a request for a new sign-in screen.
 */
export function detectIntent(text: string, knownNames: string[] = []): Intent {
  const t = text.toLowerCase();
  let theme: Intent["theme"] = null;
  if (DARK.test(t) && THEME_CTX.test(t)) theme = "dark";
  else if (LIGHT.test(t)) theme = "light";
  const adapt = DEVICE.test(t) && ADD_VERB.test(t);
  // Theme and device words are not screen names, and "a dark theme" alone is not a new screen.
  let rest = t.replace(DARK, " ").replace(LIGHT, " ").replace(THEME_CTX, " ").replace(DEVICE, " ");
  for (const n of knownNames) {
    const k = n.toLowerCase().trim();
    if (k.length > 2) rest = rest.split(k).join(" ");
  }
  const newScreens = ADD_VERB.test(t) && (SPECIFIC_SCREEN.test(rest) || (GENERIC_SCREEN.test(rest) && !theme && !adapt));
  return { theme, adapt, newScreens };
}

/** "Screen - Desktop - Dark" -> "Screen" */
export function baseName(name: string): string {
  let n = name.trim();
  const tail = /\s*[-–—·:]\s*(desktop|tablet|mobile|dark|light|компьютер|планшет|телефон|тёмная|темная|светлая)\s*$/i;
  for (let i = 0; i < 4 && tail.test(n); i++) n = n.replace(tail, "");
  return n || name.trim();
}

/** A short screen name from the user's wording, e.g. "добавь регистрацию" -> "Регистрацию". */
export function deriveName(text: string): string {
  const cleaned = text
    .replace(/^(пожалуйста|please)[,\s]*/i, "")
    .replace(/^(добавь|создай|сделай|нарисуй|добавить|создать|сделать|add|create|make|build|draw)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : "";
}

const SCREEN_NAMES: [RegExp, string, string][] = [
  [/регистрац|sign.?up|signup|register/i, "Регистрация", "Sign up"],
  [/восстановлен|forgot/i, "Восстановление пароля", "Password recovery"],
  [/вход|логин|login|авторизац|sign.?in/i, "Вход", "Login"],
  [/профил|profile/i, "Профиль", "Profile"],
  [/настройк|settings/i, "Настройки", "Settings"],
  [/корзин|\bcart\b/i, "Корзина", "Cart"],
  [/оплат|checkout|payment/i, "Оплата", "Checkout"],
  [/онбординг|onboarding/i, "Онбординг", "Onboarding"],
  [/каталог|catalog/i, "Каталог", "Catalog"],
  [/дашборд|dashboard/i, "Дашборд", "Dashboard"],
  [/лендинг|landing/i, "Лендинг", "Landing page"],
];

/** A proper screen name for the request ("добавь регистрацию" -> "Регистрация"), earliest mention first. */
export function screenNameFor(text: string, ru: boolean): string {
  let best: { at: number; name: string } | null = null;
  for (const [re, nameRu, nameEn] of SCREEN_NAMES) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.at)) best = { at: m.index, name: ru ? nameRu : nameEn };
  }
  return best?.name ?? deriveName(text);
}
