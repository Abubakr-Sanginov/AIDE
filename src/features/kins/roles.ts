// Kins: a team of AI roles. The user is the CEO. Roles are plain prompts on top of the
// existing AI backend; nothing here executes model output.

export type RoleId =
  | "lead"
  | "design"
  | "front"
  | "back"
  | "qa"
  | "devops"
  | "analyst"
  | "lawyer"
  | "accountant"
  | "marketer"
  | "intern"
  | "joker";

export interface Role {
  id: RoleId;
  name: { ru: string; en: string; tg: string };
  blurb: { ru: string; en: string; tg: string };
  /** Avatar background / foreground (hex). */
  tint: string;
  ink: string;
  /** Short role brief that goes in front of every task for that role. */
  persona: string;
  /** May write files and run commands. */
  hands: boolean;
}

export const ROLES: Role[] = [
  {
    id: "lead",
    name: { ru: "Тимлид", en: "Team lead", tg: "Сардори даста" },
    blurb: { ru: "делит работу и проверяет итог", en: "splits the work, checks the result", tg: "кор тақсим мекунад ва натиҷаро месанҷад" },
    tint: "#dcdcf5",
    ink: "#23233a",
    persona:
      "Ты тимлид. Раскладываешь задачу CEO на шаги для ролей, следишь за качеством и не принимаешь работу без доказанной проверки.",
    hands: false,
  },
  {
    id: "design",
    name: { ru: "Дизайн", en: "Design", tg: "Тарроҳ" },
    blurb: { ru: "макеты и интерфейс", en: "mockups and interface", tg: "макетҳо ва интерфейс" },
    tint: "#f1d9e8",
    ink: "#3a2331",
    persona:
      "Ты продуктовый дизайнер. Продумываешь экраны, состояния (пустое, загрузка, ошибка), адаптив и тёмную тему, делаешь аккуратную вёрстку и стили в проекте.",
    hands: true,
  },
  {
    id: "front",
    name: { ru: "Фронт", en: "Front", tg: "Фронтенд" },
    blurb: { ru: "экраны и вёрстка", en: "screens and markup", tg: "экранҳо ва вёрстка" },
    tint: "#cfeee3",
    ink: "#1f3a31",
    persona:
      "Ты фронтенд-разработчик. Пишешь экраны, компоненты, навигацию и состояние; все кнопки и ссылки должны работать.",
    hands: true,
  },
  {
    id: "back",
    name: { ru: "Бэк", en: "Back", tg: "Бэкенд" },
    blurb: { ru: "сервер, база, оплата", en: "server, database, payments", tg: "сервер, пойгоҳи додаҳо, пардохт" },
    tint: "#e6dcef",
    ink: "#2d2339",
    persona:
      "Ты бэкенд-разработчик. Делаешь API, хранение данных и интеграции. Безопасность по умолчанию: проверка входных данных на сервере, параметризованные запросы, секреты только в переменных окружения.",
    hands: true,
  },
  {
    id: "qa",
    name: { ru: "QA", en: "QA", tg: "QA" },
    blurb: { ru: "проверяет каждую задачу", en: "tests every task", tg: "ҳар вазифаро месанҷад" },
    tint: "#ece6cf",
    ink: "#3a3520",
    persona:
      "Ты тестировщик. Ты НИКОГДА не считаешь работу готовой на слово: открываешь приложение в браузере, проходишь по каждой странице и ссылке, проверяешь каждую функцию и ошибки консоли, и только потом выносишь вердикт.",
    hands: true,
  },
  {
    id: "devops",
    name: { ru: "Девопс", en: "DevOps", tg: "DevOps" },
    blurb: { ru: "сборка и выпуск", en: "build and release", tg: "сохтан ва нашр" },
    tint: "#d7e6f2",
    ink: "#213244",
    persona: "Ты девопс. Отвечаешь за сборку, запуск, конфигурацию и выпуск; следишь, чтобы проект собирался и запускался с нуля.",
    hands: true,
  },
  {
    id: "analyst",
    name: { ru: "Аналитик", en: "Analyst", tg: "Таҳлилгар" },
    blurb: { ru: "цифры и юнит-экономика", en: "numbers and unit economics", tg: "рақамҳо ва иқтисоди воҳид" },
    tint: "#e8e0d2",
    ink: "#3a3224",
    persona: "Ты аналитик. Считаешь метрики и юнит-экономику, предлагаешь, что измерять.",
    hands: false,
  },
  {
    id: "lawyer",
    name: { ru: "Юрист", en: "Lawyer", tg: "Ҳуқуқшинос" },
    blurb: { ru: "оферта и политика", en: "terms and privacy policy", tg: "оферта ва сиёсати махфият" },
    tint: "#e2e2e2",
    ink: "#2b2b2b",
    persona: "Ты юрист. Готовишь черновики оферты и политики конфиденциальности, отмечаешь риски. Это не юридическая консультация.",
    hands: false,
  },
  {
    id: "accountant",
    name: { ru: "Бухгалтер", en: "Accountant", tg: "Муҳосиб" },
    blurb: { ru: "финмодель", en: "financial model", tg: "модели молиявӣ" },
    tint: "#d9ead6",
    ink: "#243a20",
    persona: "Ты бухгалтер. Строишь простую финансовую модель и считаешь расходы.",
    hands: false,
  },
  {
    id: "marketer",
    name: { ru: "Маркетолог", en: "Marketer", tg: "Маркетолог" },
    blurb: { ru: "запуск и реклама", en: "launch and ads", tg: "оғоз ва таблиғот" },
    tint: "#f3dccd",
    ink: "#3f2616",
    persona: "Ты маркетолог. Формулируешь позиционирование, тексты и план запуска.",
    hands: false,
  },
  {
    id: "intern",
    name: { ru: "Стажёр", en: "Intern", tg: "Стажёр" },
    blurb: { ru: "мелкие задачи", en: "small tasks", tg: "вазифаҳои хурд" },
    tint: "#e0eadb",
    ink: "#26331f",
    persona: "Ты стажёр. Берёшь небольшие несложные задачи и аккуратно их выполняешь.",
    hands: true,
  },
  {
    id: "joker",
    name: { ru: "Шутник", en: "Joker", tg: "Шӯхитабъ" },
    blurb: { ru: "держит настроение в созвоне", en: "keeps the mood up on calls", tg: "дар занг кайфиятро боло нигоҳ медорад" },
    tint: "#f2e3b9",
    ink: "#3d3217",
    persona: "Ты шутник команды: коротко и по-доброму разряжаешь обстановку, но не мешаешь работе.",
    hands: false,
  },
];

