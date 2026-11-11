'use strict';
// The `vscode` module for extensions running in AIDE's extension host.
// It implements the commonly used part of the VS Code API on top of a tiny RPC to the app.
// Anything not implemented is a harmless stub (logged once) so extensions keep loading.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

/* ───────────────────────── basic value types ───────────────────────── */

class Disposable {
  constructor(fn) { this._fn = fn; }
  dispose() { const f = this._fn; this._fn = null; if (f) f(); }
  static from(...items) { return new Disposable(() => items.forEach((i) => i && i.dispose && i.dispose())); }
}

class EventEmitter {
  constructor() { this._l = new Set(); this.event = (listener, thisArg, disposables) => {
    const fn = thisArg ? listener.bind(thisArg) : listener;
    this._l.add(fn);
    const d = new Disposable(() => this._l.delete(fn));
    if (disposables) disposables.push(d);
    return d;
  }; }
  fire(data) { for (const l of [...this._l]) { try { l(data); } catch (e) { reportError('event listener', e); } } }
  dispose() { this._l.clear(); }
}

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
  isAfter(o) { return !this.isBeforeOrEqual(o); }
  isAfterOrEqual(o) { return !this.isBefore(o); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  compareTo(o) { return this.line - o.line || this.character - o.character; }
  translate(a, b) { if (typeof a === 'object') return new Position(this.line + (a.lineDelta || 0), this.character + (a.characterDelta || 0)); return new Position(this.line + (a || 0), this.character + (b || 0)); }
  with(a, b) { if (typeof a === 'object') return new Position(a.line ?? this.line, a.character ?? this.character); return new Position(a ?? this.line, b ?? this.character); }
}

class Range {
  constructor(a, b, c, d) {
    if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); }
    else if (a.isAfter(b)) { this.start = b; this.end = a; } else { this.start = a; this.end = b; }
  }
  get isEmpty() { return this.start.isEqual(this.end); }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(x) { if (x instanceof Range) return this.contains(x.start) && this.contains(x.end); return x.isAfterOrEqual(this.start) && x.isBeforeOrEqual(this.end); }
  isEqual(o) { return this.start.isEqual(o.start) && this.end.isEqual(o.end); }
  intersection(o) { const s = this.start.isAfter(o.start) ? this.start : o.start; const e = this.end.isBefore(o.end) ? this.end : o.end; return s.isAfter(e) ? undefined : new Range(s, e); }
  union(o) { return new Range(this.start.isBefore(o.start) ? this.start : o.start, this.end.isAfter(o.end) ? this.end : o.end); }
  with(a, b) { if (a && a.start !== undefined && !(a instanceof Position)) return new Range(a.start ?? this.start, a.end ?? this.end); return new Range(a ?? this.start, b ?? this.end); }
}

class Selection extends Range {
  constructor(a, b, c, d) {
    super(a, b, c, d);
    if (typeof a === 'number') { this.anchor = new Position(a, b); this.active = new Position(c, d); }
    else { this.anchor = a; this.active = b; }
  }
  get isReversed() { return this.anchor.isAfter(this.active); }
}

class Uri {
  constructor(scheme, authority, p, query, fragment) { this.scheme = scheme; this.authority = authority || ''; this.path = p || ''; this.query = query || ''; this.fragment = fragment || ''; }
  static file(p) {
    let s = String(p).replace(/\\/g, '/');
    if (!s.startsWith('/')) s = '/' + s;
    return new Uri('file', '', s, '', '');
  }
  static parse(value) {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(String(value));
    if (!m) return Uri.file(value);
    return new Uri(m[1], m[2] || '', decodeURIComponent(m[3] || ''), m[4] || '', m[5] || '');
  }
  static joinPath(base, ...parts) { return base.with({ path: path.posix.join(base.path, ...parts) }); }
  static from(c) { return new Uri(c.scheme, c.authority, c.path, c.query, c.fragment); }
  get fsPath() {
    if (this.scheme !== 'file') return this.path;
    let p = decodeURIComponent(this.path);
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    return process.platform === 'win32' ? p.replace(/\//g, '\\') : p;
  }
  with(c) { return new Uri(c.scheme ?? this.scheme, c.authority ?? this.authority, c.path ?? this.path, c.query ?? this.query, c.fragment ?? this.fragment); }
  toString() {
    const enc = (s) => encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');
    let p = this.path;
    if (this.scheme === 'file' && /^\/[a-zA-Z]:/.test(p)) p = '/' + p[1].toLowerCase() + '%3A' + p.slice(3);
    return `${this.scheme}://${this.authority}${enc(p)}${this.query ? '?' + this.query : ''}${this.fragment ? '#' + this.fragment : ''}`;
  }
  toJSON() { return { scheme: this.scheme, authority: this.authority, path: this.path, query: this.query, fragment: this.fragment, fsPath: this.fsPath }; }
}

class TextEdit {
  constructor(range, newText) { this.range = range; this.newText = newText; }
  static replace(r, t) { return new TextEdit(r, t); }
  static insert(p, t) { return new TextEdit(new Range(p, p), t); }
  static delete(r) { return new TextEdit(r, ''); }
  static setEndOfLine() { return new TextEdit(new Range(0, 0, 0, 0), ''); }
}

class WorkspaceEdit {
  constructor() { this._edits = new Map(); }
  _list(uri) { const k = uri.fsPath; if (!this._edits.has(k)) this._edits.set(k, { uri, edits: [] }); return this._edits.get(k).edits; }
  replace(uri, range, text) { this._list(uri).push(new TextEdit(range, text)); }
  insert(uri, pos, text) { this._list(uri).push(TextEdit.insert(pos, text)); }
  delete(uri, range) { this._list(uri).push(TextEdit.delete(range)); }
  set(uri, edits) { this._list(uri).push(...edits); }
  has(uri) { return this._edits.has(uri.fsPath); }
  get size() { return this._edits.size; }
  entries() { return [...this._edits.values()].map((e) => [e.uri, e.edits]); }
}

class MarkdownString {
  constructor(value = '', supportThemeIcons = false) { this.value = value; this.isTrusted = false; this.supportThemeIcons = supportThemeIcons; }
  appendText(v) { this.value += String(v).replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&'); return this; }
  appendMarkdown(v) { this.value += v; return this; }
  appendCodeblock(code, lang = '') { this.value += '\n```' + lang + '\n' + code + '\n```\n'; return this; }
}
class SnippetString {
  constructor(value = '') { this.value = value; }
  appendText(v) { this.value += String(v).replace(/[$}\\]/g, '\\$&'); return this; }
  appendTabstop(n = 1) { this.value += '$' + n; return this; }
  appendPlaceholder(v, n = 1) { this.value += '${' + n + ':' + (typeof v === 'function' ? '' : v) + '}'; return this; }
}
class ThemeColor { constructor(id) { this.id = id; } }
class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } }

