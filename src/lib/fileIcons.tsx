import {
  FileCode,
  FileText,
  Braces,
  Paintbrush,
  Globe,
  Terminal,
  Database,
  GitBranch,
  Settings,
  Image,
  File,
  FileType,
  Hash,
  Shield,
  Cpu,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

interface FileIconInfo {
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number; className?: string }>;
  color: string;
}

const EXT_MAP: Record<string, FileIconInfo> = {
  // TypeScript
  ts: { icon: FileCode, color: "text-[#4f93e0]" },
  tsx: { icon: FileCode, color: "text-[#4f93e0]" },
  // JavaScript
  js: { icon: FileCode, color: "text-[#e2b94b]" },
  jsx: { icon: FileCode, color: "text-[#e2b94b]" },
  mjs: { icon: FileCode, color: "text-[#e2b94b]" },
  cjs: { icon: FileCode, color: "text-[#e2b94b]" },
  // React / Vue
  vue: { icon: FileCode, color: "text-[#5fa04e]" },
  svelte: { icon: FileCode, color: "text-[#e8683d]" },
  // Styles
  css: { icon: Paintbrush, color: "text-[#5b9bd5]" },
  scss: { icon: Paintbrush, color: "text-[#d46a9a]" },
  less: { icon: Paintbrush, color: "text-[#5b9bd5]" },
  // Markup
  html: { icon: Globe, color: "text-[#e8683d]" },
  htm: { icon: Globe, color: "text-[#e8683d]" },
  xml: { icon: Globe, color: "text-[#e8683d]" },
  svg: { icon: Image, color: "text-[#a87ffb]" },
  // Markdown
  md: { icon: FileText, color: "text-[#5b9bd5]" },
  mdx: { icon: FileText, color: "text-[#5b9bd5]" },
  // Data
  json: { icon: Braces, color: "text-[#3178c6]" },
  jsonc: { icon: Braces, color: "text-[#3178c6]" },
  json5: { icon: Braces, color: "text-[#3178c6]" },
  yaml: { icon: FileCode, color: "text-[#d46a9a]" },
  yml: { icon: FileCode, color: "text-[#d46a9a]" },
  toml: { icon: FileCode, color: "text-ink-400" },
  csv: { icon: FileText, color: "text-[#5fa04e]" },
  tsv: { icon: FileText, color: "text-[#5fa04e]" },
  // Languages
  py: { icon: FileCode, color: "text-[#5fa04e]" },
  pyw: { icon: FileCode, color: "text-[#5fa04e]" },
  rs: { icon: Shield, color: "text-[#e8683d]" },
  go: { icon: Cpu, color: "text-cyan-400" },
  java: { icon: FileCode, color: "text-red-400" },
  kt: { icon: FileCode, color: "text-[#a87ffb]" },
  swift: { icon: FileCode, color: "text-[#e8683d]" },
  c: { icon: FileCode, color: "text-[#5b9bd5]" },
  cpp: { icon: FileCode, color: "text-[#5b9bd5]" },
  cc: { icon: FileCode, color: "text-[#5b9bd5]" },
  h: { icon: FileCode, color: "text-[#5b9bd5]" },
  hpp: { icon: FileCode, color: "text-[#5b9bd5]" },
  cs: { icon: FileCode, color: "text-green-300" },
  php: { icon: FileCode, color: "text-brand-400" },
  rb: { icon: FileCode, color: "text-red-300" },
  lua: { icon: FileCode, color: "text-[#4f93e0]" },
  r: { icon: FileCode, color: "text-[#4f93e0]" },
  R: { icon: FileCode, color: "text-[#4f93e0]" },
  dart: { icon: FileCode, color: "text-cyan-300" },
  elixir: { icon: FileCode, color: "text-purple-300" },
  ex: { icon: FileCode, color: "text-purple-300" },
  exs: { icon: FileCode, color: "text-purple-300" },
  // Shell
  sh: { icon: Terminal, color: "text-green-300" },
  bash: { icon: Terminal, color: "text-green-300" },
  zsh: { icon: Terminal, color: "text-green-300" },
  fish: { icon: Terminal, color: "text-green-300" },
  ps1: { icon: Terminal, color: "text-[#5b9bd5]" },
  bat: { icon: Terminal, color: "text-ink-300" },
  cmd: { icon: Terminal, color: "text-ink-300" },
  // SQL
  sql: { icon: Database, color: "text-sky-300" },
  // Config / dotfiles
  env: { icon: Settings, color: "text-[#3178c6]" },
  gitignore: { icon: GitBranch, color: "text-[#e8683d]" },
  gitattributes: { icon: GitBranch, color: "text-[#e8683d]" },
  editorconfig: { icon: Settings, color: "text-ink-400" },
  prettierrc: { icon: Settings, color: "text-pink-300" },
  eslintrc: { icon: Settings, color: "text-purple-300" },
  dockerfile: { icon: FileCode, color: "text-cyan-400" },
  dockerignore: { icon: FileCode, color: "text-cyan-300" },
  makefile: { icon: FileCode, color: "text-ink-300" },
  cmake: { icon: FileCode, color: "text-ink-300" },
  lock: { icon: Hash, color: "text-ink-500" },
  // Images
  png: { icon: Image, color: "text-[#a87ffb]" },
  jpg: { icon: Image, color: "text-[#a87ffb]" },
  jpeg: { icon: Image, color: "text-[#a87ffb]" },
  gif: { icon: Image, color: "text-[#a87ffb]" },
  webp: { icon: Image, color: "text-[#a87ffb]" },
  ico: { icon: Image, color: "text-[#a87ffb]" },
  bmp: { icon: Image, color: "text-[#a87ffb]" },
  // Other
  txt: { icon: FileText, color: "text-ink-400" },
  log: { icon: FileText, color: "text-ink-500" },
  pdf: { icon: FileType, color: "text-red-400" },
  zip: { icon: File, color: "text-[#3178c6]" },
  tar: { icon: File, color: "text-[#3178c6]" },
  gz: { icon: File, color: "text-[#3178c6]" },
};

