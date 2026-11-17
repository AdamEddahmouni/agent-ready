/**
 * Reading import declarations out of a source file (ADR-0047 §10).
 *
 * Parsed, never matched. `import`, `export … from`, `import(`, `require`, a
 * comment that says "import", and a string literal containing all of those make
 * a regex untrustworthy, and an untrustworthy import extractor produces a graph
 * that is wrong without ever saying so. TypeScript's parser is already a project
 * dependency and hands back exact source positions as a by-product, which is
 * what makes "the line the specifier is on" a fact rather than a search result.
 *
 * Nothing here is executed. The file is parsed as text into a syntax tree; a
 * source file containing `throw new Error("PWNED")` is a syntax tree and
 * nothing else, and there is no `eval`, no `Function`, and no dynamic import of
 * repository content anywhere in this path (ADR-0047, and ADR-0046 §2's rule
 * that a repository's declarations are data, never instructions).
 */

import ts from "typescript";
import { compareCodeUnits } from "../ordering.js";
import { MAX_IMPORTS_PER_FILE } from "./sourceUniverse.js";
import { locationFromNode, type LineIndexCache } from "./provenance.js";
import type { ImportSyntax, SourceLocation, UnresolvedReason } from "./types.js";

/**
 * One import declaration, before resolution.
 *
 * `provenance` is the span of the **module specifier literal**, not of the
 * statement. `"import { x } from './x.js'"` cited at the `import` keyword is a
 * real line, but it is not the line a reader needs to see to check the claim
 * that this specifier was written here; the span of the specifier is.
 */
export interface ExtractedImport {
  readonly specifier: string;
  readonly syntax: ImportSyntax;
  readonly typeOnly: boolean;
  readonly provenance: SourceLocation;
  /**
   * Set when the declaration is visible but this version declines to model it.
   *
   * A declaration with a reason becomes an unresolved edge carrying that reason,
   * so `require("./x")` is visible in the graph as something that was looked at
   * and not interpreted — rather than disappearing, which is the one outcome
   * this project refuses outright.
   */
  readonly unsupportedReason: UnresolvedReason | null;
}

/** What extracting imports from one file produced. */
export interface ExtractedImports {
  readonly imports: readonly ExtractedImport[];
  /** True when the file has syntax diagnostics, so extraction is partial. */
  readonly partial: boolean;
  /** How many syntax diagnostics the parser reported, for the diagnostic text. */
  readonly diagnosticCount: number;
  /** True when the per-file import bound stopped extraction. */
  readonly truncated: boolean;
}

/** Parses one source file and extracts every import declaration it contains. */
export function extractImports(
  path: string,
  text: string,
  cache: LineIndexCache,
): ExtractedImports {
  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    false,
    scriptKindOf(path),
  );
  const found: ExtractedImport[] = [];

  for (const statement of sourceFile.statements) {
    collectFromStatement(statement, path, sourceFile, cache, found);
  }

  const syntax = syntaxDiagnosticsOf(sourceFile);
  const sorted = found.sort(compareImports);
  const truncated = sorted.length > MAX_IMPORTS_PER_FILE;
  return {
    imports: truncated ? sorted.slice(0, MAX_IMPORTS_PER_FILE) : sorted,
    partial: syntax.length > 0,
    diagnosticCount: syntax.length,
    truncated,
  };
}

/**
 * The parser's syntax diagnostics for one file.
 *
 * TypeScript attaches them to the source file but does not publish the field in
 * its type, so this is the one cast in the file and it is here rather than
 * scattered across call sites. It reads a field the parser always sets; a
 * missing field yields an empty list, which downgrades to "no syntax problems"
 * rather than to a crash.
 *
 * Syntax diagnostics are **not** type errors. A file that does not typecheck is
 * still a file whose imports were parsed correctly, and treating a type problem
 * as a graph problem would report a repository condition as an Agent-Ready
 * failure.
 */