class Diagnostic {
  constructor(range, message, severity = 0) { this.range = range; this.message = message; this.severity = severity; }
}
class Location { constructor(uri, r) { this.uri = uri; this.range = r; } }
class CompletionItem { constructor(label, kind) { this.label = label; this.kind = kind; } }
class CompletionList { constructor(items = [], isIncomplete = false) { this.items = items; this.isIncomplete = isIncomplete; } }
class Hover { constructor(contents, range) { this.contents = Array.isArray(contents) ? contents : [contents]; this.range = range; } }
class CodeAction { constructor(title, kind) { this.title = title; this.kind = kind; } }
class CodeActionKind {
  constructor(value) { this.value = value; }
  append(p) { return new CodeActionKind(this.value + '.' + p); }
  contains(o) { return o.value === this.value || o.value.startsWith(this.value + '.'); }
  intersects(o) { return this.contains(o) || o.contains(this); }
}
CodeActionKind.Empty = new CodeActionKind('');
CodeActionKind.QuickFix = new CodeActionKind('quickfix');
CodeActionKind.Refactor = new CodeActionKind('refactor');
CodeActionKind.Source = new CodeActionKind('source');
CodeActionKind.SourceOrganizeImports = new CodeActionKind('source.organizeImports');
CodeActionKind.SourceFixAll = new CodeActionKind('source.fixAll');

class CancellationTokenSource {
  constructor() { this._e = new EventEmitter(); this.token = { isCancellationRequested: false, onCancellationRequested: this._e.event }; }
  cancel() { if (!this.token.isCancellationRequested) { this.token.isCancellationRequested = true; this._e.fire(); } }
  dispose() { this._e.dispose(); }
}

class RelativePattern {
  constructor(base, pattern) { this.base = typeof base === 'string' ? base : (base.uri ? base.uri.fsPath : base.fsPath); this.pattern = pattern; }
}

const E = (names, start = 0) => Object.fromEntries(names.flatMap((n, i) => [[n, i + start], [i + start, n]]));
const DiagnosticSeverity = E(['Error', 'Warning', 'Information', 'Hint']);
const CompletionItemKind = E(['Text', 'Method', 'Function', 'Constructor', 'Field', 'Variable', 'Class', 'Interface', 'Module', 'Property', 'Unit', 'Value', 'Enum', 'Keyword', 'Snippet', 'Color', 'File', 'Reference', 'Folder', 'EnumMember', 'Constant', 'Struct', 'Event', 'Operator', 'TypeParameter']);
const SymbolKind = E(['File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property', 'Field', 'Constructor', 'Enum', 'Interface', 'Function', 'Variable', 'Constant', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Key', 'Null', 'EnumMember', 'Struct', 'Event', 'Operator', 'TypeParameter']);
const StatusBarAlignment = { Left: 1, Right: 2 };
const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
const EndOfLine = { LF: 1, CRLF: 2 };
const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
const TextEditorRevealType = { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 };
const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 };
const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };
const ExtensionMode = { Production: 1, Development: 2, Test: 3 };
const UIKind = { Desktop: 1, Web: 2 };
const CompletionTriggerKind = { Invoke: 0, TriggerCharacter: 1, TriggerForIncompleteCompletions: 2 };
const DiagnosticTag = { Unnecessary: 1, Deprecated: 2 };
const TextDocumentSaveReason = { Manual: 1, AfterDelay: 2, FocusOut: 3 };
const DecorationRangeBehavior = { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 };
const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 };

/* ───────────────────────── helpers ───────────────────────── */

let rpcRef = null;
const warned = new Set();
function reportError(where, e) { if (rpcRef) rpcRef.notify('log', { level: 'error', message: `${where}: ${e && e.stack ? e.stack : e}` }); }
function unsupported(name) {
  if (!warned.has(name)) { warned.add(name); if (rpcRef) rpcRef.notify('log', { level: 'warn', message: `Unsupported API used: ${name}` }); }
}

/** A callable/chainable stand-in for APIs that have no UI in AIDE (never throws). */
function makeStub(name) {
  const target = function () { return makeStub(name + '()'); };
  const bag = Object.create(null); // properties an extension assigns to the stub (e.g. item.name = 'x')
  return new Proxy(target, {
    set(_t, prop, value) { bag[prop] = value; return true; },
    has(_t, prop) { return prop in bag; },
    get(_t, prop) {
      if (prop in bag) return bag[prop];
      if (prop === 'then') return undefined;
      if (prop === 'dispose') return () => {};
      if (prop === Symbol.toPrimitive) return () => '';
      if (typeof prop === 'symbol') return undefined;
      if (/^on[A-Z]/.test(prop)) return () => new Disposable(() => {});
      return makeStub(name + '.' + String(prop));
    },
    apply() { unsupported(name); return makeStub(name + '()'); },
  });
}

/** Missing members of a namespace become stubs instead of `undefined` (extensions rarely check). */
function withStubs(ns, name) {
  return new Proxy(ns, {
    get(target, prop, receiver) {
      if (prop in target || typeof prop === 'symbol' || prop === 'then') return Reflect.get(target, prop, receiver);
      if (/^on[A-Z]/.test(String(prop))) return () => new Disposable(() => {});
      return makeStub(`${name}.${String(prop)}`);
    },
  });
}

function globToRegExp(glob) {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i += 2; if (glob[i] === '/') i++; continue; }
      re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { re += '(?:'; }
    else if (c === '}') re += ')';
    else if (c === ',') re += /\{[^}]*$/.test(glob.slice(0, i)) ? '|' : ',';
    else if ('.+^$()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
    i++;
  }
  return new RegExp('^' + re + '$', 'i');
}

const toPosix = (p) => String(p).replace(/\\/g, '/');

/* ───────────────────────── documents ───────────────────────── */

class TextDocumentImpl {
  constructor(p, languageId, version, text) {
    this.uri = Uri.file(p); this.fileName = p; this.languageId = languageId; this.version = version;
    this.isUntitled = false; this.isClosed = false; this.isDirty = false; this.eol = /\r\n/.test(text) ? 2 : 1;
    this._set(text);
  }
  _set(text) { this._text = text; this._lines = null; this._offsets = null; }
  _ensure() { if (!this._lines) { this._lines = this._text.split(/\r\n|\r|\n/); } }
  get lineCount() { this._ensure(); return this._lines.length; }
  getText(range) {
    if (!range) return this._text;
    return this._text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
  }
  _lineOffsets() {
    if (!this._offsets) {
      const o = [0]; const t = this._text;
      for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c === 13) { if (t.charCodeAt(i + 1) === 10) i++; o.push(i + 1); } else if (c === 10) o.push(i + 1); }
      this._offsets = o;
    }
    return this._offsets;
  }
  lineAt(arg) {
    this._ensure();
    const line = typeof arg === 'number' ? arg : arg.line;
    if (line < 0 || line >= this._lines.length) throw new Error('Illegal value for `line`');
    const text = this._lines[line];
    const range = new Range(line, 0, line, text.length);
    const lead = text.length - text.trimStart().length;
    const full = new Range(line, 0, line + 1 <= this._lines.length - 1 ? line + 1 : line, line + 1 <= this._lines.length - 1 ? 0 : text.length);
    return { lineNumber: line, text, range, rangeIncludingLineBreak: full, firstNonWhitespaceCharacterIndex: lead, isEmptyOrWhitespace: lead === text.length };
  }
  offsetAt(pos) {
    const o = this._lineOffsets();
    const line = Math.max(0, Math.min(pos.line, o.length - 1));
    const lineEnd = line + 1 < o.length ? o[line + 1] : this._text.length;
    return Math.min(o[line] + pos.character, lineEnd);
  }
  positionAt(offset) {
    const o = this._lineOffsets();
    offset = Math.max(0, Math.min(offset, this._text.length));
    let lo = 0; let hi = o.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (o[mid] <= offset) lo = mid; else hi = mid - 1; }
    return new Position(lo, offset - o[lo]);
  }
  validatePosition(p) { this._ensure(); const line = Math.max(0, Math.min(p.line, this._lines.length - 1)); return new Position(line, Math.max(0, Math.min(p.character, this._lines[line].length))); }
  validateRange(r) { return new Range(this.validatePosition(r.start), this.validatePosition(r.end)); }
  getWordRangeAtPosition(pos, regex) {
    this._ensure();
    const line = this._lines[pos.line]; if (line === undefined) return undefined;
    const re = regex ? new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g') : /(-?\d*\.\d\w*)|([^\s`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?]+)/g;
    let m;
    while ((m = re.exec(line))) { if (m.index <= pos.character && pos.character <= m.index + m[0].length && m[0].length > 0) return new Range(pos.line, m.index, pos.line, m.index + m[0].length); if (m.index > pos.character) break; if (m[0].length === 0) re.lastIndex++; }
    return undefined;
  }
  save() { return Promise.resolve(true); }
}

