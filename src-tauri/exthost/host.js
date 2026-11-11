'use strict';
// AIDE extension host: runs VS Code extensions in a separate Node.js process.
// Protocol: one JSON object per line on stdin/stdout.
//   {t:'n', method, params}                 notification (either direction)
//   {t:'q', id, method, params}             request   -> {t:'r', id, result | error}
// The app starts the conversation: the host sends {t:'n', method:'ready'} and the app answers with 'init'.

const fs = require('fs');
const path = require('path');
const Module = require('module');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { createVscode, Uri } = require('./vscode.js');

const rawWrite = process.stdout.write.bind(process.stdout);
const send = (obj) => { try { rawWrite(JSON.stringify(obj) + '\n'); } catch (e) { /* closed pipe */ } };

let counter = 0;
const pending = new Map();
const rpc = {
  notify: (method, params) => send({ t: 'n', method, params }),
  request: (method, params) => new Promise((resolve, reject) => {
    const id = 'h' + (++counter);
    pending.set(id, { resolve, reject });
    send({ t: 'q', id, method, params });
  }),
};

// Extensions often print to the console: route it to the app instead of corrupting the protocol stream.
const fmt = (args) => args.map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
for (const [name, level] of [['log', 'info'], ['info', 'info'], ['debug', 'debug'], ['warn', 'warn'], ['error', 'error'], ['trace', 'debug']]) {
  console[name] = (...a) => rpc.notify('log', { level, message: fmt(a) });
}
process.stdout.write = (chunk) => { rpc.notify('log', { level: 'info', message: String(chunk) }); return true; };
process.on('uncaughtException', (e) => rpc.notify('log', { level: 'error', message: 'uncaughtException: ' + (e && e.stack || e) }));
process.on('unhandledRejection', (e) => rpc.notify('log', { level: 'error', message: 'unhandledRejection: ' + (e && e.stack || e) }));

/* ── extensions ── */
const exts = new Map();        // id -> { id, dir, manifest, active, exports, context, activating }
let api = null; let vscode = null; let init = null;

class Memento {
  constructor(file) { this.file = file; this.data = {}; try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new */ } this._t = null; }
  keys() { return Object.keys(this.data); }
  get(k, d) { return k in this.data ? this.data[k] : d; }
  update(k, v) { if (v === undefined) delete this.data[k]; else this.data[k] = v; clearTimeout(this._t); this._t = setTimeout(() => { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch { /* ignore */ } }, 200); return Promise.resolve(); }
  setKeysForSync() {}
}

function insideDir(dir, file) { const rel = path.relative(dir, file); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); }

function describe(ext) {
  return { id: ext.id, extensionPath: ext.dir, extensionUri: Uri.file(ext.dir), packageJSON: ext.manifest, extensionKind: 1, get isActive() { return ext.active; }, get exports() { return ext.exports; }, activate: () => activate(ext.id).then(() => ext.exports) };
}

function makeContext(ext) {
  const base = path.join(init.dataDir, ext.id);
  const wsHash = crypto.createHash('sha1').update(init.workspace || '').digest('hex').slice(0, 12);
  const secrets = new Map();
  const ctx = {
    subscriptions: [], extensionPath: ext.dir, extensionUri: Uri.file(ext.dir), extensionMode: 1,
    globalState: new Memento(path.join(base, 'globalState.json')), workspaceState: new Memento(path.join(base, `ws-${wsHash}.json`)),
    secrets: { get: async (k) => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async (k) => { secrets.delete(k); }, onDidChange: () => ({ dispose() {} }) },
    storagePath: path.join(base, 'ws-' + wsHash), globalStoragePath: path.join(base, 'global'), logPath: path.join(base, 'logs'),
    storageUri: Uri.file(path.join(base, 'ws-' + wsHash)), globalStorageUri: Uri.file(path.join(base, 'global')), logUri: Uri.file(path.join(base, 'logs')),
    environmentVariableCollection: { persistent: false, replace() {}, append() {}, prepend() {}, get() {}, forEach() {}, delete() {}, clear() {}, description: '' },
    extension: describe(ext), languageModelAccessInformation: {},
    asAbsolutePath: (rel) => path.join(ext.dir, rel),
  };
  ctx.globalState.setKeysForSync = () => {};
  return ctx;
}

