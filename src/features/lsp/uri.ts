/** Same file, whatever the server's encoding: file:///D:/a, file:///d%3A/a, backslashes, case. */
export function normalizeUri(uri: string): string {
  let s = uri;
  try {
    s = decodeURIComponent(uri);
  } catch {
    /* malformed escape: compare as is */
  }
  return s.replace(/\\/g, "/").replace(/^file:\/+/i, "file:///").toLowerCase();
}
