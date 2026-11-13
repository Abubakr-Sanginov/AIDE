// DEV-ONLY: lets the UI render in a plain browser (no Tauri) with a fake project.
// It also records Tauri event listeners so tests can emit backend events
// (window.__aideEmit) and see every invoked command (window.__aideCalls).
const ROOT = "D:/Projects/AIDE";
const dirs: Record<string, [string, boolean][]> = {
  [ROOT]: [
    [".sharrowkin", true], ["public", true], ["src", true], ["src-tauri", true],
    [".gitignore", false], ["AGENTS.md", false], ["index.html", false],
    ["package-lock.json", false], ["package.json", false], ["project-page.html", false],
    ["README.md", false], ["tsconfig.json", false], ["tsconfig.node.json", false], ["vite.config.ts", false],
  ],
  [`${ROOT}/src`]: [["app", true], ["shell", true], ["main.tsx", false], ["vite-env.d.ts", false]],
};
const code = `import { useEffect } from "react";\n\nexport default function App() {\n  useEffect(() => {\n    console.log("hello");\n  }, []);\n  return <div className="shell">AIDE</div>;\n}\n`;

const gitFiles: { path: string; orig_path: string | null; index: string; worktree: string }[] = [
  { path: "src/app/App.tsx", orig_path: null, index: " ", worktree: "M" },
  { path: "README.md", orig_path: null, index: "M", worktree: " " },
  { path: "notes.txt", orig_path: null, index: "?", worktree: "?" },
];

