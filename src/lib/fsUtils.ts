const LANGUAGES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  jsx: "JSX",
  mjs: "JavaScript",
  json: "JSON",
  md: "Markdown",
  rs: "Rust",
  py: "Python",
  css: "CSS",
  html: "HTML",
  htm: "HTML",
  toml: "TOML",
  yaml: "YAML",
  yml: "YAML",
  xml: "XML",
  sh: "Shell",
  bat: "Batch",
  ps1: "PowerShell",
  go: "Go",
  java: "Java",
  c: "C",
  h: "C",
  cpp: "C++",
  hpp: "C++",
  cs: "C#",
  txt: "Plain Text",
};

export function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGES[ext] ?? (ext ? ext.toUpperCase() : "Plain Text");
}

export type MediaKind = "image" | "video" | "audio" | "pdf";

const MEDIA: Record<string, MediaKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image", ico: "image", avif: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video", ogv: "video",
  mp3: "audio", wav: "audio", ogg: "audio", oga: "audio", m4a: "audio", aac: "audio", flac: "audio", opus: "audio",
  pdf: "pdf",
};

/** What a file is shown as when it is not text: photo, video, sound or PDF (undefined = a text file). */
export function mediaKindOf(path: string): MediaKind | undefined {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return path.includes(".") ? MEDIA[ext] : undefined;
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function dirname(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx > 0 ? path.slice(0, idx) : path;
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith("\\") || dir.endsWith("/") ? dir + name : dir + "\\" + name;
}
