use super::*;
use std::fs;

fn project(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("aide-index-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    for (rel, text) in files {
        let p = dir.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }
    dir
}

const LOGIN: &str = "import { db } from '../db';\n\nexport async function authenticateUser(email: string, password: string) {\n  const user = await findUserByEmail(email);\n  return verifyPassword(user, password);\n}\n\nexport class SessionStore {\n  create(userId: string) {\n    return db.insert(userId);\n  }\n  destroy(token: string) {\n    return db.remove(token);\n  }\n}\n";

fn fixture(name: &str) -> PathBuf {
    project(name, &[
        ("src/auth/login.ts", LOGIN),
        ("src/billing/invoice.ts", "export function calculateInvoiceTotal(items: Item[]) {\n  return items.reduce((s, i) => s + i.price, 0);\n}\nexport const TAX_RATE = 0.2;\n"),
        ("src/utils/format.ts", "export const formatDate = (d: Date) => d.toISOString();\n"),
        ("server/handler.py", "class RequestHandler:\n    def handle(self, request):\n        return self.parse_headers(request)\n\n    def parse_headers(self, request):\n        return {}\n"),
        ("docs/README.md", "# Guide\n\nSome words about the login flow.\n\n## Install\n"),
        (".env", "SECRET_TOKEN=abc123\n"),
        (".gitignore", "ignored_dir/\n*.log\n"),
        ("ignored_dir/hidden.ts", "export function hiddenThing() {}\n"),
        ("build.log", "authenticateUser failed\n"),
        ("node_modules/lib/index.js", "export function nodeModulesThing() {}\n"),
        ("dist/bundle.js", "function distThing() {}\n"),
    ])
}

#[test]
fn splits_identifiers_into_searchable_parts() {
    let mut c = HashMap::new();
    add_tokens("getUserById HTTPServer snake_case_name users", 1, &mut c);
    for want in ["get", "user", "by", "id", "getuserbyid", "http", "server", "httpserver", "snake", "case", "name", "snakecasename"] {
        assert!(c.contains_key(want), "нет термина {want}: {:?}", c.keys().collect::<Vec<_>>());
    }
    // «users» → «user»: слово встречается и в getUserById, и отдельно.
    assert_eq!(c["user"], 2);
    assert_eq!(stem("class"), "class");
    assert_eq!(stem("status"), "status");
    assert_eq!(stem("items"), "item");
    // хэши и минифицированный мусор не раздувают индекс
    let mut junk = HashMap::new();
    add_tokens(&"a1b2c3d4".repeat(12), 1, &mut junk);
    assert!(junk.is_empty());
}

#[test]
fn extracts_symbols_in_several_languages() {
    let ts = extract_symbols("js", &LOGIN.lines().collect::<Vec<_>>());
    let names: Vec<(&str, &str, Option<&str>)> = ts.iter().map(|s| (s.name.as_str(), s.kind, s.container.as_deref())).collect();
    assert!(names.contains(&("authenticateUser", "function", None)), "{names:?}");
    assert!(names.contains(&("SessionStore", "class", None)));
    assert!(names.contains(&("create", "method", Some("SessionStore"))));
    assert!(names.contains(&("destroy", "method", Some("SessionStore"))));

    let ts2 = extract_symbols("js", &["export interface Props {", "export type Id = string;", "export enum Mode { A }", "export const useAi = create<S>(() => ({}));", "const local = (x) => x;"]);
    let k: Vec<(&str, &str)> = ts2.iter().map(|s| (s.name.as_str(), s.kind)).collect();
    assert_eq!(k, vec![("Props", "interface"), ("Id", "type"), ("Mode", "enum"), ("useAi", "const"), ("local", "function")]);

    let py = extract_symbols("py", &["class A:", "    def run(self):", "        pass", "MAX_RETRIES = 3", "async def main():"]);
    assert_eq!(py.iter().map(|s| (s.name.as_str(), s.container.is_some())).collect::<Vec<_>>(), vec![("A", false), ("run", true), ("MAX_RETRIES", false), ("main", false)]);

    let rs = extract_symbols("rs", &["pub struct Index {", "}", "impl Index {", "    pub fn search(&self) {}", "}", "pub(crate) async fn run() {}", "const LIMIT: usize = 3;", "impl Drop for Index {"]);
    let rk: Vec<(&str, &str, Option<&str>)> = rs.iter().map(|s| (s.name.as_str(), s.kind, s.container.as_deref())).collect();
    assert!(rk.contains(&("search", "function", Some("Index"))), "{rk:?}");
    assert!(rk.contains(&("run", "function", None)) && rk.contains(&("LIMIT", "const", None)));
    assert_eq!(rk.iter().filter(|(n, k, _)| *n == "Index" && *k == "impl").count(), 2);

    let go = extract_symbols("go", &["type Server struct {", "}", "func (s *Server) Start() error {", "func New() *Server {"]);
    let gk: Vec<(&str, Option<&str>)> = go.iter().map(|s| (s.name.as_str(), s.container.as_deref())).collect();
    assert!(gk.contains(&("Start", Some("Server"))) && gk.contains(&("New", None)), "{gk:?}");

    let java = extract_symbols("java", &["public class Billing {", "    public int total(List<Item> items) {", "        return foo(items);", "    }", "    if (x) {"]);
    let jk: Vec<(&str, &str)> = java.iter().map(|s| (s.name.as_str(), s.kind)).collect();
    assert_eq!(jk, vec![("Billing", "class"), ("total", "method")]);

    let md = extract_symbols("md", &["# Guide", "text", "### Deep"]);
    assert_eq!(md.len(), 2);
    assert!(md[0].container.is_none() && md[1].container.is_some());
}

