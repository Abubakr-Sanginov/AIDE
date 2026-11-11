'use strict';
// Self-test: node selftest.js <extensionsDir>   (drives host.js through its JSON protocol)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const dir = process.argv[2];
const child = spawn(process.execPath, [path.join(__dirname, 'host.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
const out = []; let buf = ''; const waiters = [];
const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
let id = 0; const results = new Map();
child.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l) continue;
    const m = JSON.parse(l); out.push(m);
    if (m.t === 'q' && m.method === 'window.showMessage') send({ t: 'r', id: m.id, result: 0 });
    else if (m.t === 'q') send({ t: 'r', id: m.id, result: null });
    if (m.t === 'r') results.set(m.id, m);
    waiters.splice(0).forEach((w) => w());
  }
});
const until = (pred, ms = 8000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms);
  const check = () => { const r = pred(); if (r) { clearTimeout(t); res(r); } else waiters.push(check); };
  check();
});
const call = async (method, params) => { const my = 'a' + ++id; send({ t: 'q', id: my, method, params }); const r = await until(() => results.get(my)); if (r.error) throw new Error(r.error); return r.result; };
const has = (method, f) => out.find((m) => m.t === 'n' && m.method === method && (!f || f(m.params)));
(async () => {
  const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!cond) process.exitCode = 1; };
  await until(() => has('ready'));
  const ids = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'package.json')));
  const extensions = ids.map((n) => ({ id: 'aide.' + n, dir: path.join(dir, n), manifest: JSON.parse(fs.readFileSync(path.join(dir, n, 'package.json'), 'utf8')) }));
  send({ t: 'n', method: 'init', params: { extensions, workspace: dir, dataDir: path.join(dir, '_data'), userSettings: { 'demo.greeting': 'Hello' }, language: 'en' } });
  await until(() => has('init.done'));
  const file = path.join(dir, 'a.txt');
  send({ t: 'n', method: 'doc.open', params: { path: file, languageId: 'plaintext', version: 1, text: 'hello world\nTODO fix' } });
  await until(() => has('ext.state', (p) => p.state === 'active' || p.state === 'error'));
  ok('extension activated on language event', !!has('ext.state', (p) => p.state === 'active'));
  ok('command registered', !!has('commands.register', (p) => p.id === 'demo.hello'));
  ok('status bar item', !!has('statusbar.update', (p) => p.visible && p.text.includes('demo')));
  ok('output channel', !!has('output.append', (p) => p.text.includes('activated')));
  await until(() => has('diagnostics.set', (p) => p.diagnostics.length === 1));
  ok('diagnostics published', true);
  ok('command with message + config', (await call('commands.execute', { id: 'demo.hello', args: [] })) === 'picked:OK');
  ok('message used the user setting', out.some((m) => m.t === 'q' && m.method === 'window.showMessage' && m.params.message === 'Hello from demo'));
  const comp = await call('provide.completion', { path: file, line: 1, character: 2 });
  ok('completion', comp.length === 1 && comp[0].label === 'demoItem' && comp[0].snippet === true, JSON.stringify(comp[0]).slice(0, 100));
  const hov = await call('provide.hover', { path: file, line: 0, character: 2 });
  ok('hover', hov && hov.contents[0] === '**hello**', JSON.stringify(hov));
  const fmt = await call('provide.formatting', { path: file });
  ok('formatting', fmt && fmt[0].newText === 'HELLO WORLD\nTODO FIX');
  send({ t: 'n', method: 'doc.change', params: { path: file, version: 2, text: 'clean' } });
  await until(() => out.filter((m) => m.method === 'diagnostics.set').length >= 2);
  ok('diagnostics cleared after change', !!has('diagnostics.set', (p) => p.diagnostics.length === 0));
  ok('unsupported APIs did not crash the host', !out.some((m) => m.method === 'log' && /Activation .* failed/.test(m.params.message)));
  // webviews
  ok('panel command', (await call('commands.execute', { id: 'demo.panel', args: [] })) === 'ok');
  const created = (has('webview.create', (p) => p.kind === 'panel') || {}).params;
  ok('panel created', !!created && created.title === 'Demo Panel');
  const htmlMsg = (has('webview.html', (p) => p.id === created.id) || {}).params;
  ok('asWebviewUri points at the aideext scheme', !!htmlMsg && htmlMsg.html.includes('http://aideext.localhost/aide.demo/media/a.js'), htmlMsg && htmlMsg.html);
  send({ t: 'n', method: 'webview.message', params: { id: created.id, message: { hello: 1 } } });
  await until(() => has('webview.post', (p) => p.id === created.id && p.message.echo && p.message.echo.hello === 1));
  ok('webview message round trip', true);
  ok('view provider registered', !!has('webview.viewProvider', (p) => p.viewId === 'demo.sidebar'));
  const view = await call('webview.resolveView', { viewId: 'demo.sidebar' });
  ok('view resolved', !!view && !!has('webview.html', (p) => p.id === view.id && p.html === '<p>view</p>'));
  send({ t: 'n', method: 'webview.closed', params: { id: created.id } });
  await call('shutdown', {});
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e.message); console.error(out.filter((m) => m.method === 'log').map((m) => m.params.message).join('\n')); process.exit(1); });