async function activate(id) {
  const ext = exts.get(id);
  if (!ext || ext.active) return;
  if (ext.activating) return ext.activating;
  ext.activating = (async () => {
    try {
      const main = ext.manifest.main;
      if (!main) { ext.active = true; return; }
      const file = path.resolve(ext.dir, main.endsWith('.js') || main.endsWith('.cjs') ? main : main + (fs.existsSync(path.resolve(ext.dir, main + '.js')) ? '.js' : ''));
      if (!insideDir(ext.dir, file)) throw new Error('main points outside the extension folder');
      if (!fs.existsSync(file)) throw new Error('The extension code is missing on disk (it was installed by an older AIDE version that kept only themes and snippets). Remove the extension and install it again.');
      let mod;
      try { mod = require(file); } catch (e) {
        if (!e || (e.code !== 'ERR_REQUIRE_ESM' && e.code !== 'ERR_REQUIRE_ASYNC_MODULE')) throw e;
        mod = await import(pathToFileURL(file).href);
      }
      if (mod && mod.default && typeof mod.activate !== 'function' && typeof mod.default.activate === 'function') mod = mod.default;
      ext.context = makeContext(ext);
      if (mod && typeof mod.activate === 'function') ext.exports = await mod.activate(ext.context);
      ext.module = mod; ext.active = true;
      rpc.notify('ext.state', { id, state: 'active' });
    } catch (e) {
      rpc.notify('ext.state', { id, state: 'error', message: String(e && e.stack || e) });
      rpc.notify('log', { level: 'error', message: `Activation of ${id} failed: ${e && e.stack || e}` });
    }
  })();
  return ext.activating;
}

function activationEvents(ext) {
  const ev = new Set(ext.manifest.activationEvents || []);
  const c = ext.manifest.contributes || {};
  for (const cmd of c.commands || []) if (cmd.command) ev.add('onCommand:' + cmd.command);
  for (const l of c.languages || []) if (l.id) ev.add('onLanguage:' + l.id);
  return [...ev];
}

async function activateByStartup() {
  for (const ext of exts.values()) {
    const ev = activationEvents(ext);
    const startup = ev.some((e) => e === '*' || e === 'onStartupFinished' || e === 'onWebviewPanel:*' || /^onFileSystem:|^onUri$|^onAuthenticationRequest:|^onResolveRemoteAuthority:|^onCustomEditor:|^onNotebook:|^onTerminalProfile:|^onDebug/.test(e));
    const wc = ev.filter((e) => e.startsWith('workspaceContains:'));
    if (startup) { await activate(ext.id); continue; }
    if (wc.length && init.workspace) {
      for (const e of wc) { const found = await vscode.workspace.findFiles(e.slice('workspaceContains:'.length), '**/node_modules/**', 1); if (found.length) { await activate(ext.id); break; } }
    }
  }
}

async function activateForLanguage(lang) {
  const jobs = [];
  for (const ext of exts.values()) if (!ext.active && activationEvents(ext).includes('onLanguage:' + lang)) jobs.push(activate(ext.id));
  await Promise.all(jobs);
}

async function executeCommand(id, args) {
  if (api.commands.has(id)) return api.commands.get(id)(...args);
  const owner = [...exts.values()].find((e) => !e.active && activationEvents(e).includes('onCommand:' + id));
  if (owner) { await activate(owner.id); if (api.commands.has(id)) return api.commands.get(id)(...args); }
  throw new Error(`command '${id}' not found`);
}