#[test]
fn gitignore_rules_apply_to_nested_paths() {
    let set: IgnoreSet = vec![Arc::new((String::new(), parse_gitignore("# c\nnode_modules\n/dist\nbuild/\n*.log\n!keep.log\ndocs/**/tmp\n")))];
    for (p, dir) in [("node_modules", true), ("a/node_modules", true), ("dist", true), ("build", true), ("x/error.log", false), ("docs/a/b/tmp", true)] {
        assert!(ignored(&set, p, dir), "{p} должен игнорироваться");
    }
    for (p, dir) in [("src/dist", true), ("src/build.rs", false), ("keep.log", false), ("buildings", true)] {
        assert!(!ignored(&set, p, dir), "{p} не должен игнорироваться");
    }
    // build/ — правило только для папок
    assert!(!ignored(&set, "build", false));
    // .gitignore вложенной папки действует только внутри неё
    let nested: IgnoreSet = vec![Arc::new(("pkg".to_string(), parse_gitignore("gen.ts\n")))];
    assert!(ignored(&nested, "pkg/gen.ts", false) && ignored(&nested, "pkg/a/gen.ts", false));
    assert!(!ignored(&nested, "other/gen.ts", false));
}

#[test]
fn indexes_only_safe_project_files() {
    let root = fixture("safe");
    let mut idx = Index::new(root);
    idx.refresh();
    let mut files: Vec<&str> = idx.files.keys().map(String::as_str).collect();
    files.sort();
    assert_eq!(files, vec!["docs/README.md", "server/handler.py", "src/auth/login.ts", "src/billing/invoice.ts", "src/utils/format.ts"]);
    // секреты из .env не находятся ни по значению, ни по имени (слово «token» есть и в обычном коде — это другой файл)
    assert!(idx.search("abc123", 5).is_empty());
    assert!(idx.search("SECRET_TOKEN", 10).iter().all(|h| !h.path.starts_with(".env")));
    assert!(idx.files.keys().all(|k| !k.contains(".env") && !k.ends_with(".log")));
    assert!(idx.search("hiddenThing nodeModulesThing distThing", 5).is_empty());
}

