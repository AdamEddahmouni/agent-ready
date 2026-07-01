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
 *  - No environment-variable interpolation, shell expansion, or remote/
 *    neighboring-file includes are performed; this parser only reads the
 *    exact bytes it is given.
 */
export function parseYaml(
  text: string,
  sourcePath: string,
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
