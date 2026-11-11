import type { Extension } from "@codemirror/state";
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { go } from "@codemirror/lang-go";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";
import { sql } from "@codemirror/lang-sql";
import { php } from "@codemirror/lang-php";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { csharp, kotlin, scala, dart, objectiveC, shader } from "@codemirror/legacy-modes/mode/clike";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { r } from "@codemirror/legacy-modes/mode/r";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { stylus } from "@codemirror/legacy-modes/mode/stylus";
import { sass } from "@codemirror/legacy-modes/mode/sass";
import { pug } from "@codemirror/legacy-modes/mode/pug";
import { coffeeScript } from "@codemirror/legacy-modes/mode/coffeescript";
import { elm } from "@codemirror/legacy-modes/mode/elm";
import { fortran } from "@codemirror/legacy-modes/mode/fortran";
import { pascal } from "@codemirror/legacy-modes/mode/pascal";
import { tcl } from "@codemirror/legacy-modes/mode/tcl";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { verilog } from "@codemirror/legacy-modes/mode/verilog";
import { vhdl } from "@codemirror/legacy-modes/mode/vhdl";
import { commonLisp } from "@codemirror/legacy-modes/mode/commonlisp";
import { scheme } from "@codemirror/legacy-modes/mode/scheme";
import { oCaml, fSharp } from "@codemirror/legacy-modes/mode/mllike";
import { octave } from "@codemirror/legacy-modes/mode/octave";
import { http } from "@codemirror/legacy-modes/mode/http";
import { jinja2 } from "@codemirror/legacy-modes/mode/jinja2";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { d } from "@codemirror/legacy-modes/mode/d";
import { crystal } from "@codemirror/legacy-modes/mode/crystal";
import { haxe } from "@codemirror/legacy-modes/mode/haxe";
import { gas } from "@codemirror/legacy-modes/mode/gas";
import { cobol } from "@codemirror/legacy-modes/mode/cobol";
import { sparql } from "@codemirror/legacy-modes/mode/sparql";
import { vbScript } from "@codemirror/legacy-modes/mode/vbscript";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const legacy = (parser: StreamParser<any>) => () => StreamLanguage.define(parser);

const htmlLike = () => html();
const jsonLike = () => json();
const shLike = legacy(shell);
const propsLike = legacy(properties);
const cLike = () => cpp();