#[test]
fn ranks_files_by_meaning_of_names_and_paths() {
    let root = fixture("rank");
    let mut idx = Index::new(root);
    idx.refresh();
    let top = |q: &str| idx.search(q, 3).first().map(|h| h.path.clone()).unwrap_or_default();
    assert_eq!(top("authenticate user"), "src/auth/login.ts");
    assert_eq!(top("invoice total"), "src/billing/invoice.ts");
    assert_eq!(top("parse headers"), "server/handler.py");
    assert_eq!(top("format date"), "src/utils/format.ts");
    // путь файла тоже ищется, без слов из тела
    assert_eq!(top("billing"), "src/billing/invoice.ts");
    // слова вопроса не мешают
    assert_eq!(top("where is the code that does authenticate user"), "src/auth/login.ts");
    assert!(idx.search("zzzzqqq", 5).is_empty());
    let hit = &idx.search("session store create", 1)[0];
    assert!(hit.symbols.iter().any(|s| s == "SessionStore" || s == "create"), "{:?}", hit.symbols);
    assert!(hit.snippet.contains('|'));
}

#[test]
fn finds_symbols_exact_first() {
    let root = fixture("symbols");
    let mut idx = Index::new(root);
    idx.refresh();
    let names = |q: &str| idx.find_symbols(q, 10).into_iter().map(|h| h.name).collect::<Vec<_>>();
    assert_eq!(names("SessionStore")[0], "SessionStore");
    assert_eq!(names("calc"), vec!["calculateInvoiceTotal"]);
    assert!(names("invoice total").contains(&"calculateInvoiceTotal".to_string()));
    let h = &idx.find_symbols("create", 3)[0];
    assert_eq!((h.path.as_str(), h.container.as_deref(), h.line), ("src/auth/login.ts", Some("SessionStore"), 9));
    assert!(idx.find_symbols("", 5).is_empty());
}

#[test]
fn refresh_follows_edits_additions_and_deletions() {
    let root = fixture("refresh");
    let mut idx = Index::new(root.clone());
    idx.refresh();
    let chunks = idx.total_chunks;
    assert!(idx.search("refundPayment", 3).is_empty());

    fs::write(root.join("src/billing/refund.ts"), "export function refundPayment(id: string) {\n  return id;\n}\n").unwrap();
    // правка существующего файла: другой размер гарантирует, что она заметна и при грубом времени изменения
    fs::write(root.join("src/utils/format.ts"), "export const formatDate = (d: Date) => d.toISOString();\nexport const formatMoney = (n: number) => n.toFixed(2);\n").unwrap();
    idx.refresh();
    assert_eq!(idx.search("refund payment", 1)[0].path, "src/billing/refund.ts");
    assert_eq!(idx.find_symbols("formatMoney", 1)[0].path, "src/utils/format.ts");

    fs::remove_file(root.join("src/billing/refund.ts")).unwrap();
    idx.refresh();
    assert!(idx.search("refundPayment", 3).is_empty());
    // файл format.ts вырос, но остался одним фрагментом: общее число фрагментов вернулось к исходному
    assert_eq!(idx.total_chunks, chunks);
    // частоты терминов не «утекают»: после удаления файла его уникальный термин нигде не встречается
    let id = idx.dict["refundpayment"];
    assert_eq!(idx.df[id as usize], 0);
}

#[test]
fn project_map_lists_definitions_and_respects_budget() {
    let root = fixture("map");
    let mut idx = Index::new(root);
    idx.refresh();
    let map = idx.project_map("", 6000);
    assert!(map.contains("src/auth/login.ts: authenticateUser, SessionStore{create,destroy}"), "{map}");
    assert!(map.contains("server/handler.py: RequestHandler{handle,parse_headers}"), "{map}");
    let zoom = idx.project_map("src/billing", 6000);
    assert!(zoom.contains("calculateInvoiceTotal") && !zoom.contains("login.ts"), "{zoom}");
    assert!(idx.project_map("nope", 6000).contains("нет файлов"));
    let tiny = idx.project_map("", 90);
    assert!(tiny.contains("не поместились"), "{tiny}");
    assert!(tiny.len() < 700);
    // «наверх» из корня невозможно: путь — лишь фильтр по уже проиндексированным
    assert!(idx.project_map("../..", 6000).contains("нет файлов"));
}

#[test]
fn skips_binary_minified_and_oversized_files() {
    let big = "x".repeat(500 * 1024);
    let minified = format!("var a=1;{}", "b=2;".repeat(400));
    let root = project("skip", &[
        ("ok.ts", "export function fine() {}\n"),
        ("big.ts", &big),
        ("min.ts", &minified),
        ("pic.png", "not code"),
        ("data.bin", "x"),
    ]);
    fs::write(root.join("nul.ts"), b"export const a = 1;\0\0").unwrap();
    let mut idx = Index::new(root);
    idx.refresh();
    let files: Vec<&str> = idx.files.keys().map(String::as_str).collect();
    assert_eq!(files, vec!["ok.ts"]);
}

