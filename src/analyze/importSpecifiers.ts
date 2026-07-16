export interface ImportSpecifier {
  readonly specifier: string;
  readonly line: number;
  readonly column: number;
}

/**
 * Extracts the bounded import subset documented by ADR-0037. Comments and
 * string literals are masked first so that prose and example code do not
 * become findings, mirroring the Markdown link scanner's discipline
 * (ADR-0020). This is deliberately not a JavaScript parser: it recognizes
 * static `import`/`export ... from`, and `import()`/`require()` with a
 * literal argument. Non-literal dynamic specifiers are ignored rather than
 * guessed at.
 */
export function extractImportSpecifiers(source: string): readonly ImportSpecifier[] {
  const visible = maskCommentsAndStrings(source);
  const lineStarts = collectLineStarts(source);
  const found: ImportSpecifier[] = [];

  const patterns = [
    // import ... from "x" / export ... from "x". The span may cross lines,
    // because a named-import clause does, but never a semicolon: that keeps a
    // preceding unrelated statement from pairing with a later `from`.
    /\b(?:import|export)\b[^;]*?\bfrom\s*(['"])/g,
    // bare side-effect import: import "x"
    /\bimport\s*(['"])/g,
    // import("x") / require("x")
    /\b(?:import|require)\s*\(\s*(['"])/g,
  ];

  for (const pattern of patterns) {
    for (const match of visible.matchAll(pattern)) {
      const quote = match[1];
      if (quote === undefined) continue;
      const openIndex = match.index + match[0].length - 1;
      const specifier = readLiteral(source, visible, openIndex, quote);
      if (specifier === undefined) continue;
      found.push({
        specifier: specifier.value,
        ...locationAt(lineStarts, specifier.start),
      });
    }
  }

  const seen = new Set<string>();
  return found
    .sort((left, right) =>
      left.line === right.line ? left.column - right.column : left.line - right.line,
    )
    .filter((entry) => {
      const key = `${String(entry.line)}\0${String(entry.column)}\0${entry.specifier}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Reads the literal string body starting at an opening quote. Returns
 * undefined when the literal is unterminated, spans a line, or contains an
 * interpolation — none of which this bounded scanner resolves.
 */
function readLiteral(
  source: string,
  visible: string,
  openIndex: number,
  quote: string,
): { value: string; start: number } | undefined {
  const start = openIndex + 1;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (character === "\\") {
      index++;
      continue;
    }
    if (character === "\n" || character === "\r") return undefined;
    if (character === quote) {
      // The masker blanks string bodies, so a literal that survives here is
      // one the masker also recognized as a string.
      if (visible[openIndex] !== quote) return undefined;
      return { value: source.slice(start, index), start };
    }
  }
  return undefined;
}

/**
 * Blanks line comments, block comments, and the bodies of string and
 * template literals, preserving offsets and newlines so reported positions
 * stay accurate. Quote characters themselves are preserved so that the
 * import patterns can still anchor on them.
 */
function maskCommentsAndStrings(source: string): string {
  const characters = source.split("");
  let index = 0;

  while (index < characters.length) {
    const character = characters[index];
    const next = characters[index + 1];

    if (character === "/" && next === "/") {
      while (index < characters.length && characters[index] !== "\n") {
        characters[index] = " ";
        index++;
      }
      continue;
    }

    if (character === "/" && next === "*") {
      characters[index] = " ";
      characters[index + 1] = " ";
      index += 2;
      while (index < characters.length) {
        if (characters[index] === "*" && characters[index + 1] === "/") {
          characters[index] = " ";
          characters[index + 1] = " ";
          index += 2;
          break;
        }
        if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
        index++;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      index++;
      while (index < characters.length) {
        if (characters[index] === "\\") {
          characters[index] = " ";
          if (index + 1 < characters.length) characters[index + 1] = " ";
          index += 2;
          continue;
        }
        if (characters[index] === quote) {
          index++;
          break;
        }
        // A non-template literal cannot span lines; stop so an unterminated
        // quote does not swallow the rest of the file.
        if (quote !== "`" && (characters[index] === "\n" || characters[index] === "\r")) break;
        if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
        index++;
      }
      continue;
    }

    index++;
  }

  return characters.join("");
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
