export function toSafeFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const driveMatch = normalized.match(/^([a-zA-Z]):(\/.*)?$/);
  if (driveMatch) {
    const drive = driveMatch[1].toUpperCase();
    const rest = driveMatch[2] ?? '/';
    return `safe-file:///${drive}:${encodeURI(rest)}`;
  }
  if (normalized.startsWith('//')) {
    return `safe-file:${encodeURI(normalized)}`;
  }
  if (normalized.startsWith('/')) {
    return `safe-file://${encodeURI(normalized)}`;
  }
  return `safe-file:///${encodeURI(normalized)}`;
}