#[test]
fn translations_and_docs_do_not_outrank_real_code() {
    let root = project("prior", &[
        ("src/i18n/translations.ts", "export const en = { saveFile: 'Save file', closeTab: 'Close tab', saveFileAs: 'Save file as', fileSaved: 'File saved' };
"),
        ("src/editor/save.ts", "export function saveFile(path: string) {
  return path;
}
"),
        ("docs/notes.md", "# Save file

save file save file
"),
    ]);
    let mut idx = Index::new(root);
    idx.refresh();
    let order: Vec<String> = idx.search("save file", 3).into_iter().map(|h| h.path).collect();
    assert_eq!(order[0], "src/editor/save.ts", "{order:?}");
    // но если кода по теме нет, документация всё равно находится
    assert_eq!(idx.search("notes", 3)[0].path, "docs/notes.md");
    assert!((file_prior("src/i18n/translations.ts", "js") - 0.5).abs() < 1e-6);
    assert!((file_prior("README.md", "md") - 0.8).abs() < 1e-6);
    assert!((file_prior("src/a.ts", "js") - 1.0).abs() < 1e-6);
}

#[test]
fn hit_symbols_start_with_the_ones_matching_the_query() {
    let root = project("hitsyms", &[(
        "src/a.ts",
        "export function alpha() {}
export function beta() {}
export function parseConfigFile() {}
export function gamma() {}
",
    )]);
    let mut idx = Index::new(root);
    idx.refresh();
    let hit = &idx.search("parse config", 1)[0];
    assert_eq!(hit.symbols[0], "parseConfigFile", "{:?}", hit.symbols);
}

#[test]
fn big_project_gets_a_folder_overview_and_zooming_in_gives_files() {
    // 6 папок по 12 файлов + 3 глубже: плоский список не влезает в маленький бюджет
    let mut files: Vec<(String, String)> = Vec::new();
    for dir in ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"] {
        for i in 0..12 {
            files.push((format!("src/{dir}/mod{i}.ts"), format!("export function {dir}Handler{i}() {{}}\nexport class {dir}Service{i} {{}}\n")));
        }
    }
    for i in 0..30 {
        files.push((format!("src/deep/inner/part{i}.ts"), format!("export function deepThing{i}() {{}}\n")));
    }
    let refs: Vec<(&str, &str)> = files.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    let root = project("overview", &refs);
    let mut idx = Index::new(root);
    idx.refresh();

    let map = idx.project_map("", 900);
    assert!(map.contains("обзор по папкам"), "{map}");
    assert!(map.contains("src/alpha/ (12 файлов)") && map.contains("src/deep/inner/ (30 файлов)"), "{map}");
    assert!(map.contains("project_map с path"), "{map}");
    assert!(!map.contains("alphaHandler0:"), "в обзоре нет построчного списка файлов");
    assert!(map.len() < 2500, "{}", map.len());

    // раскрыв папку, получаем файлы и определения
    let zoom = idx.project_map("src/alpha", 6000);
    assert!(zoom.contains("src/alpha/mod0.ts: alphaHandler0, alphaService0"), "{zoom}");
    assert!(!zoom.contains("обзор по папкам"));
    // небольшой проект по-прежнему показывается плоским списком (см. project_map_lists_definitions_and_respects_budget)
}

#[test]
fn tiny_names_say_nothing_about_a_file() {
    let root = project("weights", &[("a.js", "const T = 1;\nfunction $() {}\nfunction $$() {}\nexport function renderInvoice() {}\n"), ("b.js", "T; $; $$; renderInvoice();\n")]);
    let mut idx = Index::new(root);
    idx.refresh();
    for tiny in ["T", "$", "$$", "id", "abc"] {
        assert_eq!(idx.symbol_weight(tiny), 0, "{tiny}");
    }
    assert!(idx.symbol_weight("renderInvoice") > 3);
}