const NAME_MAP: Record<string, FileIconInfo> = {
  "package.json": { icon: Braces, color: "text-[#5fa04e]" },
  "tsconfig.json": { icon: Braces, color: "text-[#4f93e0]" },
  "package-lock.json": { icon: Lock, color: "text-ink-500" },
  "yarn.lock": { icon: Lock, color: "text-[#4f93e0]" },
  "pnpm-lock.yaml": { icon: Lock, color: "text-[#e2b94b]" },
  "Cargo.toml": { icon: Shield, color: "text-[#e8683d]" },
  "Cargo.lock": { icon: Lock, color: "text-[#e8683d]" },
  "go.mod": { icon: Cpu, color: "text-cyan-400" },
  "go.sum": { icon: Lock, color: "text-cyan-300" },
  "Dockerfile": { icon: FileCode, color: "text-cyan-400" },
  "docker-compose.yml": { icon: FileCode, color: "text-cyan-300" },
  ".gitignore": { icon: GitBranch, color: "text-[#e8683d]" },
  ".env": { icon: Settings, color: "text-[#3178c6]" },
  ".env.local": { icon: Settings, color: "text-[#3178c6]" },
  "README.md": { icon: FileText, color: "text-[#5b9bd5]" },
  "LICENSE": { icon: Shield, color: "text-ink-400" },
  "Makefile": { icon: FileCode, color: "text-ink-300" },
};

function Lock({ size = 24, className, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

export function getFileIcon(filename: string): FileIconInfo {
  const name = filename.split("/").pop() ?? filename;
  const byName = NAME_MAP[name];
  if (byName) return byName;

  // Handle dotfiles like .env, .gitignore
  if (name.startsWith(".")) {
    const withoutDot = name.slice(1);
    const byDot = NAME_MAP[name] ?? EXT_MAP[withoutDot];
    if (byDot) return byDot;
  }

  const dotIdx = name.lastIndexOf(".");
  if (dotIdx > 0) {
    const ext = name.slice(dotIdx + 1).toLowerCase();
    const byExt = EXT_MAP[ext];
    if (byExt) return byExt;
  }

  return { icon: FileText, color: "text-ink-500" };
}
