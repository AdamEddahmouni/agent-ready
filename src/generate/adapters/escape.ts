/**
 * Escapes a single logical piece of contract-supplied free text so it can
 * never introduce new CommonMark block structure or unintended inline
 * formatting when interpolated into a line of generated Markdown.
 */
export function escapeMarkdownText(value: string): string {
  const singleLine = value.replace(/\r\n|\r|\n/g, " ");

  // Inline-significant characters, escaped wherever they occur: \ (must
  // be escaped first), ` (code span), * _ (emphasis), [ ] (link/image
  // text), < > (autolinks/inline HTML), ~ (GFM strikethrough).
  let escaped = singleLine.replace(/[\\`*_[\]<>~]/g, (ch) => `\\${ch}`);

  // Block-starting markers, only significant at the very start of the
  // (now single-line) string: ATX heading, -/+ list marker, ordered-list
  // marker, blockquote, fenced-code-block opener. Up to 3 leading spaces
  // are still recognized as block markers by CommonMark.
  escaped = escaped.replace(
    /^(\s{0,3})(#{1,6}(?:\s|$)|[-+](?:\s|$)|\d{1,9}[.)](?:\s|$)|>|(?:```|~~~))/,
    (_match, indent: string, marker: string) => `${indent}\\${marker}`,
  );

  return escaped;
}

/**
 * Wraps `value` in a CommonMark inline code span, choosing a backtick
 * fence length strictly greater than the longest backtick run already in
 * `value` (per CommonMark: a code span opened by a backtick string of
 * length N is closed only by the next backtick string of exactly length
 * N), padding with a space if the content starts/ends with a backtick.
 */
export function wrapCodeSpan(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const longestRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longestRun + 1);
  const needsPadding = value.startsWith("`") || value.endsWith("`") || value === "";
  const body = needsPadding ? ` ${value} ` : value;
  return `${fence}${body}${fence}`;
}

// eslint-disable-next-line no-control-regex -- deliberately catches raw control characters in a contract-supplied path
const NEEDS_ANGLE_BRACKETS = /[\s()\x00-\x1f]/;

/**
 * Renders `[text](destination)` for a contract-supplied path used as both
 * link text and destination. Uses CommonMark's angle-bracket destination
 * form only when the path contains a space, parenthesis, or control
 * character — plain paths render exactly as today, so existing golden
 * fixtures are unaffected.
 */
export function renderMarkdownLink(path: string): string {
  const text = path.replace(/[\\[\]]/g, (ch) => `\\${ch}`);
  if (!NEEDS_ANGLE_BRACKETS.test(path) && !path.includes("<") && !path.includes(">")) {
    return `[${text}](${path})`;
  }
  const destination = path.replace(/[\\<>]/g, (ch) => `\\${ch}`);
  return `[${text}](<${destination}>)`;
}