/* ── incoming messages ── */
const handlers = {
  async init(params) {
    init = params;
    const defaults = {};
    for (const e of params.extensions) for (const sec of [].concat((e.manifest.contributes || {}).configuration || [])) for (const [k, v] of Object.entries(sec.properties || {})) if (v && v.default !== undefined) defaults[k] = v.default;
    const created = createVscode(rpc, {
      workspace: params.workspace, defaults, userSettings: params.userSettings || {}, language: params.language, appRoot: params.appRoot,
      getExtensions: () => [...exts.values()].map(describe),
    });
    vscode = created.vscode; api = created.api;
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) { return request === 'vscode' ? vscode : origLoad.call(this, request, parent, isMain); };
    // ES-module extensions: `import * from 'vscode'` goes through loader hooks.
    globalThis.__aideVscode = vscode;
    try { Module.register('./esm-hooks.mjs', { parentURL: pathToFileURL(__filename), data: { names: Object.keys(vscode) } }); } catch (e) { rpc.notify('log', { level: 'warn', message: 'ESM hooks unavailable: ' + e.message }); }
    for (const e of params.extensions) exts.set(e.id, { id: e.id, dir: e.dir, manifest: e.manifest, active: false, exports: undefined });
    rpc.notify('init.done', { extensions: [...exts.keys()] });
    await activateByStartup();
  },
  // Like VS Code: extensions activated by this language see the open event of the document that woke them.
  async 'doc.open'(p) { await activateForLanguage(p.languageId); api.openDoc(p.path, p.languageId, p.version, p.text); },
  'doc.change'(p) { api.changeDoc(p.path, p.version, p.text); },
  'doc.close'(p) { api.closeDoc(p.path); },
  'doc.save'(p) { api.saveDoc(p.path); },
  'editor.active'(p) { api.setActive(p.path, p.selection); },
  'config.set'(p) { api.applySettings(p.settings); },
  'webview.message'(p) { api.webview.message(p.id, p.message); },
  'webview.closed'(p) { api.webview.closed(p.id); },
  'webview.visible'(p) { api.webview.visible(p.id, !!p.visible); },
};
const calls = {
  'commands.execute': (p) => executeCommand(p.id, p.args || []),
  'provide.completion': (p) => api.provide.completion(p),
  'provide.hover': (p) => api.provide.hover(p),
  'provide.definition': (p) => api.provide.definition(p),
  'provide.formatting': (p) => api.provide.formatting(p),
  'provide.codeActions': (p) => api.provide.codeActions(p),
  'provide.symbols': (p) => api.provide.symbols(p),
  'webview.resolveView': (p) => api.webview.resolveView(p),
  async shutdown() {
    for (const ext of exts.values()) { try { if (ext.module && typeof ext.module.deactivate === 'function') await Promise.race([ext.module.deactivate(), new Promise((r) => setTimeout(r, 2000))]); } catch { /* ignore */ } }
    setTimeout(() => process.exit(0), 50); return true;
  },
};

let buf = '';
let chain = Promise.resolve(); // notifications are handled strictly in order
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    void dispatch(m);
  }
});
process.stdin.on('end', () => process.exit(0));

async function dispatch(m) {
  try {
    if (m.t === 'n') { const h = handlers[m.method]; if (h) { const run = () => h(m.params || {}); chain = chain.then(run, run).catch((e) => rpc.notify('log', { level: 'error', message: m.method + ': ' + (e && e.stack || e) })); } }
    else if (m.t === 'q') {
      const h = calls[m.method];
      if (!h) return send({ t: 'r', id: m.id, error: 'unknown method ' + m.method });
      try { send({ t: 'r', id: m.id, result: await h(m.params || {}) }); } catch (e) { send({ t: 'r', id: m.id, error: String(e && e.message || e) }); }
    } else if (m.t === 'r') {
      const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
    }
  } catch (e) { rpc.notify('log', { level: 'error', message: 'dispatch: ' + (e && e.stack || e) }); }
}

rpc.notify('ready', { node: process.version });
