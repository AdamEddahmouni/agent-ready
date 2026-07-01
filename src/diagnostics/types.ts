import type { DiagnosticCode } from "./codes.js";

export type Severity = "error" | "warning";

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

/**
 * A single structured diagnostic. Diagnostics are produced by every
 * pipeline stage (parsing, schema validation, semantic validation,
 * normalization) before any human- or machine-readable rendering occurs.
 */
export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  /** Short, single-line statement of the problem. */
  readonly summary: string;
  /** Longer explanation of why this is a problem. */
  readonly detail?: string;
  /** Contract field the diagnostic relates to, as a JSON Pointer (e.g. "/commands/lint"). */
  readonly field?: string;
  /** Repository-relative path to the source file the diagnostic concerns. */
  readonly sourcePath?: string;
  readonly location?: SourceLocation;
  /** Actionable suggestion for resolving the diagnostic. */
  readonly remediation?: string;
  readonly related?: readonly Diagnostic[];
  /** Machine-readable metadata for tooling; must not contain secrets or full environment state. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type DiagnosticResult<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export function ok<T>(value: T, diagnostics: readonly Diagnostic[] = []): DiagnosticResult<T> {
  return { ok: true, value, diagnostics };
}

export function fail<T>(diagnostics: readonly Diagnostic[]): DiagnosticResult<T> {
  return { ok: false, diagnostics };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
