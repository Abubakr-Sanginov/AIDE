import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { fs } from "@/api/fs";
import { joinPath } from "@/lib/fsUtils";
import { useAi } from "@/stores/ai";
import { useTabs } from "@/stores/tabs";
import { useTree } from "@/stores/tree";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { buildDocument } from "@/features/design/dom";
import type { Frame } from "@/features/design/store";
import { briefFor } from "@/features/design/projectBrief";

// "Create in project": the design is turned into a project of the stack the user picked.
// Plain HTML is written directly. Framework stacks get the design screens as reference files and the
// project agent builds the app from them (every tool call of the agent still goes through its permission gate).

export type StackId = "html" | "react" | "vue" | "svelte" | "next" | "astro";
export type CodeLang = "ts" | "js";
export type CssKind = "plain" | "tailwind";

export interface StackDef {
  id: StackId;
  name: string;
  blurb: { ru: string; en: string };
  /** Offers the TypeScript / JavaScript choice. */
  typed: boolean;
  /** Offers Tailwind CSS. */
  tailwind: boolean;
  /** Folders the agent should use (language neutral, shown after the localized "Structure" label). */
  folders: string;
}

export const STACKS: StackDef[] = [
  {
    id: "html",
    name: "HTML / CSS",
    blurb: { ru: "Статичные страницы без сборки", en: "Static pages, no build step" },
    typed: false,
    tailwind: false,
    folders: "",
  },
  {
    id: "react",
    name: "React + Vite",
    blurb: { ru: "Компоненты, быстрая сборка", en: "Components, fast build" },
    typed: true,
    tailwind: true,
    folders: "src/main, src/pages, src/components",
  },
  {
    id: "vue",
    name: "Vue 3 + Vite",
    blurb: { ru: "Single-file компоненты", en: "Single-file components" },
    typed: true,
    tailwind: true,
    folders: "src/main, src/views, src/components (Vue 3, <script setup>)",
  },
  {
    id: "svelte",
    name: "Svelte + Vite",
    blurb: { ru: "Минимум кода, без рантайма", en: "Minimal code, tiny runtime" },
    typed: true,
    tailwind: true,
    folders: "src/routes, src/lib",
  },
  {
    id: "next",
    name: "Next.js",
    blurb: { ru: "Сервер и маршруты из коробки", en: "Server and routing built in" },
    typed: true,
    tailwind: true,
    folders: "app/<route>/page, components (App Router)",
  },
  {
    id: "astro",
    name: "Astro",
    blurb: { ru: "Быстрые сайты и лендинги", en: "Fast sites and landing pages" },
    typed: true,
    tailwind: true,
    folders: "src/pages/*.astro, src/components",
  },
];

export interface CreateOptions {
  stack: StackId;
  folder: string;
  frameIds: string[];
  lang: CodeLang;
  css: CssKind;
  routing: boolean;
  responsive: boolean;
  runAfter: boolean;
}

/** Folder name: letters, digits, - and _ only; it becomes a direct child of the project (no paths). */
export function validFolder(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(name);
}

export function slugOf(name: string, taken: Set<string>, i: number): string {
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || `screen-${i + 1}`;
  while (taken.has(slug)) slug += `-${i + 1}`;
  taken.add(slug);
  return slug;
}

export type CreateResult = { ok: true; folder: string; agent: boolean; note: string } | { ok: false; error: string };