function syntaxDiagnosticsOf(sourceFile: ts.SourceFile): readonly unknown[] {
  const carrier = sourceFile as unknown as { readonly parseDiagnostics?: readonly unknown[] };
  return carrier.parseDiagnostics ?? [];
}

/**
 * The parser kind for a supported source extension.
 *
 * `.tsx` and `.jsx` get their JSX-aware kinds because a `<T>` cast would
 * otherwise be a parse error, and `.mts`/`.cts`/`.mjs`/`.cjs` are the modern
 * ESM/CJS forms. Every extension this function does not know about is
 * unreachable: `sourceExtensionOf` already excluded them from the universe.
 */
function scriptKindOf(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/**
 * Collects declarations from one top-level statement.
 *
 * `require` and `import()` are found by a bounded recursive walk rather than at
 * the top level, because a dynamic import can appear anywhere in a function
 * body. The walk has a depth bound: a repository that nests calls arbitrarily
 * deep is a repository whose imports are not a flat list, and an unbounded walk
 * would make the cost of one file unknowable.
 */
function collectFromStatement(
  statement: ts.Statement,
  path: string,
  sourceFile: ts.SourceFile,
  cache: LineIndexCache,
  into: ExtractedImport[],
): void {
  if (ts.isImportDeclaration(statement)) {
    const literal = moduleSpecifierOf(statement.moduleSpecifier);
    if (literal === undefined) {
      return;
    }
    into.push(
      toExtracted(literal, "import", isTypeOnlyImport(statement), path, sourceFile, cache, null),
    );
    return;
  }
  if (ts.isExportDeclaration(statement)) {
    if (statement.moduleSpecifier === undefined) {
      // `export { x }` names a local binding; it creates no module relationship.
      return;
    }
    const literal = moduleSpecifierOf(statement.moduleSpecifier);
    if (literal === undefined) {
      return;
    }
    into.push(
      toExtracted(
        literal,
        "re-export",
        isTypeOnlyDeclaration(statement),
        path,
        sourceFile,
        cache,
        null,
      ),
    );
    return;
  }
  if (ts.isImportEqualsDeclaration(statement)) {
    const reference = statement.moduleReference;
    if (!ts.isExternalModuleReference(reference)) {
      return;
    }
    const literal = moduleSpecifierOf(reference.expression);
    if (literal === undefined) {
      // `import x = require(someExpression)` has no specifier to cite. The
      // declaration is real and is recorded as one, at the `require` keyword, so
      // the reader sees that a relationship exists and that it is not resolved.
      into.push(
        toExtractedAt(
          statement,
          "[computed]",
          "import-equals",
          true,
          path,
          sourceFile,
          cache,
          "unsupported-syntax",
        ),
      );
      return;
    }
    into.push(
      toExtracted(literal, "import-equals", true, path, sourceFile, cache, "unsupported-syntax"),
    );
    return;
  }
  walkForCalls(statement, path, sourceFile, cache, into, 0);
}

/** How deep a dynamic-`import`/`require` search descends into one statement. */
const MAX_CALL_WALK_DEPTH = 24;

function walkForCalls(
  node: ts.Node,
  path: string,
  sourceFile: ts.SourceFile,
  cache: LineIndexCache,
  into: ExtractedImport[],
  depth: number,
): void {
  if (depth > MAX_CALL_WALK_DEPTH) {
    return;
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (callee.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      const literal = argument === undefined ? undefined : stringLiteralOf(argument);
      if (literal === undefined) {
        into.push(
          toExtractedAt(
            node,
            "[computed]",
            "dynamic-import",
            false,
            path,
            sourceFile,
            cache,
            "unsupported-syntax",
          ),
        );
        return;
      }
      into.push(toExtracted(literal, "dynamic-import", false, path, sourceFile, cache, null));
      return;
    }
    if (ts.isIdentifier(callee) && callee.text === "require") {
      const [argument] = node.arguments;
      const literal = argument === undefined ? undefined : stringLiteralOf(argument);
      if (literal === undefined) {
        into.push(
          toExtractedAt(
            node,
            "[computed]",
            "require",
            false,
            path,
            sourceFile,
            cache,
            "unsupported-syntax",
          ),
        );
        return;
      }
      // CommonJS `require` is outside initial scope. A `require` in a
      // TypeScript file is rare enough that supporting it buys little, and
      // supporting it *wrongly* is the class of confident error this project
      // refuses. The declaration stays visible as an unresolved edge.
      into.push(
        toExtracted(literal, "require", false, path, sourceFile, cache, "unsupported-syntax"),
      );
      return;
    }
  }
  for (const child of node.getChildren(sourceFile)) {
    walkForCalls(child, path, sourceFile, cache, into, depth + 1);
  }
}

function toExtracted(
  literal: ts.StringLiteralLike,
  syntax: ImportSyntax,
  typeOnly: boolean,
  path: string,
  sourceFile: ts.SourceFile,
  cache: LineIndexCache,
  unsupportedReason: UnresolvedReason | null,
): ExtractedImport {
  return {
    specifier: literal.text,
    syntax,
    typeOnly,
    provenance: locationFromNode(cache, path, literal.getStart(sourceFile), literal.end),
    unsupportedReason,
  };
}

/**
 * A declaration with no specifier literal, cited at the call or statement.
 *
 * Used only for the computed forms, where the honest provenance is the
 * declaration itself: "here is where the repository asked for something this
 * version cannot resolve", rather than a fabricated specifier string.
 */
function toExtractedAt(
  node: ts.Node,
  specifier: string,
  syntax: ImportSyntax,
  typeOnly: boolean,
  path: string,
  sourceFile: ts.SourceFile,
  cache: LineIndexCache,
  unsupportedReason: UnresolvedReason | null,
): ExtractedImport {
  return {
    specifier,
    syntax,
    typeOnly,
    provenance: locationFromNode(cache, path, node.getStart(sourceFile), node.end),
    unsupportedReason,
  };
}

/**
 * Whether an import declaration was written with `import type`.
 *
 * Reads the clause's phase modifier, which is what the grammar records in
 * current TypeScript. Either way the answer is a *syntactic* fact about how the
 * declaration was written — never an inference from what was bound, which would
 * be the kind of read-the-name heuristic ADR-0046 rejects for commands.
 */
function isTypeOnlyImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (clause === undefined) {
    // `import "./setup.js"` binds nothing and is not type-only.
    return false;
  }
  return clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
}

