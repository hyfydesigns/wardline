/**
 * Snippet minimisation — the only text the pipeline ever persists. Shared by
 * the rule-based and Claude classifiers so both emit a short, centred window
 * rather than the full captured text.
 */

export function truncate(s: string, len = 120): string {
  const clean = s.trim().replace(/\s+/g, ' ');
  return clean.length > len ? clean.slice(0, len) + '…' : clean;
}

/** Build a minimised window centred on `matchIndex` (or truncate from the start). */
export function centeredSnippet(text: string, matchIndex: number, len = 120): string {
  if (matchIndex < 0) return truncate(text, len);
  const half = Math.floor(len / 2);
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(text.length, matchIndex + half);
  let snippet = text.slice(start, end).trim().replace(/\s+/g, ' ');
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';
  return snippet;
}