if (!("__TAURI_INTERNALS__" in window)) {
  localStorage.setItem("aide.workspaceRoot", ROOT);
  let cb = 1;
  const callbacks: Record<number, (e: unknown) => void> = {};
  const listeners: Record<string, number[]> = {};
  const w = window as unknown as Record<string, unknown>;
  w.__aideCalls = [] as string[];
  w.__aideEmit = (event: string, payload: unknown) => {
    for (const h of listeners[event] ?? []) callbacks[h]?.({ event, id: 0, payload });
  };
  w.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback: (fn: (e: unknown) => void) => {
      const id = cb++;
      callbacks[id] = fn;
      return id;
    },
    unregisterCallback: (id: number) => {
      delete callbacks[id];
    },
    invoke: async (cmd: string, args: Record<string, string>) => {
      (w.__aideCalls as string[]).push(cmd);
      if (cmd === "list_dir") {
        return (dirs[args.path] ?? []).map(([name, is_dir]) => ({ name, path: `${args.path}/${name}`, is_dir }));
      }
      if (cmd === "trash_entries" || cmd === "delete_entries") {
        // Removes the entries from the fake project, as the real commands do on disk.
        const paths = (args as unknown as { paths: string[] }).paths;
        for (const p of paths) {
          const slash = p.lastIndexOf("/");
          const parent = p.slice(0, slash);
          dirs[parent] = (dirs[parent] ?? []).filter(([name]) => name !== p.slice(slash + 1));
        }
        return { done: paths, failed: [] };
      }
      if (cmd === "scan_agent_accounts") {
        return [
          { id: "claude-code", name: "Claude Code", known: true, location: "~\\.claude", plan: "Max", account: "al***@mail.com", expires_at: Date.now() + 3600_000, facts: [["Уровень", "default_claude_max_5x"]], signed_in: true },
          { id: "codex", name: "Codex (OpenAI)", known: true, location: "~\\.codex", plan: "Plus", account: "me***@mail.com", expires_at: null, facts: [["Подписка до", "2026-12-01"]], signed_in: true },
          { id: "gemini", name: "Gemini CLI", known: true, location: "~\\.gemini", plan: null, account: null, expires_at: null, facts: [], signed_in: false },
          { id: "found-genspark", name: "Genspark-tool-cli", known: false, location: "~\\.genspark-tool-cli", plan: null, account: null, expires_at: null, facts: [], signed_in: true },
        ];
      }
      if (cmd === "read_file") return code;
      if (cmd === "fetch_site") {
        const { url: rawUrl, html: pasted } = args as unknown as { url: string; html: string | null };
        const url = String(rawUrl);
        if (pasted) return { finalUrl: url, html: pasted, stylesheets: [] };
        if (/blocked\.example/i.test(url)) throw "Сайт не разрешил автоматическую загрузку (ошибка 403). Откройте страницу в браузере, нажмите Ctrl+U, скопируйте исходный код и вставьте его ниже.";
        if (/^https?:\/\/(localhost|127\.|10\.|169\.254)/i.test(url)) throw "Локальные адреса недоступны";
        return {
          finalUrl: url,
          html: '<html lang="en"><head><title>Acme Cloud - Ship faster</title><meta name="description" content="Deploy in seconds."><style>:root{--brand:#635bff;--bg:#0a2540}body{background:#ffffff;color:#0a2540;font-family:"Inter",sans-serif}.hero{background:linear-gradient(135deg,#635bff,#00d4ff);border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,.2)}.card{border-radius:12px;max-width:1200px}</style></head><body><header><nav><a>Products</a><a>Pricing</a><a>Docs</a></nav></header><section class="hero"><h1>Ship faster</h1><p>Deploy in seconds.</p><button>Get started</button></section><section class="cards"><div class="card"><h3>Fast</h3></div><div class="card"><h3>Safe</h3></div><div class="card"><h3>Simple</h3></div></section><footer><a>Terms</a></footer></body></html>',
          stylesheets: [{ url: url + "/app.css", css: ".btn{background:#635bff;color:#fff;border-radius:8px}.link{color:#635bff}" }],
        };
      }
      if (cmd.endsWith("|listen")) {
        (listeners[args.event] ??= []).push(args.handler as unknown as number);
        return 1;
      }
      if (cmd.endsWith("|unlisten")) return null;
      // Stands in for src-tauri/src/kv_store.rs: a "file" that lives outside localStorage.
      if (cmd === "kv_load") return JSON.parse(sessionStorage.getItem("__aide_kv_file") ?? "{}");
      if (cmd === "kv_save") {
        const file = JSON.parse(sessionStorage.getItem("__aide_kv_file") ?? "{}") as Record<string, string>;
        for (const [k, v] of Object.entries((args as unknown as { changes: Record<string, string | null> }).changes)) {
          if (v === null) delete file[k];
          else file[k] = v;
        }
        sessionStorage.setItem("__aide_kv_file", JSON.stringify(file));
        return null;
      }
      // Dev stand-in for src-tauri/src/extensions.rs: talks to Open VSX directly (CORS is open).
      if (cmd.startsWith("ext_")) {
        const store = JSON.parse(localStorage.getItem("__mock_ext") ?? "{}") as Record<string, string>;
        const API = "https://open-vsx.org/api";
        if (cmd === "ext_search") {
          const a = args as unknown as { query: string; offset: number; category: string | null };
          const q = new URLSearchParams({ query: a.query, size: "20", offset: String(a.offset), sortBy: "downloadCount", ...(a.category ? { category: a.category } : {}) });
          const v = await (await fetch(`${API}/-/search?${q}`)).json();
          return { total: v.totalSize, items: v.extensions.map((e: Record<string, unknown> & { files: { icon?: string } }) => ({ ...e, iconUrl: e.files.icon })) };
        }
        if (cmd === "ext_install") {
          const { namespace, name } = args as unknown as { namespace: string; name: string };
          const meta = await (await fetch(`${API}/${namespace}/${name}`)).json();
          store[`${namespace}.${name}`] = meta.version;
          localStorage.setItem("__mock_ext", JSON.stringify(store));
          return `${namespace}.${name}`;
        }
        if (cmd === "ext_list") return Object.keys(store);
        if (cmd === "ext_remove") {
          delete store[(args as unknown as { id: string }).id];
          localStorage.setItem("__mock_ext", JSON.stringify(store));
          return null;
        }
        if (cmd === "ext_read") {
          const { id, path } = args as unknown as { id: string; path: string };
          const [ns, ...rest] = id.split(".");
          const res = await fetch(`${API}/${ns}/${rest.join(".")}/${store[id]}/file/${path}`);
          if (!res.ok) throw "Файл не найден";
          return await res.text();
        }
      }
      // Dev stand-in for src-tauri/src/git_service.rs: an in-memory repository.
      if (cmd.startsWith("git_") && cmd !== "git_branch") {
        const a = args as unknown as { path: string; rev: string; paths: string[]; message: string };
        const find = (p: string) => gitFiles.find((f) => f.path === p);
        if (cmd === "git_status") {
          return { top: ROOT, branch: "main", ahead: 1, behind: 0, files: gitFiles.map((f) => ({ ...f })), truncated: false };
        }
        if (cmd === "git_show") {
          if (a.path === "README.md") return "# AIDE\n";
          if (a.path === "notes.txt") return a.rev === "index" && find(a.path)?.index === "A" ? "notes\n" : null;
          return code.replace('console.log("hello")', 'console.log("hi")');
        }
        if (cmd === "git_stage") {
          for (const p of a.paths) {
            const f = find(p);
            if (!f) continue;
            if (f.index === "?") Object.assign(f, { index: "A", worktree: " " });
            else if (f.worktree !== " ") Object.assign(f, { index: f.worktree === "D" ? "D" : f.index === "A" ? "A" : "M", worktree: " " });
          }
          return null;
        }
        if (cmd === "git_unstage") {
          for (const p of a.paths) {
            const f = find(p);
            if (!f) continue;
            if (f.index === "A") Object.assign(f, { index: "?", worktree: "?" });
            else if (f.index !== " ") Object.assign(f, { worktree: f.worktree === " " ? f.index : f.worktree, index: " " });
          }
          return null;
        }
        if (cmd === "git_discard") {
          for (const p of a.paths) {
            const f = find(p);
            if (!f || f.index === "?") throw "error: pathspec did not match any file(s) known to git";
            if (f.index === " ") gitFiles.splice(gitFiles.indexOf(f), 1);
            else f.worktree = " ";
          }
          return null;
        }
        if (cmd === "git_commit") {
          if (!String(a.message ?? "").trim()) throw "Введите сообщение коммита";
          for (const f of [...gitFiles]) {
            if (f.index === " " || f.index === "?") continue;
            if (f.worktree === " ") gitFiles.splice(gitFiles.indexOf(f), 1);
            else f.index = " ";
          }
          return "abc1234";
        }
      }
      if (cmd === "git_branch") return "main";
      if (cmd.includes("is_maximized")) return false;
      // Dev stand-in for src-tauri/src/browser_view.rs: tab-less, just an address.
      if (cmd.startsWith("bv_")) {
        void args;
        if (cmd === "bv_tabs") return JSON.stringify({ tabs: [], active: null });
        if (cmd === "bv_info") return null;
        if (cmd === "bv_snapshot") return "Снимок страницы (mock): демо-страница";
        if (cmd === "bv_open" || cmd === "bv_activate" || cmd === "bv_close_tab" || cmd === "bv_bounds" || cmd === "bv_viewport" || cmd === "bv_viewport_get" || cmd === "bv_visible" || cmd === "bv_navigate" || cmd === "bv_action" || cmd === "bv_close") return null;
        if (cmd === "bv_eval") return "[mock] ok";
        if (cmd === "bv_console") return JSON.stringify({ epoch: "mock", total: 0, entries: [] });
        if (cmd === "bv_devtools") return null;
      }
      return null;
    },
  };
}
export {};
