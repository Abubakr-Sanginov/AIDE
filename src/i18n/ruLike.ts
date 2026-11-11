/**
 * Screens that only have Russian and English texts use Russian for Tajik too:
 * Tajik speakers read Russian far more often than English. The main interface has a real Tajik translation.
 */
export function isRuLike(lang: string | null | undefined): boolean {
  return lang === "ru" || lang === "tg";
}

/** The language chosen in the app (for code outside React). */
export function appLang(): string {
  try {
    return localStorage.getItem("aide.lang") ?? "en";
  } catch {
    return "en";
  }
}
