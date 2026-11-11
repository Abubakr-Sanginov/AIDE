/** Provider model IDs are opaque: preserve case, slashes and version suffixes. */
export function normalizeModelId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 256 || /[\s\u0000-\u001f\u007f]/u.test(id)) {
    throw new Error("model-id");
  }
  return id;
}

/** Discovery is advisory; a saved model may be private or absent from /models. */
export function modelSelection(discovered: string[], saved: string | null): { models: string[]; model: string } {
  let model = "";
  if (saved) {
    try { model = normalizeModelId(saved); } catch { /* Ignore malformed old settings. */ }
  }
  const models = [...new Set(discovered)];
  if (model && !models.includes(model)) models.unshift(model);
  return { models, model: model || models[0] || "" };
}
