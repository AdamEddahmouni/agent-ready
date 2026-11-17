/**
 * Reading a JSON document's *positions* (ADR-0047 §7, §14).
 *
 * `JSON.parse` can tell you a document is valid and what it contains. It cannot
 * tell you where `ajv` was written, and "which line declared this dependency" is
 * the question this whole issue exists to answer. Producing that by searching
 * the text for `"ajv"` would be a guess: the same string appears in
 * `devDependencies`, in a transitive entry, and in a peer-suffixed lockfile key.
 *
 * So positions come from TypeScript's own JSON AST, keyed by JSON Pointer, and
 * **only** positions. `JSON.parse` remains the single authority on whether a
 * document parses, and the byte and depth caps from ADR-0045 still decide
 * whether it is read at all. That split is deliberate: TypeScript's JSON reader
 * is JSONC-tolerant, so a document with a trailing comma would produce positions
 * while `JSON.parse` calls it malformed. Letting the tolerant parser decide would
 * silently change what `manifestStatus: "malformed"` means, which is a
 * #37 semantic this issue does not get to redefine.
 *
 * The consequence of the split is that the two can only disagree about *where*
 * something is, never about *whether* the document is usable — and a disagreement
 * about position is a missing citation, not a wrong value.
 */

import ts from "typescript";
import { countLines } from "./provenance.js";
import type { SourceLocation } from "./types.js";

/**
 * A position index over one JSON document, addressed by JSON Pointer.
 *
 * `Map` rather than a tree because a consumer asks "where is `/dependencies/ajv`?"
 * and not "give me the document". A flat index is also the shape that makes the
 * byte and depth caps the only limit on its size, since it holds one entry per
 * node rather than a second copy of the document.
 */
export type JsonLocationIndex = ReadonlyMap<string, SourceLocation>;

/** A pointer-escaping failure, surfaced rather than silently producing a bad key. */
export type JsonIndexResult =
  | { readonly ok: true; readonly locations: JsonLocationIndex; readonly lineCount: number }
  | { readonly ok: false; readonly detail: string };

/**
 * Escapes one JSON Pointer segment.
 *
 * `~` and `/` are the only characters a pointer escapes. A dependency literally
 * named `a/b` is a legal npm package name, and an unescaped pointer would
 * resolve to a different location — a citation that looks precise and is wrong,
 * which is worse than no citation.
 */
export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Builds a pointer→position index for a JSON document.
 *
 * The root object literal is walked to a fixed depth bounded by the caller's
 * cap, and every property name and every value is recorded. A document that
 * exceeds the walk depth yields an index for the part it did reach rather than
 * failing: the caller's depth guard has already decided whether the document is
 * acceptable, and a partial index only means a missing citation for the parts
 * beyond it, never a wrong one.
 */
export function indexJsonPositions(
  source: string,
  text: string,
  maxDepth: number,
): JsonIndexResult {
  let sourceFile: ts.SourceFile;
  try {
    // `createSourceFile` with `ScriptKind.JSON` parses the document as an
    // expression statement, which keeps the tree shallow and the positions
    // exact. The returned file's `parseDiagnostics` are deliberately not
    // consulted: whether this document is valid JSON is `JSON.parse`'s call,
    // and this reader is only asked where things are.
    sourceFile = ts.createSourceFile(
      source,
      text,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ false,
      ts.ScriptKind.JSON,
    );
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof Error ? error.message : "The document could not be parsed for positions.",
    };
  }

  const locations = new Map<string, SourceLocation>();
  const first = sourceFile.statements[0];
  const root =
    first !== undefined && ts.isExpressionStatement(first) ? first.expression : undefined;
  if (root === undefined || !ts.isObjectLiteralExpression(root)) {
    // A document that is not a JSON object has no properties to cite. That is
    // not an error here: the caller already knows whether it parsed, and a
    // non-object is a `manifestStatus` question, not a position question.
    return { ok: true, locations, lineCount: countLines(text) };
  }

  walk(root, "", 1, maxDepth, sourceFile, source, locations);
  return { ok: true, locations, lineCount: countLines(text) };
}

function walk(
  literal: ts.ObjectLiteralExpression,
  pointer: string,
  depth: number,
  maxDepth: number,
  sourceFile: ts.SourceFile,
  source: string,
  into: Map<string, SourceLocation>,
): void {
  if (depth > maxDepth) {
    return;
  }
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property)) {
      // Shorthand and spread forms have no key to address. A manifest that uses
      // one is reported as unmodelled by the code that reads it; here there is
      // simply nothing to cite.
      continue;
    }
    const key = propertyKeyOf(property);
    if (key === null) {
      continue;
    }
    const child = `${pointer}/${escapePointerSegment(key)}`;
    // Last write wins, matching `JSON.parse`: a document with a duplicate key
    // has one value, and citing the first occurrence while publishing the
    // second would be a citation that points somewhere the value is not.
    into.set(child, positionOf(sourceFile, source, property.name));
    into.set(`${child}/`, positionOf(sourceFile, source, property.initializer));
    if (ts.isObjectLiteralExpression(property.initializer)) {
      walk(property.initializer, child, depth + 1, maxDepth, sourceFile, source, into);
    }
  }
}

function propertyKeyOf(property: ts.PropertyAssignment): string | null {
  const name = property.name;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  return null;
}

function positionOf(sourceFile: ts.SourceFile, source: string, node: ts.Node): SourceLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.end);
  return {
    source,
    // TypeScript reports 0-based; a citation is 1-based. Converted here, once.
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

/**
 * The position of a pointer, with a JSON Pointer attached.
 *
 * Falls back to a *line 1* location rather than nothing when the index has no
 * entry for the pointer — which happens only for a document whose tree exceeded
 * the walk depth. That fallback is deliberately the one citation the validator
 * is able to reject, so an under-indexed fact shows up as an invariant failure
 * instead of as a plausible line that means nothing. Returning no location at
 * all would be worse: it would let an unciteable fact into the graph.
 */
export function locationForPointer(
  index: JsonLocationIndex,
  source: string,
  pointer: string,
): SourceLocation {
  const found = index.get(pointer);
  if (found !== undefined) {
    return { ...found, pointer };
  }
  return { source, line: 1, pointer };
}

/** True when a pointer was actually indexed, as opposed to defaulted. */
export function hasPointerLocation(index: JsonLocationIndex, pointer: string): boolean {
  return index.has(pointer);
}
