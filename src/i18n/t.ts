import translations, { type Lang } from "@/i18n/translations";

type TranslationKey = keyof typeof translations.en;

const KEY = "aide.lang";

function currentLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved in translations) return saved as Lang;
  } catch {}
  return "en";
}

export function t(key: TranslationKey, params?: Record<string, string>): string {
  const lang = currentLang();
  const dict = translations[lang] ?? translations.en;
  let s = dict[key] ?? translations.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(v);
    }
  }
  return s;
}