const esc = (v: string) => v.replace(/[<>&"]/g, "");

function buildBrief(o: CreateOptions, stack: StackDef, files: { name: string; file: string; device: Frame["device"] }[], lang: string): string {
  const B = briefFor(lang);
  const list = files.map((f) => `- design/${f.file} — ${f.name} (${B.devices[f.device]})`).join("\n");
  const code = stack.typed ? (o.lang === "ts" ? B.codeTs : B.codeJs) : "";
  const css = o.css === "tailwind" ? B.cssTailwind : B.cssPlain;
  return [
    B.intro(o.folder),
    "",
    B.stack(stack.name, code, css),
    ...(stack.folders ? [`${B.folders}: ${stack.folders}`] : []),
    "",
    B.screens,
    list,
    "",
    B.needs,
    B.reproduce,
    o.routing && files.length > 1 ? B.navYes : B.navNo,
    o.responsive ? B.respYes : B.respNo,
    "",
    B.rules,
    B.ruleFolder(o.folder),
    B.rulePin,
    B.ruleGit,
    B.ruleSecrets,
    o.runAfter ? B.runYes : B.runNo,
    B.finish,
    "",
    B.reply,
  ].join("\n");
}

export async function createFromDesign(o: CreateOptions, frames: Frame[], lang: string): Promise<CreateResult> {
  const ru = isRuLike(lang);
  const root = useWorkspace.getState().root;
  if (!root) return { ok: false, error: ru ? rt("Сначала откройте папку проекта.") : "Open a project folder first." };
  if (!validFolder(o.folder)) return { ok: false, error: ru ? rt("Имя папки: латиница, цифры, - и _, до 40 символов.") : "Folder name: letters, digits, - and _, up to 40 characters." };
  const stack = STACKS.find((s) => s.id === o.stack);
  if (!stack) return { ok: false, error: "Unknown stack" };
  const chosen = frames.filter((f) => o.frameIds.includes(f.id) && f.html.trim());
  if (chosen.length === 0) return { ok: false, error: ru ? rt("Выберите хотя бы один экран.") : "Pick at least one screen." };

  try {
    // Never write into an existing folder: it may hold the user's own files.
    const existing = await fs.listDir(root);
    if (existing.some((e) => e.name.toLowerCase() === o.folder.toLowerCase())) {
      return { ok: false, error: lang === "tg" ? `Ҷузвдони «${o.folder}» дар лоиҳа аллакай ҳаст. Номи дигар интихоб кунед.` : ru ? `Папка «${o.folder}» уже есть в проекте. Выберите другое имя.` : `A folder named "${o.folder}" already exists. Choose another name.` };
    }
    const dir = joinPath(root, o.folder);
    await fs.createEntry(dir, true);

    const screensDir = stack.id === "html" ? dir : joinPath(dir, "design");
    if (stack.id !== "html") await fs.createEntry(screensDir, true);

    const used = new Set<string>(["index"]);
    const files: { name: string; file: string; device: Frame["device"] }[] = [];
    for (const [i, f] of chosen.entries()) {
      const single = stack.id === "html" && chosen.length === 1;
      const file = single ? "index.html" : `${slugOf(f.name, used, i)}.html`;
      const path = joinPath(screensDir, file);
      await fs.createEntry(path, false);
      await fs.writeFile(path, buildDocument(f.html, { forExport: true, title: f.name }));
      files.push({ name: f.name, file, device: f.device });
    }

    if (stack.id === "html") {
      if (chosen.length > 1) {
        const index =
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(o.folder)}</title></head>` +
          `<body style="font-family:system-ui;padding:32px"><h1>${esc(o.folder)}</h1><ul>` +
          files.map((f) => `<li><a href="${esc(f.file)}">${esc(f.name)}</a></li>`).join("") +
          `</ul></body></html>`;
        const indexPath = joinPath(dir, "index.html");
        await fs.createEntry(indexPath, false);
        await fs.writeFile(indexPath, index);
      }
      void useTree.getState().refreshParents([dir]);
      await useTabs.getState().open(joinPath(dir, chosen.length > 1 ? "index.html" : files[0].file));
      useUi.getState().setMode("ide");
      return { ok: true, folder: o.folder, agent: false, note: lang === "tg" ? `Тайёр: ${files.length} экран дар ҷузвдони ${o.folder}.` : ru ? `Готово: ${files.length} экр. в папке ${o.folder}.` : `Done: ${files.length} screen(s) in ${o.folder}.` };
    }

    void useTree.getState().refreshParents([dir]);
    const ai = useAi.getState();
    if (!ai.hasKey || !ai.model) {
      useUi.getState().setMode("ide");
      return {
        ok: true,
        folder: o.folder,
        agent: false,
        note: lang === "tg"
          ? `Экранҳо дар ${o.folder}/design нигоҳ дошта шуданд, аммо агент оғоз нашуд: калиди API танзим нашудааст (Танзимот → Агент).`
          : ru
          ? `Экраны сохранены в ${o.folder}/design, но агент не запущен: не настроен API-ключ (Настройки → Агент).`
          : `Screens saved to ${o.folder}/design, but the agent was not started: no API key is set (Settings → Agent).`,
      };
    }
    // Hand the build to the project agent in the IDE.
    useUi.setState({ mode: "ide", settingsOpen: false, rightPanelVisible: true, rightTab: "chat" });
    ai.setMode("agent");
    void useAi.getState().send(buildBrief(o, stack, files, lang));
    return { ok: true, folder: o.folder, agent: true, note: ru ? rt("Агент создаёт проект.") : "The agent is building the project." };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
