/* Runs inside every extension webview (loaded from the aideext: scheme before the page's own scripts).
   Provides acquireVsCodeApi() and the --vscode-* theme variables extensions expect. */
(function () {
  var id = location.pathname.split('/')[2] || '';
  var key = 'aide.wv.' + id;
  var state = null;
  try { state = JSON.parse(localStorage.getItem(key)); } catch (e) { /* no storage */ }
  var api = {
    postMessage: function (message) { parent.postMessage({ __aide: 'webview', id: id, message: message }, '*'); },
    getState: function () { return state; },
    setState: function (s) { state = s; try { localStorage.setItem(key, JSON.stringify(s)); } catch (e) { /* ignore */ } return s; },
  };
  window.acquireVsCodeApi = function () { return api; };

  // Messages from the extension arrive wrapped; unwrap them and hide the wrapper from the page.
  window.addEventListener('message', function (e) {
    if (e.source === parent && e.data && e.data.__aide === 'toWebview') {
      e.stopImmediatePropagation();
      window.dispatchEvent(new MessageEvent('message', { data: e.data.message }));
    }
  }, true);

  var vars = {
    'editor-background': '#151514', 'editor-foreground': '#e6ebf1', 'foreground': '#e6ebf1', 'descriptionForeground': '#94a1b3',
    'font-family': "'Segoe UI', system-ui, sans-serif", 'font-size': '13px', 'font-weight': 'normal',
    'editor-font-family': "'JetBrains Mono', Consolas, monospace", 'editor-font-size': '13px', 'editor-font-weight': 'normal',
    'sideBar-background': '#151514', 'sideBar-foreground': '#e6ebf1', 'panel-background': '#151514', 'panel-border': '#2a2927',
    'button-background': '#5eead4', 'button-foreground': '#151514', 'button-hoverBackground': '#99f6e4',
    'button-secondaryBackground': '#2a2927', 'button-secondaryForeground': '#e6ebf1', 'button-secondaryHoverBackground': '#3d3c39',
    'input-background': '#111110', 'input-foreground': '#e6ebf1', 'input-border': '#3d3c39', 'input-placeholderForeground': '#5d6a80',
    'focusBorder': '#5eead4', 'textLink-foreground': '#5eead4', 'textLink-activeForeground': '#99f6e4',
    'textCodeBlock-background': '#1b1a18', 'textPreformat-foreground': '#e6ebf1', 'textBlockQuote-background': '#1b1a18', 'textBlockQuote-border': '#3d3c39',
    'list-hoverBackground': '#ffffff10', 'list-activeSelectionBackground': '#ffffff18', 'list-activeSelectionForeground': '#e6ebf1',
    'badge-background': '#3d3c39', 'badge-foreground': '#e6ebf1', 'errorForeground': '#f87171', 'editorWarning-foreground': '#fbbf24',
    'dropdown-background': '#1b1a18', 'dropdown-foreground': '#e6ebf1', 'dropdown-border': '#3d3c39',
    'scrollbarSlider-background': '#ffffff20', 'scrollbarSlider-hoverBackground': '#ffffff30', 'widget-border': '#3d3c39',
    'editor-selectionBackground': '#5eead433', 'editorWidget-background': '#1b1a18', 'toolbar-hoverBackground': '#ffffff15',
  };
  function apply() {
    var root = document.documentElement;
    for (var k in vars) root.style.setProperty('--vscode-' + k, vars[k]);
    root.setAttribute('data-vscode-theme-kind', 'vscode-dark');
    if (document.body) document.body.classList.add('vscode-dark');
  }
  apply();
  document.addEventListener('DOMContentLoaded', apply);
})();
