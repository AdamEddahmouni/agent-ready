import type { Diagnostic, Severity } from "./types.js";

function severityLabel(severity: Severity): string {
  return severity === "error" ? "error" : "warning";
}

function renderOne(diagnostic: Diagnostic, indent = ""): string[] {
  const lines: string[] = [];
  const location =
    diagnostic.location !== undefined
      ? `:${String(diagnostic.location.line)}:${String(diagnostic.location.column)}`
      : "";
  const source =
    diagnostic.sourcePath !== undefined ? `${diagnostic.sourcePath}${location} - ` : "";

  lines.push(
    `${indent}${source}${severityLabel(diagnostic.severity)}[${diagnostic.code}]: ${diagnostic.summary}`,
  );

  if (diagnostic.field !== undefined) {
    lines.push(`${indent}  field: ${diagnostic.field}`);
  }
  if (diagnostic.detail !== undefined) {
    lines.push(`${indent}  ${diagnostic.detail}`);
  }
  if (diagnostic.remediation !== undefined) {
    lines.push(`${indent}  suggestion: ${diagnostic.remediation}`);
  }
  if (diagnostic.related !== undefined) {
    for (const related of diagnostic.related) {
      lines.push(...renderOne(related, `${indent}    `));
    }
  }
  return lines;
}

/**
 * Renders diagnostics as concise, human-readable text. Intentionally
 * designed output (not a raw object dump); JSON rendering is the
 * machine-consumable counterpart.
 */
export function renderDiagnosticsHuman(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "";
  }
  return diagnostics.flatMap((d) => renderOne(d)).join("\n");
}