export const ROLE_BY_ID: Record<RoleId, Role> = Object.fromEntries(ROLES.map((r) => [r.id, r])) as Record<RoleId, Role>;

export type PresetId = "feature" | "startup" | "custom";

export interface Preset {
  id: PresetId;
  name: { ru: string; en: string; tg: string };
  blurb: { ru: string; en: string; tg: string };
  roles: RoleId[];
}

export const PRESETS: Preset[] = [
  {
    id: "feature",
    name: { ru: "Фича", en: "Feature", tg: "Функсия" },
    blurb: { ru: "Новая функция в готовом проекте: быстро и без лишних людей.", en: "A new feature in an existing project: fast, no extra people.", tg: "Вазифаи нав дар лоиҳаи тайёр: зуд ва бе одамони зиёдатӣ." },
    roles: ["lead", "front", "back", "qa"],
  },
  {
    id: "startup",
    name: { ru: "Стартап", en: "Startup", tg: "Стартап" },
    blurb: { ru: "Продукт с нуля: дизайн, код, оплата, оферта, запуск и реклама.", en: "A product from scratch: design, code, payments, terms, launch and ads.", tg: "Маҳсулот аз сифр: тарроҳӣ, код, пардохт, оферта, оғоз ва таблиғот." },
    roles: ["lead", "design", "front", "back", "qa", "devops", "joker"],
  },
  {
    id: "custom",
    name: { ru: "Своя", en: "Custom", tg: "Шахсӣ" },
    blurb: { ru: "Соберите состав сами — любые роли, любые модели.", en: "Build the team yourself — any roles, any models.", tg: "Таркибро худатон ҷамъ кунед — ҳар нақш, ҳар модел." },
    roles: ["lead", "design", "front", "back", "qa"],
  },
];

/** Roles that can never be switched off: the lead plans and QA verifies. */
export const REQUIRED: RoleId[] = ["lead"];
