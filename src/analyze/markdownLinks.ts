export interface MarkdownLink {
  readonly destination: string;
  readonly line: number;
  readonly column: number;
}

/**
 * Extracts the bounded Markdown link subset documented by ADR-0020. Fenced and
 * inline code are masked first so examples do not become findings. The scanner
 * recognizes inline/image destinations and reference definitions; it is not a
 * general Markdown parser or renderer.
 */
export function extractMarkdownLinks(markdown: string): readonly MarkdownLink[] {
  const visible = maskCode(markdown);
  const candidates: { destination: string; offset: number }[] = [];

  let openLabels = 0;
  for (let index = 0; index < visible.length - 1; index++) {
    if (visible[index] === "\n" || visible[index] === "\r") {
      openLabels = 0;
      continue;
    }
    if (visible[index] === "[" && !isEscaped(visible, index)) {
      openLabels++;
      continue;
    }
    if (visible[index] !== "]" || isEscaped(visible, index)) continue;
    const hasOpener = openLabels > 0;
    if (hasOpener) openLabels--;
    if (!hasOpener || visible[index + 1] !== "(") continue;
    const parsed = parseInlineDestination(visible, index + 2);
    if (parsed !== undefined) candidates.push(parsed);
  }

  const definitionPattern = /^(?: {0,3})\[[^\]]+\]:[ \t]*(?:<([^>\r\n]+)>|([^\s]+))/gm;
  for (const match of visible.matchAll(definitionPattern)) {
    const destination = match[1] ?? match[2];
    if (destination === undefined) continue;
    const relativeOffset = match[0].indexOf(destination);
    candidates.push({ destination, offset: match.index + relativeOffset });
  }

  candidates.sort((left, right) => left.offset - right.offset);
  const seen = new Set<string>();
  const lineStarts = collectLineStarts(markdown);
  return candidates.flatMap((candidate) => {
    const key = `${String(candidate.offset)}\0${candidate.destination}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const location = locationAt(lineStarts, candidate.offset);
    return [{ destination: unescapeMarkdownDestination(candidate.destination), ...location }];
  });
}

function parseInlineDestination(
  markdown: string,
  start: number,
): { destination: string; offset: number } | undefined {
  let index = start;
  while (markdown[index] === " " || markdown[index] === "\t") index++;

  if (markdown[index] === "<") {
    const destinationStart = index + 1;
    for (index = destinationStart; index < markdown.length; index++) {
      if (markdown[index] === "\n" || markdown[index] === "\r") return undefined;
      if (markdown[index] === "\\") {
        index++;
      } else if (markdown[index] === ">") {
        if (!hasClosingParenthesis(markdown, index + 1)) return undefined;
        return {
          destination: markdown.slice(destinationStart, index),
          offset: destinationStart,
        };
      }
    }
    return undefined;
  }

  const destinationStart = index;
  let nestedParentheses = 0;
  for (; index < markdown.length; index++) {
    const character = markdown[index];
    if (character === "\\") {
      index++;
      continue;
    }
    if (character === "(") {
      nestedParentheses++;
      continue;
    }
    if (character === ")") {
      if (nestedParentheses === 0) break;
      nestedParentheses--;
      continue;
    }
    if (/\s/.test(character ?? "")) break;
  }
  if (index === destinationStart || !hasClosingParenthesis(markdown, index)) return undefined;
  return { destination: markdown.slice(destinationStart, index), offset: destinationStart };
}

function maskCode(markdown: string): string {
  const characters = markdown.split("");
  let inFence: { character: string; length: number } | undefined;
  let lineStart = 0;

  while (lineStart < characters.length) {
    let lineEnd = characters.indexOf("\n", lineStart);
    if (lineEnd < 0) lineEnd = characters.length;
    const line = characters.slice(lineStart, lineEnd).join("");
    const fence = /^(?: {0,3})(`{3,}|~{3,})/.exec(line)?.[1];
    if (inFence !== undefined) {
      maskRange(characters, lineStart, lineEnd);
      if (fence?.startsWith(inFence.character) === true && fence.length >= inFence.length) {
        inFence = undefined;
      }
    } else if (fence !== undefined) {
      inFence = { character: fence[0] ?? "`", length: fence.length };
      maskRange(characters, lineStart, lineEnd);
    }
    lineStart = lineEnd + 1;
  }

  const codeSearch = characters.join("");
  for (let index = 0; index < characters.length; index++) {
    if (characters[index] !== "`") continue;
    let runLength = 1;
    while (characters[index + runLength] === "`") runLength++;
    const fence = "`".repeat(runLength);
    const close = codeSearch.indexOf(fence, index + runLength);
    if (close < 0) continue;
    const end = close + runLength;
    maskRange(characters, index, end);
    index = end - 1;
  }

  return characters.join("");
}

function hasClosingParenthesis(markdown: string, start: number): boolean {
  if (markdown[start] === ")") return true;
  const lineEndCandidates = [markdown.indexOf("\n", start), markdown.indexOf("\r", start)].filter(
    (index) => index >= 0,
  );
  const lineEnd = lineEndCandidates.length === 0 ? markdown.length : Math.min(...lineEndCandidates);
  const suffix = markdown.slice(start, lineEnd);
  return /^[ \t]*(?:(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\))[ \t]*)?\)/.test(
    suffix,
  );
}

function maskRange(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index++) {
    if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
  }
}

function unescapeMarkdownDestination(destination: string): string {
  return destination.replace(/\\([\\`()<> ])/g, "$1");
}

function isEscaped(markdown: string, offset: number): boolean {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && markdown[index] === "\\"; index--) backslashes++;
  return backslashes % 2 === 1;
}

function collectLineStarts(text: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function locationAt(
  lineStarts: readonly number[],
  offset: number,
): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= offset) low = middle;
    else high = middle;
  }
  return { line: low + 1, column: offset - (lineStarts[low] ?? 0) + 1 };
}