const LANGUAGE_BY_EXT = {
  ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript', json: 'json', jsonc: 'jsonc',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less', md: 'markdown', py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby', sh: 'shellscript', yaml: 'yaml', yml: 'yaml', sql: 'sql', xml: 'xml', vue: 'vue',
  svelte: 'svelte', dart: 'dart', kt: 'kotlin', swift: 'swift', lua: 'lua', toml: 'toml', ps1: 'powershell', bat: 'bat', dockerfile: 'dockerfile',
};

/* ───────────────────────── factory ───────────────────────── */

function createVscode(rpc, ctx) {
  rpcRef = rpc;
  const docs = new Map();            // fsPath -> TextDocumentImpl
  const commands = new Map();        // id -> fn
  const providers = { completion: [], hover: [], definition: [], formatting: [], rangeFormatting: [], codeAction: [], documentSymbol: [], signatureHelp: [] };
  const diagnostics = new Map();     // collectionName -> Map<fsPath, Diagnostic[]>
  let nextId = 1;
  const emitters = {};
  const em = (name) => (emitters[name] ??= new EventEmitter());

  /* configuration: flat key map, user values over manifest defaults */
  const settings = { ...ctx.defaults, ...ctx.userSettings };
  const settingsEmitter = em('configChange');
  function lookup(key) { return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : undefined; }
  function sectionObject(prefix) {
    const out = {}; const p = prefix + '.'; let found = false;
    for (const [k, v] of Object.entries(settings)) {
      if (!k.startsWith(p)) continue; found = true;
      const parts = k.slice(p.length).split('.'); let cur = out;
      parts.forEach((part, i) => { if (i === parts.length - 1) cur[part] = v; else cur = (cur[part] = typeof cur[part] === 'object' && cur[part] ? cur[part] : {}); });
    }
    return found ? out : undefined;
  }
  function getConfiguration(section) {
    const full = (k) => (section ? section + '.' + k : k);
    const cfg = {
      get(key, dflt) { const v = lookup(full(key)); if (v !== undefined) return v; const o = sectionObject(full(key)); return o !== undefined ? o : dflt; },
      has(key) { return lookup(full(key)) !== undefined || sectionObject(full(key)) !== undefined; },
      inspect(key) { const v = lookup(full(key)); return { key: full(key), defaultValue: ctx.defaults[full(key)], globalValue: ctx.userSettings[full(key)], workspaceValue: undefined, value: v }; },
      update(key, value) { settings[full(key)] = value; ctx.userSettings[full(key)] = value; rpc.notify('config.update', { key: full(key), value }); settingsEmitter.fire({ affectsConfiguration: (s) => full(key) === s || full(key).startsWith(s + '.') || s.startsWith(full(key) + '.') }); return Promise.resolve(); },
    };
    return new Proxy(cfg, { get(t, p) { if (p in t) return t[p]; if (typeof p === 'symbol') return undefined; return t.get(String(p)); } });
  }
  function applySettings(next) {
    for (const k of Object.keys(ctx.userSettings)) delete ctx.userSettings[k];
    Object.assign(ctx.userSettings, next);
    for (const k of Object.keys(settings)) delete settings[k];
    Object.assign(settings, ctx.defaults, ctx.userSettings);
    settingsEmitter.fire({ affectsConfiguration: () => true });
  }

  /* documents */
  const onOpen = em('docOpen'); const onClose = em('docClose'); const onChange = em('docChange'); const onSave = em('docSave');
  function openDoc(p, languageId, version, text) {
    let d = docs.get(p);
    if (d) { d.languageId = languageId; d.version = version; d._set(text); return d; }
    d = new TextDocumentImpl(p, languageId || LANGUAGE_BY_EXT[path.extname(p).slice(1).toLowerCase()] || 'plaintext', version, text);
    docs.set(p, d); onOpen.fire(d); return d;
  }
  function changeDoc(p, version, text) {
    const d = docs.get(p); if (!d) return null;
    const old = d._text; d.version = version; d._set(text); d.isDirty = true;
    onChange.fire({ document: d, contentChanges: [{ range: new Range(0, 0, 0, old.length), rangeOffset: 0, rangeLength: old.length, text }], reason: undefined });
    return d;
  }
  function closeDoc(p) { const d = docs.get(p); if (d) { d.isClosed = true; docs.delete(p); onClose.fire(d); } }
  function saveDoc(p) { const d = docs.get(p); if (d) { d.isDirty = false; onSave.fire(d); } }

  /* editors */
  const onActiveEditor = em('activeEditor'); const onSelection = em('selection');
  const terminalList = []; const onOpenTerminal = em('termOpen'); const onCloseTerminal = em('termClose'); const onActiveTerminal = em('termActive');
  let activeEditor;
  function makeEditor(d, sel) {
    const selections = [sel || new Selection(0, 0, 0, 0)];
    const ed = {
      document: d, options: { tabSize: 4, insertSpaces: true, cursorStyle: 1, lineNumbers: 1 }, viewColumn: 1,
      get selection() { return selections[0]; }, set selection(s) { selections[0] = s; },
      get selections() { return selections; }, set selections(s) { selections.splice(0, selections.length, ...s); },
      visibleRanges: [new Range(0, 0, Math.min(50, d.lineCount), 0)],
      edit(cb) {
        const edits = [];
        const builder = { replace: (r, t) => edits.push(new TextEdit(r.start ? r : new Range(r, r), t)), insert: (p, t) => edits.push(TextEdit.insert(p, t)), delete: (r) => edits.push(TextEdit.delete(r)), setEndOfLine() {} };
        cb(builder);
        return rpc.request('editor.applyEdits', { path: d.fileName, edits: edits.map(serEdit) }).then(() => true);
      },
      insertSnippet(snippet, location) { return rpc.request('editor.insertSnippet', { path: d.fileName, snippet: snippet.value, at: location ? serRange(location.start ? location : new Range(location, location)) : null }).then(() => true); },
      setDecorations() {}, revealRange() {}, show() {}, hide() {},
    };
    return ed;
  }
  function setActive(p, selection) {
    if (!p) { activeEditor = undefined; onActiveEditor.fire(undefined); return; }
    const d = docs.get(p); if (!d) return;
    const sel = selection ? new Selection(selection[0], selection[1], selection[2], selection[3]) : undefined;
    if (activeEditor && activeEditor.document === d) { if (sel) { activeEditor.selection = sel; onSelection.fire({ textEditor: activeEditor, selections: [sel], kind: 1 }); } return; }
    activeEditor = makeEditor(d, sel); onActiveEditor.fire(activeEditor);
  }

  /* serialization */
  const serPos = (p) => [p.line, p.character];
  const serRange = (r) => [r.start.line, r.start.character, r.end.line, r.end.character];
  const serEdit = (e) => ({ range: serRange(e.range), newText: e.newText });
  const mdText = (v) => (v == null ? '' : typeof v === 'string' ? v : v.value !== undefined ? v.value : v.language ? '```' + v.language + '\n' + v.value + '\n```' : String(v));

  /* selector matching */
  function matches(selector, doc) {
    if (!selector) return false;
    if (Array.isArray(selector)) return selector.some((s) => matches(s, doc));
    if (typeof selector === 'string') return selector === '*' || selector === doc.languageId;
    if (selector.language && selector.language !== '*' && selector.language !== doc.languageId) return false;
    if (selector.scheme && selector.scheme !== 'file') return false;
    if (selector.pattern) { const pat = typeof selector.pattern === 'string' ? selector.pattern : selector.pattern.pattern; if (!globToRegExp(pat.includes('/') ? pat : '**/' + pat).test(toPosix(doc.fileName))) return false; }
    return true;
  }
  function register(kind, selector, provider, extra) {
    const entry = { id: nextId++, selector, provider, ...extra };
    providers[kind].push(entry);
    rpc.notify('provider.register', { kind, id: entry.id, selector: describeSelector(selector), triggerCharacters: (extra && extra.triggerCharacters) || [] });
    return new Disposable(() => { providers[kind] = providers[kind].filter((p) => p !== entry); rpc.notify('provider.unregister', { kind, id: entry.id }); });
  }
  function describeSelector(sel) { const arr = Array.isArray(sel) ? sel : [sel]; return arr.map((s) => (typeof s === 'string' ? { language: s } : { language: s.language, pattern: typeof s.pattern === 'string' ? s.pattern : s.pattern && s.pattern.pattern, scheme: s.scheme })); }
  const tokenOf = () => new CancellationTokenSource().token;

  /* ── provider execution (called by the app) ── */
  const pick = (kind, doc) => providers[kind].filter((p) => matches(p.selector, doc));
  const docAt = (params) => { const d = docs.get(params.path); if (!d) throw new Error('Document is not open: ' + params.path); return d; };

  async function provideCompletion(params) {
    const d = docAt(params); const pos = new Position(params.line, params.character);
    const out = [];
    for (const p of pick('completion', d)) {
      try {
        const r = await p.provider.provideCompletionItems(d, pos, tokenOf(), { triggerKind: params.triggerCharacter ? 1 : 0, triggerCharacter: params.triggerCharacter });
        const items = Array.isArray(r) ? r : r && r.items ? r.items : [];
        for (const it of items.slice(0, 500)) {
          const label = typeof it.label === 'string' ? it.label : it.label && it.label.label;
          let insert = it.insertText; let snippet = false;
          if (insert && typeof insert === 'object') { snippet = true; insert = insert.value; }
          out.push({ label, kind: it.kind, detail: it.detail || (it.label && it.label.detail), documentation: mdText(it.documentation), insertText: insert, snippet, sortText: it.sortText, filterText: it.filterText, range: it.range ? serRange(it.range.inserting || it.range) : it.textEdit ? serRange(it.textEdit.range) : null, textEdit: it.textEdit ? it.textEdit.newText : undefined, preselect: !!it.preselect, additionalTextEdits: (it.additionalTextEdits || []).map(serEdit), _provider: p.id, _index: out.length });
          if (typeof p.provider.resolveCompletionItem === 'function') { /* resolved lazily by the app */ }
        }
      } catch (e) { reportError('completion provider', e); }
    }
    return out;
  }
  async function provideHover(params) {
    const d = docAt(params); const pos = new Position(params.line, params.character); const parts = []; let range = null;
    for (const p of pick('hover', d)) {
      try { const h = await p.provider.provideHover(d, pos, tokenOf()); if (h) { for (const c of [].concat(h.contents)) { const t = mdText(c); if (t) parts.push(t); } if (h.range && !range) range = serRange(h.range); } } catch (e) { reportError('hover provider', e); }
    }
    return parts.length ? { contents: parts, range } : null;
  }
  async function provideDefinition(params) {
    const d = docAt(params); const pos = new Position(params.line, params.character); const out = [];
    for (const p of pick('definition', d)) {
      try {
        const r = await p.provider.provideDefinition(d, pos, tokenOf());
        for (const l of [].concat(r || [])) { const uri = l.uri || l.targetUri; const rg = l.range || l.targetSelectionRange || l.targetRange; if (uri && rg) out.push({ path: uri.fsPath, range: serRange(rg) }); }
      } catch (e) { reportError('definition provider', e); }
    }
    return out;
  }
  async function provideFormatting(params) {
    const d = docAt(params); const options = { tabSize: params.tabSize || 4, insertSpaces: params.insertSpaces !== false };
    const range = params.range ? new Range(params.range[0], params.range[1], params.range[2], params.range[3]) : null;
    const list = range ? pick('rangeFormatting', d) : pick('formatting', d);
    for (const p of list.length ? list : (range ? pick('formatting', d) : [])) {
      try {
        const r = range && p.provider.provideDocumentRangeFormattingEdits ? await p.provider.provideDocumentRangeFormattingEdits(d, range, options, tokenOf()) : await p.provider.provideDocumentFormattingEdits(d, options, tokenOf());
        if (r && r.length) return r.map(serEdit);
        if (r) return [];
      } catch (e) { reportError('formatting provider', e); throw e; }
    }
    return null;
  }
  async function provideCodeActions(params) {
    const d = docAt(params); const range = new Range(params.range[0], params.range[1], params.range[2], params.range[3]); const out = [];
    for (const p of pick('codeAction', d)) {
      try {
        const diags = (params.diagnostics || []).map((x) => Object.assign(new Diagnostic(new Range(x.range[0], x.range[1], x.range[2], x.range[3]), x.message, x.severity), { source: x.source, code: x.code }));
        const r = await p.provider.provideCodeActions(d, range, { diagnostics: diags, only: undefined, triggerKind: 1 }, tokenOf());
        for (const a of r || []) {
          const act = a.title !== undefined ? a : null; if (!act) continue;
          const edit = act.edit ? act.edit.entries().map(([u, es]) => ({ path: u.fsPath, edits: es.map(serEdit) })) : null;
          out.push({ title: act.title, kind: act.kind && act.kind.value, edit, command: act.command ? { id: act.command.command, args: act.command.arguments || [] } : null, isPreferred: !!act.isPreferred });
        }
      } catch (e) { reportError('code action provider', e); }
    }
    return out;
  }
  async function provideSymbols(params) {
    const d = docAt(params); const out = [];
    const walk = (s) => { const r = s.range || (s.location && s.location.range); if (!r) return; out.push({ name: s.name, kind: s.kind, range: serRange(r) }); (s.children || []).forEach(walk); };
    for (const p of pick('documentSymbol', d)) { try { (await p.provider.provideDocumentSymbols(d, tokenOf()) || []).forEach(walk); } catch (e) { reportError('symbol provider', e); } }
    return out;
  }

  /* ── namespaces ── */
  const messageApi = (level) => async (message, ...rest) => {
    const options = rest[0] && typeof rest[0] === 'object' && !rest[0].title && typeof rest[0] !== 'string' ? rest.shift() : {};
    const labels = rest.map((r) => (typeof r === 'string' ? r : r.title));
    const idx = await rpc.request('window.showMessage', { level, message: String(message), items: labels, modal: !!options.modal });
    return idx == null ? undefined : rest[idx];
  };

  function createOutputChannel(name) {
    const base = { name, append: (t) => rpc.notify('output.append', { name, text: String(t) }), appendLine: (t) => rpc.notify('output.append', { name, text: String(t) + '\n' }), replace: (t) => { rpc.notify('output.clear', { name }); rpc.notify('output.append', { name, text: String(t) }); }, clear: () => rpc.notify('output.clear', { name }), show: () => rpc.notify('output.show', { name }), hide() {}, dispose() {} };
    base.info = base.warn = base.error = base.debug = base.trace = (m) => base.appendLine(String(m));
    base.logLevel = 2; base.onDidChangeLogLevel = () => new Disposable(() => {});
    return base;
  }

  function createStatusBarItem(a, b) {
    let alignment = 1; let priority = 0; let id = 'sb' + nextId++;
    if (typeof a === 'string') { id = a; alignment = b || 1; } else { alignment = a || 1; priority = b || 0; }
    const item = { id, alignment, priority, text: '', tooltip: undefined, command: undefined, color: undefined, backgroundColor: undefined, name: undefined, accessibilityInformation: undefined, _visible: false,
      show() { item._visible = true; push(); }, hide() { item._visible = false; push(); }, dispose() { item._visible = false; push(true); } };
    function push(gone) { rpc.notify('statusbar.update', { id, text: String(item.text), tooltip: item.tooltip ? mdText(item.tooltip) : '', command: typeof item.command === 'string' ? item.command : item.command && item.command.command, alignment, priority, visible: item._visible, removed: !!gone }); }
    return new Proxy(item, { set(t, p, v) { t[p] = v; if (['text', 'tooltip', 'command'].includes(p) && t._visible) push(); return true; } });
  }

  /* ── webviews: panels (createWebviewPanel) and sidebar views (registerWebviewViewProvider) ── */
  const webviews = new Map();        // id -> { wv, closed: EventEmitter, vis: EventEmitter }
  const viewProviders = new Map();   // viewId -> provider
  const WEBVIEW_ORIGIN = 'http://aideext.localhost';
  function asWebviewUri(uri) {
    const target = toPosix(uri.fsPath).toLowerCase();
    for (const e of ctx.getExtensions()) {
      const dir = toPosix(e.extensionPath).toLowerCase().replace(/\/+$/, '');
      if (target.startsWith(dir + '/')) {
        const rel = toPosix(path.relative(e.extensionPath, uri.fsPath));
        return Uri.parse(WEBVIEW_ORIGIN + '/' + e.id + '/' + rel.split('/').map(encodeURIComponent).join('/'));
      }
    }
    return uri;
  }
  function makeWebview(id) {
    const recv = new EventEmitter(); let html = '';
    return { get html() { return html; }, set html(v) { html = String(v); rpc.notify('webview.html', { id, html }); },
      options: {}, cspSource: WEBVIEW_ORIGIN, asWebviewUri, postMessage(message) { rpc.notify('webview.post', { id, message }); return Promise.resolve(true); },
      onDidReceiveMessage: recv.event, _recv: recv };
  }
  function createWebviewPanel(viewType, title) {
    const id = 'wp' + nextId++; const wv = makeWebview(id); const closed = new EventEmitter(); const vis = new EventEmitter(); let t = String(title || '');
    const panel = { viewType, webview: wv, get title() { return t; }, set title(v) { t = String(v); rpc.notify('webview.title', { id, title: t }); }, iconPath: undefined, options: {}, viewColumn: 1, active: true, visible: true,
      onDidDispose: closed.event, onDidChangeViewState: vis.event, reveal() { rpc.notify('webview.reveal', { id }); },
      dispose() { if (!webviews.has(id)) return; webviews.delete(id); rpc.notify('webview.dispose', { id }); closed.fire(); } };
    webviews.set(id, { wv, closed, vis, panel });
    rpc.notify('webview.create', { id, kind: 'panel', viewType, title: t });
    return panel;
  }
  function registerWebviewViewProvider(viewId, provider) {
    viewProviders.set(viewId, provider);
    rpc.notify('webview.viewProvider', { viewId });
    return new Disposable(() => { viewProviders.delete(viewId); });
  }
  async function resolveWebviewView(params) {
    const provider = viewProviders.get(params.viewId);
    if (!provider) throw new Error('No webview view provider for ' + params.viewId);
    const id = 'wv' + nextId++; const wv = makeWebview(id); const closed = new EventEmitter(); const vis = new EventEmitter();
    const view = { viewType: params.viewId, webview: wv, title: undefined, description: undefined, badge: undefined, visible: true,
      onDidDispose: closed.event, onDidChangeVisibility: vis.event, show() { rpc.notify('webview.reveal', { id }); } };
    webviews.set(id, { wv, closed, vis, view });
    rpc.notify('webview.create', { id, kind: 'view', viewType: params.viewId, title: '' });
    await provider.resolveWebviewView(view, { state: undefined }, new CancellationTokenSource().token);
    return { id };
  }
  function webviewMessage(id, message) { const w = webviews.get(id); if (w) w.wv._recv.fire(message); }
  function webviewClosed(id) { const w = webviews.get(id); if (w) { webviews.delete(id); w.closed.fire(); } }
  function webviewVisible(id, visible) { const w = webviews.get(id); if (w) { if (w.view) w.view.visible = visible; if (w.panel) w.panel.visible = visible; w.vis.fire({ webviewPanel: w.panel, visible }); } }

  const window = {
    showInformationMessage: messageApi('info'), showWarningMessage: messageApi('warn'), showErrorMessage: messageApi('error'),
    async showQuickPick(items, options = {}) {
      const list = await Promise.resolve(items);
      const norm = list.map((i) => (typeof i === 'string' ? { label: i } : { label: i.label, description: i.description, detail: i.detail, picked: i.picked }));
      const res = await rpc.request('window.showQuickPick', { items: norm, placeHolder: options.placeHolder, canPickMany: !!options.canPickMany });
      if (res == null) return undefined;
      return options.canPickMany ? res.map((i) => list[i]) : list[res];
    },
    async showInputBox(options = {}) { return (await rpc.request('window.showInputBox', { prompt: options.prompt, value: options.value, placeHolder: options.placeHolder, password: !!options.password, title: options.title })) ?? undefined; },
    createOutputChannel, createStatusBarItem,
    setStatusBarMessage(text, hide) { const sb = createStatusBarItem(1, -1000); sb.text = String(text); sb.show(); const d = new Disposable(() => sb.dispose()); if (typeof hide === 'number') setTimeout(() => d.dispose(), hide); return d; },
    withProgress(options, task) { const cts = new CancellationTokenSource(); return Promise.resolve(task({ report(v) { rpc.notify('progress', { title: options.title, message: v && v.message }); } }, cts.token)); },
    get activeTextEditor() { return activeEditor; },
    get visibleTextEditors() { return activeEditor ? [activeEditor] : []; },
    get activeTerminal() { return terminalList[terminalList.length - 1]; }, get terminals() { return terminalList.slice(); },
    onDidOpenTerminal: onOpenTerminal.event, onDidCloseTerminal: onCloseTerminal.event, onDidChangeActiveTerminal: onActiveTerminal.event,
    get state() { return { focused: true }; },
    onDidChangeActiveTextEditor: onActiveEditor.event, onDidChangeTextEditorSelection: onSelection.event,
    async showTextDocument(a, b) { const uri = a.uri || a; const p = uri.fsPath; const opts = b && b.start ? { selection: b } : (b && b.selection ? b : (a && a.selection ? a : {})); await rpc.request('window.showTextDocument', { path: p, selection: opts.selection ? serRange(opts.selection) : null }); return activeEditor; },
    createTextEditorDecorationType(options) { const key = 'deco' + nextId++; return { key, options, dispose() {} }; },
    registerTreeDataProvider() { unsupported('window.registerTreeDataProvider'); return new Disposable(() => {}); },
    createTreeView() { unsupported('window.createTreeView'); return { dispose() {}, reveal: () => Promise.resolve(), onDidChangeSelection: () => new Disposable(() => {}), onDidChangeVisibility: () => new Disposable(() => {}), onDidExpandElement: () => new Disposable(() => {}), onDidCollapseElement: () => new Disposable(() => {}), visible: false, selection: [] }; },
    registerWebviewViewProvider,
    registerWebviewPanelSerializer() { return new Disposable(() => {}); }, registerCustomEditorProvider() { return new Disposable(() => {}); },
    createWebviewPanel,
    createTerminal(a, shellPath) {
      const opts = typeof a === 'object' && a ? a : { name: a, shellPath };
      const id = 'term' + nextId++;
      const name = String(opts.name || 'Terminal');
      const term = { name, creationOptions: opts, exitStatus: undefined, processId: Promise.resolve(undefined), state: { isInteractive: true },
        sendText(text, addNewLine) { rpc.notify('terminal.send', { id, text: String(text).slice(0, 100000), newline: addNewLine !== false }); },
        show() { rpc.notify('terminal.show', { id }); }, hide() {},
        dispose() { const i = terminalList.indexOf(term); if (i >= 0) { terminalList.splice(i, 1); rpc.notify('terminal.dispose', { id }); onCloseTerminal.fire(term); } } };
      terminalList.push(term);
      rpc.notify('terminal.create', { id, name });
      onOpenTerminal.fire(term);
      return term;
    },
    registerUriHandler() { return new Disposable(() => {}); },
    showWorkspaceFolderPick: async () => undefined, showOpenDialog: async () => undefined, showSaveDialog: async () => undefined,
    tabGroups: { all: [], activeTabGroup: { tabs: [] }, onDidChangeTabs: () => new Disposable(() => {}), onDidChangeTabGroups: () => new Disposable(() => {}) },
  };

  const workspaceFolder = ctx.workspace ? { uri: Uri.file(ctx.workspace), name: path.basename(ctx.workspace), index: 0 } : null;
  const asRelativePath = (p) => { const f = typeof p === 'string' ? p : p.uri ? p.uri.fsPath : p.fsPath; if (!ctx.workspace) return f; const r = path.relative(ctx.workspace, f); return r.startsWith('..') ? f : toPosix(r); };

  async function walk(dir, include, exclude, out, max) {
    let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max) return;
      const full = path.join(dir, e.name); const rel = toPosix(path.relative(ctx.workspace, full));
      if (e.isDirectory()) { if (e.name === '.git' || (exclude && exclude.test(rel + '/'))) continue; if (e.name === 'node_modules' && !(include && /node_modules/.test(include.source))) continue; await walk(full, include, exclude, out, max); }
      else if ((!include || include.test(rel)) && !(exclude && exclude.test(rel))) out.push(Uri.file(full));
    }
  }

  const workspace = {
    workspaceFolders: workspaceFolder ? [workspaceFolder] : undefined,
    name: workspaceFolder ? workspaceFolder.name : undefined,
    rootPath: ctx.workspace || undefined, isTrusted: true,
    getConfiguration, asRelativePath,
    getWorkspaceFolder(uri) { return workspaceFolder && toPosix(uri.fsPath).toLowerCase().startsWith(toPosix(ctx.workspace).toLowerCase()) ? workspaceFolder : undefined; },
    get textDocuments() { return [...docs.values()]; },
    async openTextDocument(arg) {
      if (arg && typeof arg === 'object' && !arg.fsPath && !arg.scheme) { return new TextDocumentImpl('untitled:' + nextId++, arg.language || 'plaintext', 1, arg.content || ''); }
      const p = typeof arg === 'string' ? arg : arg.fsPath;
      const existing = docs.get(p); if (existing) return existing;
      const text = await fsp.readFile(p, 'utf8');
      return new TextDocumentImpl(p, LANGUAGE_BY_EXT[path.extname(p).slice(1).toLowerCase()] || 'plaintext', 1, text);
    },
    onDidOpenTextDocument: onOpen.event, onDidCloseTextDocument: onClose.event, onDidChangeTextDocument: onChange.event, onDidSaveTextDocument: onSave.event,
    onWillSaveTextDocument: em('willSave').event, onDidChangeConfiguration: settingsEmitter.event,
    onDidChangeWorkspaceFolders: em('wsFolders').event, onDidCreateFiles: em('create').event, onDidDeleteFiles: em('delete').event, onDidRenameFiles: em('rename').event,
    async applyEdit(edit) {
      const changes = edit.entries().map(([u, es]) => ({ path: u.fsPath, edits: es.map(serEdit) }));
      return !!(await rpc.request('workspace.applyEdit', { changes }));
    },
    async findFiles(include, exclude, maxResults = 1000) {
      if (!ctx.workspace) return [];
      const inc = include ? globToRegExp(toPosix(typeof include === 'string' ? include : include.pattern)) : null;
      const exc = exclude ? globToRegExp(toPosix(typeof exclude === 'string' ? exclude : exclude.pattern)) : null;
      const out = []; await walk(ctx.workspace, inc, exc, out, maxResults); return out;
    },
    createFileSystemWatcher(glob) {
      const pattern = globToRegExp(toPosix(typeof glob === 'string' ? glob : glob.pattern)); const c = new EventEmitter(); const ch = new EventEmitter(); const d = new EventEmitter();
      let w = null;
      try { if (ctx.workspace) w = fs.watch(ctx.workspace, { recursive: true }, (ev, name) => { if (!name) return; const rel = toPosix(name); if (rel.startsWith('node_modules/') || rel.startsWith('.git/') || !pattern.test(rel)) return; const uri = Uri.file(path.join(ctx.workspace, name)); fs.existsSync(uri.fsPath) ? (ev === 'rename' ? c : ch).fire(uri) : d.fire(uri); }); } catch { /* unsupported platform */ }
      return { onDidCreate: c.event, onDidChange: ch.event, onDidDelete: d.event, ignoreCreateEvents: false, ignoreChangeEvents: false, ignoreDeleteEvents: false, dispose() { if (w) w.close(); } };
    },
    fs: {
      async readFile(u) { return new Uint8Array(await fsp.readFile(u.fsPath)); },
      async writeFile(u, content) { await fsp.mkdir(path.dirname(u.fsPath), { recursive: true }); await fsp.writeFile(u.fsPath, content); },
      async stat(u) { const s = await fsp.stat(u.fsPath); return { type: s.isDirectory() ? 2 : 1, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size }; },
      async readDirectory(u) { return (await fsp.readdir(u.fsPath, { withFileTypes: true })).map((e) => [e.name, e.isDirectory() ? 2 : 1]); },
      async createDirectory(u) { await fsp.mkdir(u.fsPath, { recursive: true }); },
      async delete(u, o) { await fsp.rm(u.fsPath, { recursive: !!(o && o.recursive), force: true }); },
      async rename(a, b) { await fsp.rename(a.fsPath, b.fsPath); },
      async copy(a, b) { await fsp.cp(a.fsPath, b.fsPath, { recursive: true }); },
    },
    registerTextDocumentContentProvider() { return new Disposable(() => {}); }, registerFileSystemProvider() { return new Disposable(() => {}); },
    registerTaskProvider() { return new Disposable(() => {}); },
    updateWorkspaceFolders() { return false; },
    notebookDocuments: [],
  };

  const languages = {
    registerCompletionItemProvider: (sel, provider, ...chars) => register('completion', sel, provider, { triggerCharacters: chars }),
    registerHoverProvider: (sel, provider) => register('hover', sel, provider),
    registerDefinitionProvider: (sel, provider) => register('definition', sel, provider),
    registerDocumentFormattingEditProvider: (sel, provider) => register('formatting', sel, provider),
    registerDocumentRangeFormattingEditProvider: (sel, provider) => register('rangeFormatting', sel, provider),
    registerCodeActionsProvider: (sel, provider) => register('codeAction', sel, provider),
    registerDocumentSymbolProvider: (sel, provider) => register('documentSymbol', sel, provider),
    registerSignatureHelpProvider: (sel, provider) => register('signatureHelp', sel, provider),
    createDiagnosticCollection(name = 'collection' + nextId++) {
      const map = new Map(); diagnostics.set(name, map);
      const publish = (p, list) => rpc.notify('diagnostics.set', { name, path: p, diagnostics: (list || []).map((d) => ({ range: serRange(d.range), message: d.message, severity: d.severity, source: d.source, code: d.code && typeof d.code === 'object' ? d.code.value : d.code })) });
      return {
        name,
        set(a, b) { if (Array.isArray(a)) { a.forEach(([u, l]) => { map.set(u.fsPath, l); publish(u.fsPath, l); }); } else { map.set(a.fsPath, b || []); publish(a.fsPath, b); } },
        delete(u) { map.delete(u.fsPath); publish(u.fsPath, []); }, clear() { for (const k of map.keys()) publish(k, []); map.clear(); },
        forEach(cb) { for (const [k, v] of map) cb(Uri.file(k), v); }, get(u) { return map.get(u.fsPath); }, has(u) { return map.has(u.fsPath); }, dispose() { this.clear(); diagnostics.delete(name); },
      };
    },
    getDiagnostics(uri) { if (uri) { const out = []; for (const m of diagnostics.values()) out.push(...(m.get(uri.fsPath) || [])); return out; } const all = new Map(); for (const m of diagnostics.values()) for (const [k, v] of m) all.set(k, [...(all.get(k) || []), ...v]); return [...all].map(([k, v]) => [Uri.file(k), v]); },
    async getLanguages() { return [...new Set(Object.values(LANGUAGE_BY_EXT))]; },
    setLanguageConfiguration() { return new Disposable(() => {}); }, setTextDocumentLanguage: async (d) => d,
    match(sel, doc) { return matches(sel, doc) ? 10 : 0; },
    onDidChangeDiagnostics: em('diagChange').event,
  };

  const builtins = new Map();
  const cmd = {
    registerCommand(id, fn, thisArg) { commands.set(id, thisArg ? fn.bind(thisArg) : fn); rpc.notify('commands.register', { id }); return new Disposable(() => { commands.delete(id); rpc.notify('commands.unregister', { id }); }); },
    registerTextEditorCommand(id, fn, thisArg) { return cmd.registerCommand(id, (...a) => activeEditor && fn.call(thisArg, activeEditor, { replace() {}, insert() {}, delete() {} }, ...a)); },
    async executeCommand(id, ...args) {
      if (commands.has(id)) return commands.get(id)(...args);
      if (ctx.onUnknownCommand) { const handled = await ctx.onUnknownCommand(id, args); if (handled && handled.done) return handled.value; }
      return rpc.request('commands.execute', { id, args: JSON.parse(JSON.stringify(args, (k, v) => (v instanceof Uri ? v.toString() : v))) });
    },
    async getCommands() { return [...commands.keys()]; },
  };

  const env = {
    appName: 'AIDE', appRoot: ctx.appRoot || '', appHost: 'desktop', uriScheme: 'aide', language: ctx.language || 'en', machineId: ctx.machineId || 'aide-machine', sessionId: 'aide-' + Date.now(),
    remoteName: undefined, shell: process.env.COMSPEC || process.env.SHELL || '', uiKind: 1, isTelemetryEnabled: false, isNewAppInstall: false,
    onDidChangeTelemetryEnabled: () => new Disposable(() => {}),
    clipboard: { readText: () => rpc.request('env.clipboardRead', {}), writeText: (t) => rpc.request('env.clipboardWrite', { text: String(t) }).then(() => undefined) },
    openExternal: (u) => rpc.request('env.openExternal', { url: u.toString() }),
    asExternalUri: async (u) => u,
  };

  const extensionsApi = {
    get all() { return ctx.getExtensions(); },
    getExtension(id) { return ctx.getExtensions().find((e) => e.id.toLowerCase() === String(id).toLowerCase()); },
    onDidChange: em('extChange').event,
  };

  const vscode = {
    version: '1.95.0',
    Disposable, EventEmitter, Position, Range, Selection, Uri, TextEdit, WorkspaceEdit, MarkdownString, SnippetString, ThemeColor, ThemeIcon, Diagnostic, Location,
    CompletionItem, CompletionList, Hover, CodeAction, CodeActionKind, CancellationTokenSource, RelativePattern,
    DiagnosticSeverity, CompletionItemKind, SymbolKind, StatusBarAlignment, ConfigurationTarget, EndOfLine, FileType, TextEditorRevealType, ViewColumn, ProgressLocation,
    ExtensionMode, UIKind, CompletionTriggerKind, DiagnosticTag, TextDocumentSaveReason, DecorationRangeBehavior, OverviewRulerLane,
    window: withStubs(window, 'window'), workspace: withStubs(workspace, 'workspace'), languages: withStubs(languages, 'languages'),
    commands: withStubs(cmd, 'commands'), env: withStubs(env, 'env'), extensions: withStubs(extensionsApi, 'extensions'),
    FileSystemError: class FileSystemError extends Error { static FileNotFound(m) { return new FileSystemError(String(m || 'File not found')); } static FileExists(m) { return new FileSystemError(String(m || 'File exists')); } static NoPermissions(m) { return new FileSystemError(String(m || 'No permissions')); } static Unavailable(m) { return new FileSystemError(String(m || 'Unavailable')); } },
    CancellationError: class CancellationError extends Error {},
    TreeItem: class TreeItem { constructor(label, state) { this.label = label; this.collapsibleState = state; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    LogLevel: { Off: 0, Trace: 1, Debug: 2, Info: 3, Warning: 4, Error: 5 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    tasks: makeStub('tasks'), debug: makeStub('debug'), scm: makeStub('scm'), notebooks: makeStub('notebooks'), authentication: makeStub('authentication'), l10n: { t: (m, ...a) => (typeof m === 'string' ? m.replace(/\{(\d+)\}/g, (_x, i) => a[i]) : m.message), bundle: undefined, uri: undefined }, comments: makeStub('comments'), chat: makeStub('chat'), lm: makeStub('lm'), tests: makeStub('tests'),
  };

  // Real enums that extensions compare against:
  Object.assign(vscode, {
    LanguageStatusSeverity: E(['Information', 'Warning', 'Error']),
    TextEditorLineNumbersStyle: E(['Off', 'On', 'Relative']),
    TextEditorCursorStyle: E(['Line', 'Block', 'Underline', 'LineThin', 'BlockOutline', 'UnderlineThin']),
    ExtensionKind: { UI: 1, Workspace: 2 },
    FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
    SignatureHelpTriggerKind: { Invoke: 1, TriggerCharacter: 2, ContentChange: 3 },
    InlayHintKind: { Type: 1, Parameter: 2 },
    FoldingRangeKind: { Comment: 1, Imports: 2, Region: 3 },
    CodeActionTriggerKind: { Invoke: 1, Automatic: 2 },
    NotebookCellKind: { Markup: 1, Code: 2 },
    TaskScope: { Global: 1, Workspace: 2 },
    TaskRevealKind: { Always: 1, Silent: 2, Never: 3 },
    TaskPanelKind: { Shared: 1, Dedicated: 2, New: 3 },
    TerminalExitReason: { Unknown: 0, Shutdown: 1, Process: 2, User: 3, Extension: 4 },
    TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
    CommentMode: { Editing: 0, Preview: 1 },
    SymbolTag: { Deprecated: 1 },
    CompletionItemTag: { Deprecated: 1 },
    TextDocumentChangeReason: { Undo: 1, Redo: 2 },
    SyntaxTokenType: { Other: 0, Comment: 1, String: 2, RegEx: 3 },
    InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
    TestRunProfileKind: { Run: 1, Debug: 2, Coverage: 3 },
    EnvironmentVariableMutatorType: { Replace: 1, Append: 2, Prepend: 3 },
  });
  // Classes and enums without a UI in AIDE: present (so `import { X } from 'vscode'` links) but inert.
  const INERT = ['CallHierarchyItem', 'CodeLens', 'Color', 'ColorInformation', 'ColorPresentation', 'CommentThreadCollapsibleState', 'CustomExecution', 'DataTransfer', 'DataTransferItem',
    'DebugAdapterExecutable', 'DebugAdapterInlineImplementation', 'DebugAdapterNamedPipeServer', 'DebugAdapterServer', 'DebugConfigurationProviderTriggerKind', 'DebugConsoleMode',
    'DocumentDropEdit', 'DocumentHighlight', 'DocumentHighlightKind', 'DocumentLink', 'DocumentSymbol', 'EvaluatableExpression', 'FileDecoration', 'FoldingRange', 'InlayHint', 'InlayHintLabelPart',
    'InlineCompletionItem', 'InlineCompletionList', 'InlineValueEvaluatableExpression', 'InlineValueText', 'InlineValueVariableLookup', 'LanguageModelChatMessage', 'LanguageModelChatMessageRole',
    'LanguageModelError', 'LanguageModelPromptTsxPart', 'LanguageModelTextPart', 'LanguageModelToolCallPart', 'LanguageModelToolResult', 'LanguageModelToolResultPart', 'LinkedEditingRanges',
    'NotebookCellData', 'NotebookCellOutput', 'NotebookCellOutputItem', 'NotebookData', 'NotebookEdit', 'NotebookRange', 'NotebookEditorRevealType', 'ParameterInformation', 'ProcessExecution',
    'QuickInputButtons', 'SelectionRange', 'SemanticTokens', 'SemanticTokensBuilder', 'SemanticTokensLegend', 'ShellExecution', 'ShellQuoting', 'SignatureHelp', 'SignatureInformation',
    'SymbolInformation', 'Task', 'TaskGroup', 'TaskPanelKind', 'TerminalLink', 'TerminalLocation', 'TerminalProfile', 'TestMessage', 'TestRunRequest', 'TestTag', 'TextEditorSelectionChangeKind',
    'TypeHierarchyItem', 'WebviewViewResolveContext', 'CancellationError', 'FunctionBreakpoint', 'SourceBreakpoint', 'Breakpoint', 'AuthenticationSession', 'CompletionItemLabel',
    'TabInputText', 'TabInputTextDiff', 'TabInputCustom', 'TabInputWebview', 'TabInputNotebook', 'TabInputTerminal', 'ChatResponseMarkdownPart', 'ChatRequestTurn', 'ChatResponseTurn',
    'TelemetryTrustedValue', 'TextEditorEdit', 'TextDocumentShowOptions', 'WorkspaceFolder', 'LogOutputChannel', 'LanguageStatusItem', 'ChatResultFeedbackKind', 'ViewColumn2'];
  for (const n of INERT) if (!(n in vscode)) vscode[n] = makeStub('vscode.' + n);

  return {
    vscode,
    api: { openDoc, changeDoc, closeDoc, saveDoc, setActive, applySettings, commands, matches, docs,
      provide: { completion: provideCompletion, hover: provideHover, definition: provideDefinition, formatting: provideFormatting, codeActions: provideCodeActions, symbols: provideSymbols },
      webview: { message: webviewMessage, closed: webviewClosed, visible: webviewVisible, resolveView: resolveWebviewView },
      emit: (name, data) => em(name).fire(data), makeUri: (p) => Uri.file(p) },
  };
}

module.exports = { createVscode, Uri, Disposable, EventEmitter };
