const vscode = require('vscode');
const path = require('path');

exports.activate = (context) => {
  const out = vscode.window.createOutputChannel('Demo');
  out.appendLine('activated');
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  item.text = '$(rocket) demo';
  item.command = 'demo.hello';
  item.show();
  context.subscriptions.push(
    vscode.commands.registerCommand('demo.hello', async () => {
      const cfg = vscode.workspace.getConfiguration('demo');
      const choice = await vscode.window.showInformationMessage(cfg.get('greeting') + ' from demo', 'OK', 'Cancel');
      return 'picked:' + choice;
    }),
    vscode.languages.registerCompletionItemProvider('plaintext', {
      provideCompletionItems(doc, pos) {
        const it = new vscode.CompletionItem('demoItem', vscode.CompletionItemKind.Snippet);
        it.insertText = new vscode.SnippetString('demo ${1:x}');
        it.detail = 'line ' + pos.line;
        return [it];
      },
    }, '.'),
    vscode.languages.registerHoverProvider('plaintext', {
      provideHover(doc, pos) {
        const r = doc.getWordRangeAtPosition(pos);
        return new vscode.Hover(new vscode.MarkdownString('**' + (r ? doc.getText(r) : '?') + '**'), r);
      },
    }),
    vscode.languages.registerDocumentFormattingEditProvider('plaintext', {
      provideDocumentFormattingEdits(doc) {
        return [vscode.TextEdit.replace(new vscode.Range(0, 0, doc.lineCount, 0), doc.getText().toUpperCase())];
      },
    }),
  );
  const diags = vscode.languages.createDiagnosticCollection('demo');
  const check = (doc) => {
    if (doc.languageId !== 'plaintext') return;
    const m = /TODO/.exec(doc.getText());
    diags.set(doc.uri, m ? [new vscode.Diagnostic(new vscode.Range(doc.positionAt(m.index), doc.positionAt(m.index + 4)), 'Found TODO', vscode.DiagnosticSeverity.Warning)] : []);
  };
  vscode.workspace.onDidOpenTextDocument(check);
  vscode.workspace.onDidChangeTextDocument((e) => check(e.document));
  context.subscriptions.push(
    vscode.commands.registerCommand('demo.panel', () => {
      const panel = vscode.window.createWebviewPanel('demo.view', 'Demo Panel', 1, {});
      const script = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'a.js')));
      panel.webview.html = '<html><head></head><body>' + script.toString() + '</body></html>';
      panel.webview.onDidReceiveMessage((m) => panel.webview.postMessage({ echo: m }));
      return 'ok';
    }),
    vscode.window.registerWebviewViewProvider('demo.sidebar', { resolveWebviewView(view) { view.title = 'Side'; view.webview.html = '<p>view</p>'; } }),
  );
  // APIs AIDE has no UI for must not crash the extension:
  vscode.window.createTreeView('x', {});
  vscode.workspace.nonexistentApi();
  return { api: 1 };
};
