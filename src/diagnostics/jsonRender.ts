import type { Diagnostic } from "./types.js";

export interface DiagnosticJson {
  readonly code: string;
  readonly severity: string;
  readonly summary: string;
  readonly detail?: string;
  readonly field?: string;
  readonly sourcePath?: string;
  readonly location?: { readonly line: number; readonly column: number };
  readonly remediation?: string;
  readonly related?: readonly DiagnosticJson[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function toJson(diagnostic: Diagnostic): DiagnosticJson {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    summary: diagnostic.summary,
    ...(diagnostic.detail !== undefined && { detail: diagnostic.detail }),
    ...(diagnostic.field !== undefined && { field: diagnostic.field }),
    ...(diagnostic.sourcePath !== undefined && { sourcePath: diagnostic.sourcePath }),
    ...(diagnostic.location !== undefined && { location: diagnostic.location }),
    ...(diagnostic.remediation !== undefined && { remediation: diagnostic.remediation }),
    ...(diagnostic.related !== undefined && { related: diagnostic.related.map(toJson) }),
    ...(diagnostic.metadata !== undefined && { metadata: diagnostic.metadata }),
  };
}

/**
 * Renders diagnostics into a stable, serializable shape for `--json` output.
 */
export function renderDiagnosticsJson(
  diagnostics: readonly Diagnostic[],
): readonly DiagnosticJson[] {
  return diagnostics.map(toJson);
}
