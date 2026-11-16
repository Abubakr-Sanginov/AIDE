// Collects the deployable site into dist/ for Vercel (outputDirectory = "dist").
// Only published assets are copied: sources (src/, scripts/), package files and node_modules stay out.
// Run after `npm run build` — that is what `npm run build:vercel` does.
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const DIST = new URL("dist/", ROOT);
const LANGS = ["en", "de", "fr", "es", "pt", "it", "zh", "ja", "ko", "tg"];
// Russian pages live in the root (index.html, docs/, changelog/, terms/, privacy/); every other language in its own folder.
const DIRS = ["js", "fonts", "img", "downloads", "docs", "changelog", "terms", "privacy", ...LANGS];
const FILES = ["index.html", "styles.css", "favicon.ico", "site.webmanifest", "sitemap.xml", "robots.txt"];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

for (const name of DIRS) {
  const from = new URL(name, ROOT);
  if (!existsSync(from)) { console.log(`collect-dist: skip ${name} (missing)`); continue; }
  cpSync(from, new URL(name, DIST), { recursive: true });
  console.log(`collect-dist: ${name}/`);
}
for (const name of FILES) {
  const from = new URL(name, ROOT);
  if (!existsSync(from)) continue;
  copyFileSync(from, new URL(name, DIST));
  console.log(`collect-dist: ${name}`);
}
// Stable download link: /downloads/AIDE-latest-x64-setup.exe always points at the newest installer
// in downloads/, so a new version only needs the file dropped in — the button href never changes.
const dlDir = new URL("downloads/", ROOT);
if (existsSync(dlDir)) {
  const newest = readdirSync(dlDir)
    .filter((f) => /^AIDE_.*_x64-setup\.exe$/.test(f))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .pop();
  if (newest) {
    copyFileSync(new URL(`downloads/${newest}`, ROOT), new URL("downloads/AIDE-latest-x64-setup.exe", DIST));
    console.log(`collect-dist: downloads/AIDE-latest-x64-setup.exe -> ${newest}`);
  } else {
    console.log("collect-dist: no versioned installer in downloads/");
  }
}

console.log("collect-dist: dist/ is ready");
