import { LineCounter, parseDocument } from "yaml";
import type { Document } from "yaml";
import type { Diagnostic, DiagnosticResult, SourceLocation } from "../diagnostics/types.js";
import { fail, ok } from "../diagnostics/types.js";

/**
 * Contract files larger than this are rejected before parsing. This is a
 * pure safety limit against pathological or accidental input, not a
 * meaningful size for a real contract (see docs/security/threat-model.md).
 */
export const MAX_CONTRACT_BYTES = 1_000_000;

/** Maximum AST nesting depth accepted before conversion to plain JS. */
export const DEFAULT_MAX_YAML_DEPTH = 100;

/**
 * YAML alias/anchor references are capped to guard against amplification
 * ("billion laughs") inputs. This mirrors the `yaml` package default.
 */
const MAX_ALIAS_COUNT = 100;

export interface ParsedContractSource {
  readonly value: unknown;
  /** Resolves a JSON Pointer (e.g. "/commands/lint/run") to its source location, if known. */
  readonly locate: (jsonPointer: string) => SourceLocation | undefined;
}

export interface ParseYamlOptions {
  /** Maximum YAML AST nesting depth. Defaults to 100. */
  readonly maxDepth?: number;
}

/**
 * Safely parses YAML source text into a plain JavaScript value.
 *
 * Safety properties (see docs/security/threat-model.md):
 *  - Duplicate mapping keys are rejected rather than silently taking the
 *    last value (YAML_DUPLICATE_KEY).
 *  - No custom or "unsafe" tags are resolved to executable types; the
 *    `yaml` package never evaluates code regardless of tag content.
 *  - Alias/anchor expansion is capped (MAX_ALIAS_COUNT) to prevent
 *    amplification attacks.
 *  - Oversized input is rejected before parsing (MAX_CONTRACT_BYTES).
 *  - Deeply nested input is rejected before conversion to plain JavaScript
 *    (DEFAULT_MAX_YAML_DEPTH).
 *  - No environment-variable interpolation, shell expansion, or remote/
 *    neighboring-file includes are performed; this parser only reads the
 *    exact bytes it is given.
 */
export function parseYaml(
  text: string,
  sourcePath: string,
  options: ParseYamlOptions = {},
): DiagnosticResult<ParsedContractSource> {
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > MAX_CONTRACT_BYTES) {
    return fail([
      {
        code: "CONTRACT_READ_FAILED",
        severity: "error",
        summary: "Contract file exceeds the maximum allowed size.",
        detail: `The contract is ${String(byteLength)} bytes, which exceeds the ${String(MAX_CONTRACT_BYTES)} byte limit.`,
        sourcePath,
        remediation:
          "Split configuration across documented instruction sources instead of growing the contract file.",
      },
    ]);
  }

  const lineCounter = new LineCounter();
  let document: Document;
  try {
    document = parseDocument(text, {
      uniqueKeys: true,
      strict: true,
      lineCounter,
      keepSourceTokens: true,
    });
  } catch (error) {
    return fail([
      {
        code: "YAML_PARSE_FAILED",
        severity: "error",
        summary: "Failed to parse contract as YAML.",
        detail: error instanceof Error ? error.message : "Unknown parser error.",
        sourcePath,
        remediation: "Fix the YAML syntax error and try again.",
      },
    ]);
  }

  if (document.errors.length > 0) {
    return fail(
      document.errors.map((error): Diagnostic => {
        const isDuplicateKey = error.message.includes("Map keys must be unique");
        return {
          code: isDuplicateKey ? "YAML_DUPLICATE_KEY" : "YAML_PARSE_FAILED",
          severity: "error",
          summary: isDuplicateKey
            ? "Duplicate mapping key in contract."
            : "Failed to parse contract as YAML.",
          detail: error.message,
          sourcePath,
          location:
            error.linePos !== undefined
              ? { line: error.linePos[0].line, column: error.linePos[0].col }
              : undefined,
          remediation: isDuplicateKey
            ? "Remove or rename the duplicate key so each mapping key appears once."
            : "Fix the YAML syntax error and try again.",
        };
      }),
    );
  }

  const maxDepth = options.maxDepth ?? DEFAULT_MAX_YAML_DEPTH;
  const observedDepth = measureYamlDepth(document.contents);
  if (observedDepth > maxDepth) {
    return fail([
      {
        code: "YAML_NESTING_TOO_DEEP",
        severity: "error",
        summary: "Contract YAML exceeds the maximum nesting depth.",
        detail: `The document reaches depth ${String(observedDepth)}, which exceeds the configured limit of ${String(maxDepth)}.`,
        sourcePath,
        remediation:
          "Flatten the contract structure or move long-form guidance into declared instruction sources.",
        metadata: { observedDepth, maxDepth },
      },
    ]);
  }

  const value: unknown = document.toJS({ mapAsMap: false, maxAliasCount: MAX_ALIAS_COUNT });

  const locate = (jsonPointer: string): SourceLocation | undefined => {
    const path = jsonPointerToPath(jsonPointer);
    if (path.length === 0) {
      return undefined;
    }
    let node: unknown;
    try {
      node = document.getIn(path, true);
    } catch {
      return undefined;
    }
    if (
      node === null ||
      typeof node !== "object" ||
      !("range" in node) ||
      !Array.isArray((node as { range?: unknown }).range)
    ) {
      return undefined;
    }
    const range = (node as { range: number[] }).range;
    const offset = range[0];
    if (offset === undefined) {
      return undefined;
    }
    const pos = lineCounter.linePos(offset);
    return { line: pos.line, column: pos.col };
  };

  return ok({ value, locate }, []);
}

/**
 * Measures parser-node depth iteratively so the guard itself cannot overflow
 * the JavaScript call stack on adversarial input. Pair wrappers do not add an
 * extra level; their key and value occupy the next level below the mapping.
 */
function measureYamlDepth(root: unknown): number {
  if (root === null || typeof root !== "object") return 0;

  let maximum = 0;
  const stack: { readonly node: unknown; readonly depth: number }[] = [{ node: root, depth: 1 }];
  const visited = new WeakSet();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    maximum = Math.max(maximum, current.depth);
    if (current.node === null || typeof current.node !== "object") continue;
    if (visited.has(current.node)) continue;
    visited.add(current.node);

    const candidate = current.node as {
      readonly items?: readonly unknown[];
      readonly key?: unknown;
      readonly value?: unknown;
    };
    if (Array.isArray(candidate.items)) {
      for (const item of candidate.items) {
        if (item === null || typeof item !== "object") continue;
        const pair = item as { readonly key?: unknown; readonly value?: unknown };
        if ("key" in pair || "value" in pair) {
          if (pair.key !== undefined) stack.push({ node: pair.key, depth: current.depth + 1 });
          if (pair.value !== undefined) stack.push({ node: pair.value, depth: current.depth + 1 });
        } else {
          stack.push({ node: item, depth: current.depth + 1 });
        }
      }
    }
  }

  return maximum;
}

function jsonPointerToPath(pointer: string): (string | number)[] {
  if (pointer === "" || pointer === "/") {
    return [];
  }
  const segments = pointer.split("/").slice(1);
  return segments.map((segment) => {
    const unescaped = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    return /^\d+$/.test(unescaped) ? Number(unescaped) : unescaped;
  });
}