/** Extension (lowercase, without the dot) → language. */
const EXT_LANGUAGES: Record<string, () => Extension> = {
  // web
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),
  json: jsonLike,
  jsonc: jsonLike,
  json5: jsonLike,
  map: jsonLike,
  webmanifest: jsonLike,
  ipynb: jsonLike,
  html: htmlLike,
  htm: htmlLike,
  xhtml: htmlLike,
  vue: htmlLike,
  svelte: htmlLike,
  astro: htmlLike,
  ejs: htmlLike,
  hbs: htmlLike,
  css: () => css(),
  scss: legacy(sass),
  sass: legacy(sass),
  less: () => css(),
  styl: legacy(stylus),
  pug: legacy(pug),
  jade: legacy(pug),
  coffee: legacy(coffeeScript),
  md: () => markdown(),
  markdown: () => markdown(),
  mdx: () => markdown(),
  svg: () => xml(),
  xml: () => xml(),
  xsd: () => xml(),
  xsl: () => xml(),
  xslt: () => xml(),
  plist: () => xml(),
  csproj: () => xml(),
  vcxproj: () => xml(),
  resx: () => xml(),
  xaml: () => xml(),
  rss: () => xml(),
  atom: () => xml(),
  yaml: () => yaml(),
  yml: () => yaml(),
  toml: legacy(toml),
  ini: propsLike,
  cfg: propsLike,
  conf: propsLike,
  properties: propsLike,
  env: propsLike,
  editorconfig: propsLike,
  gitconfig: propsLike,
  desktop: propsLike,
  http: legacy(http),
  rest: legacy(http),
  // systems / compiled
  rs: () => rust(),
  go: () => go(),
  java: () => java(),
  c: cLike,
  h: cLike,
  cc: cLike,
  cpp: cLike,
  cxx: cLike,
  hpp: cLike,
  hh: cLike,
  hxx: cLike,
  ino: cLike,
  cu: cLike,
  cs: legacy(csharp),
  csx: legacy(csharp),
  kt: legacy(kotlin),
  kts: legacy(kotlin),
  scala: legacy(scala),
  sc: legacy(scala),
  dart: legacy(dart),
  swift: legacy(swift),
  m: legacy(objectiveC),
  mm: legacy(objectiveC),
  glsl: legacy(shader),
  vert: legacy(shader),
  frag: legacy(shader),
  hlsl: legacy(shader),
  shader: legacy(shader),
  d: legacy(d),
  cr: legacy(crystal),
  hx: legacy(haxe),
  groovy: legacy(groovy),
  gradle: legacy(groovy),
  s: legacy(gas),
  asm: legacy(gas),
  f: legacy(fortran),
  f90: legacy(fortran),
  f95: legacy(fortran),
  for: legacy(fortran),
  pas: legacy(pascal),
  pp: legacy(pascal),
  dpr: legacy(pascal),
  cob: legacy(cobol),
  cbl: legacy(cobol),
  v: legacy(verilog),
  sv: legacy(verilog),
  vh: legacy(verilog),
  vhd: legacy(vhdl),
  vhdl: legacy(vhdl),
  proto: legacy(protobuf),
  // scripting
  py: () => python(),
  pyw: () => python(),
  pyi: () => python(),
  rb: legacy(ruby),
  rake: legacy(ruby),
  gemspec: legacy(ruby),
  erb: htmlLike,
  pl: legacy(perl),
  pm: legacy(perl),
  t: legacy(perl),
  php: () => php(),
  phtml: () => php(),
  lua: legacy(lua),
  r: legacy(r),
  jl: legacy(julia),
  tcl: legacy(tcl),
  vb: legacy(vb),
  bas: legacy(vb),
  vbs: legacy(vbScript),
  sh: shLike,
  bash: shLike,
  zsh: shLike,
  fish: shLike,
  ksh: shLike,
  bat: shLike,
  cmd: shLike,
  ps1: legacy(powerShell),
  psm1: legacy(powerShell),
  psd1: legacy(powerShell),
  // functional
  hs: legacy(haskell),
  lhs: legacy(haskell),
  clj: legacy(clojure),
  cljs: legacy(clojure),
  cljc: legacy(clojure),
  edn: legacy(clojure),
  erl: legacy(erlang),
  hrl: legacy(erlang),
  ml: legacy(oCaml),
  mli: legacy(oCaml),
  fs: legacy(fSharp),
  fsx: legacy(fSharp),
  fsi: legacy(fSharp),
  elm: legacy(elm),
  lisp: legacy(commonLisp),
  cl: legacy(commonLisp),
  el: legacy(commonLisp),
  scm: legacy(scheme),
  ss: legacy(scheme),
  rkt: legacy(scheme),
  // data / docs / misc
  sql: () => sql(),
  psql: () => sql(),
  sparql: legacy(sparql),
  rq: legacy(sparql),
  tex: legacy(stex),
  sty: legacy(stex),
  cls: legacy(stex),
  jinja: legacy(jinja2),
  jinja2: legacy(jinja2),
  j2: legacy(jinja2),
  twig: legacy(jinja2),
  diff: legacy(diff),
  patch: legacy(diff),
  cmake: legacy(cmake),
  nginx: legacy(nginx),
  dockerfile: legacy(dockerFile),
  octave: legacy(octave),
};

/** Whole file names (lowercase) that have no useful extension. */
const NAME_LANGUAGES: Record<string, () => Extension> = {
  dockerfile: legacy(dockerFile),
  containerfile: legacy(dockerFile),
  makefile: shLike,
  gnumakefile: shLike,
  "cmakelists.txt": legacy(cmake),
  "nginx.conf": legacy(nginx),
  gemfile: legacy(ruby),
  rakefile: legacy(ruby),
  podfile: legacy(ruby),
  vagrantfile: legacy(ruby),
  brewfile: legacy(ruby),
  jenkinsfile: legacy(groovy),
  ".gitignore": shLike,
  ".gitattributes": shLike,
  ".dockerignore": shLike,
  ".npmignore": shLike,
  ".bashrc": shLike,
  ".zshrc": shLike,
  ".profile": shLike,
  ".bash_profile": shLike,
  ".npmrc": propsLike,
  ".prettierrc": jsonLike,
  ".eslintrc": jsonLike,
  ".babelrc": jsonLike,
  "tsconfig.json": jsonLike,
  "license": () => [],
};

export function languageForPath(path: string): Extension {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const byName = NAME_LANGUAGES[name];
  if (byName) return byName();
  // ".env", ".env.local", ".env.production": configuration
  if (name === ".env" || name.startsWith(".env.")) return propsLike();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1) : "";
  // "foo.d.ts", "app.test.tsx" etc. fall through to the last extension.
  return EXT_LANGUAGES[ext]?.() ?? [];
}
