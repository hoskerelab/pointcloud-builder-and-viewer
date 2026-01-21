// lib/safeFile.ts
// IMPORTANT: imported by renderer/React, so NO Node imports allowed.

export function toSafeFileUrl(filePath: string): string {
  const p = filePath.replace(/\\/g, "/");

  // Windows drive paths: C:/Users/... or C:\Users\...
  // -> safe-file:///C:/Users/...
  const drive = p.match(/^([a-zA-Z]):(\/.*)?$/);
  if (drive) {
    const letter = drive[1].toUpperCase();
    const rest = drive[2] ?? "/";
    return `safe-file:///${letter}:${encodeURI(rest)}`;
  }

  // UNC paths: //server/share/...
  // -> safe-file:////server/share/...
  if (p.startsWith("//")) {
    return `safe-file:${encodeURI(p)}`;
  }

  // POSIX absolute paths: /Users/...  (mac/linux)
  // -> safe-file:///Users/...
  // NOTE: this must be TWO slashes in template + leading "/" in path = 3 total
  if (p.startsWith("/")) {
    return `safe-file://${encodeURI(p)}`;
  }

  // Relative fallback -> safe-file:///relative/path
  return `safe-file:///${encodeURI(p)}`;
}