/** The same question for `export … from`. */
function isTypeOnlyDeclaration(statement: ts.ExportDeclaration): boolean {
  return statement.isTypeOnly;
}

/** A module specifier, when it is a plain string. */
function moduleSpecifierOf(expression: ts.Expression): ts.StringLiteralLike | undefined {
  return ts.isStringLiteralLike(expression) ? expression : undefined;
}

/**
 * A string argument, when it is a plain string literal.
 *
 * A no-substitution template literal is deliberately **not** accepted: it is a
 * distinct syntax, accepting it here would mean claiming support for template
 * semantics this issue does not model, and the cost of declining is one
 * `unsupported-syntax` edge that a reader can see.
 */
function stringLiteralOf(expression: ts.Expression): ts.StringLiteralLike | undefined {
  return ts.isStringLiteral(expression) ? expression : undefined;
}

/**
 * Code-unit order by position, then by specifier.
 *
 * Position first so two declarations of the same specifier keep their own
 * distinct citations in source order; the specifier tiebreak makes the order
 * total when a parser reports two nodes at the same offset, which keeps the
 * graph byte-identical rather than merely usually-stable.
 */
function compareImports(a: ExtractedImport, b: ExtractedImport): number {
  return (
    a.provenance.line - b.provenance.line ||
    (a.provenance.column ?? 0) - (b.provenance.column ?? 0) ||
    compareCodeUnits(a.specifier, b.specifier)
  );
}
