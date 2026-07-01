/**
 * Minimal, OS-tolerant path helpers used for real-file-system ancestor
 * walking. Unlike `node:path` (whose default export is platform-specific
 * and normalizes output separators to the host convention), these accept
 * and preserve either `/` or `\` as a separator. This matters because the
 * same discovery logic must work against real OS paths (which use the
 * host's native separator) and, in tests, against forward-slash virtual
 * paths on an InMemoryFileSystem regardless of host OS. Both Windows and
 * POSIX file APIs accept forward slashes, so joining with `/` is safe on
 * every supported platform.
 */

export function joinPath(base: string, ...segments: string[]): string {
  let result = base;
  for (const segment of segments) {
    if (segment.length === 0) {
      continue;
    }
    result = /[/\\]$/.test(result) ? result + segment : `${result}/${segment}`;
  }
  return result;
}

/**
 * Returns the parent directory of `path`, or `path` itself if it has no
 * further parent (a stable fixed point the caller can detect to stop
 * ancestor traversal).
 */
export function dirnamePath(path: string): string {
  let end = path.length;
  while (end > 1 && /[/\\]/.test(path[end - 1] ?? "")) {
    end--;
  }
  const trimmed = path.slice(0, end);
  const lastSeparator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (lastSeparator < 0) {
    return trimmed;
  }
  if (lastSeparator === 0) {
    return trimmed.slice(0, 1);
  }
  return trimmed.slice(0, lastSeparator);
}
