// Module hooks so that ES-module extensions can `import ... from 'vscode'`.
// The shim object lives on globalThis.__aideVscode in the main thread; the generated module
// re-exports it with one named export per member.

let names = [];

export function initialize(data) {
  names = (data && data.names) || [];
}

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'vscode') return { url: 'aide-vscode:shim', shortCircuit: true };
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url === 'aide-vscode:shim') {
    const valid = names.filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default');
    const source = `const v = globalThis.__aideVscode;\nexport default v;\n${valid.map((n) => `export const ${n} = v[${JSON.stringify(n)}];`).join('\n')}\n`;
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
