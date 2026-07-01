import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_CODES, isDiagnosticCode } from "../../src/diagnostics/codes.js";
import { renderDiagnosticsHuman } from "../../src/diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../src/diagnostics/jsonRender.js";
import { ExitCode, resolveExitCode } from "../../src/diagnostics/exitCodes.js";
import type { Diagnostic } from "../../src/diagnostics/types.js";

describe("diagnostic codes", () => {
  it("includes every code required by the specification", () => {
    const required = [
      "CONTRACT_NOT_FOUND",
      "CONTRACT_READ_FAILED",
      "YAML_PARSE_FAILED",
      "YAML_DUPLICATE_KEY",
      "CONTRACT_SCHEMA_INVALID",
      "CONTRACT_VERSION_UNSUPPORTED",
      "COMMAND_IDENTIFIER_INVALID",
      "COMMAND_REFERENCE_INVALID",
      "COMMAND_DUPLICATE",
      "RUNTIME_DECLARATION_INVALID",
      "PACKAGE_MANAGER_INVALID",
      "PATH_PATTERN_INVALID",
      "PATH_ABSOLUTE_DISALLOWED",
      "PATH_TRAVERSAL_DISALLOWED",
      "PATH_CATEGORY_CONFLICT",
      "INSTRUCTION_SOURCE_INVALID",
      "ADAPTER_DECLARATION_INVALID",
      "NORMALIZATION_FAILED",
      "INTERNAL_INVARIANT_VIOLATION",
    ];
    for (const code of required) {
      expect(DIAGNOSTIC_CODES).toContain(code);
    }
  });

  it("isDiagnosticCode recognizes valid and invalid codes", () => {
    expect(isDiagnosticCode("CONTRACT_NOT_FOUND")).toBe(true);
    expect(isDiagnosticCode("NOT_A_REAL_CODE")).toBe(false);
  });
});

describe("renderDiagnosticsHuman", () => {
  it("renders an empty list as an empty string", () => {
    expect(renderDiagnosticsHuman([])).toBe("");
  });

  it("includes code, summary, and remediation", () => {
    const diagnostic: Diagnostic = {
      code: "CONTRACT_NOT_FOUND",
      severity: "error",
      summary: "No contract found.",
      remediation: "Create one.",
    };
    const rendered = renderDiagnosticsHuman([diagnostic]);
    expect(rendered).toContain("CONTRACT_NOT_FOUND");
    expect(rendered).toContain("No contract found.");
    expect(rendered).toContain("Create one.");
  });

  it("includes source path and location when present", () => {
    const diagnostic: Diagnostic = {
      code: "YAML_PARSE_FAILED",
      severity: "error",
      summary: "Bad YAML.",
      sourcePath: "/repo/agent-ready.yaml",
      location: { line: 3, column: 5 },
    };
    const rendered = renderDiagnosticsHuman([diagnostic]);
    expect(rendered).toContain("/repo/agent-ready.yaml:3:5");
  });
});

describe("renderDiagnosticsJson", () => {
  it("produces a stable, serializable shape", () => {
    const diagnostic: Diagnostic = {
      code: "CONTRACT_NOT_FOUND",
      severity: "error",
      summary: "No contract found.",
    };
    const json = renderDiagnosticsJson([diagnostic]);
    expect(JSON.parse(JSON.stringify(json))).toEqual([
      { code: "CONTRACT_NOT_FOUND", severity: "error", summary: "No contract found." },
    ]);
  });
});

describe("resolveExitCode", () => {
  it("returns SUCCESS for no diagnostics", () => {
    expect(resolveExitCode([])).toBe(ExitCode.SUCCESS);
  });

  it("returns SUCCESS when only warnings are present", () => {
    const warning: Diagnostic = {
      code: "CONTRACT_SCHEMA_INVALID",
      severity: "warning",
      summary: "x",
    };
    expect(resolveExitCode([warning])).toBe(ExitCode.SUCCESS);
  });

  it("returns CONTRACT_NOT_FOUND for a not-found error", () => {
    const diagnostic: Diagnostic = { code: "CONTRACT_NOT_FOUND", severity: "error", summary: "x" };
    expect(resolveExitCode([diagnostic])).toBe(ExitCode.CONTRACT_NOT_FOUND);
  });

  it("returns UNSUPPORTED_VERSION for an unsupported-version error", () => {
    const diagnostic: Diagnostic = {
      code: "CONTRACT_VERSION_UNSUPPORTED",
      severity: "error",
      summary: "x",
    };
    expect(resolveExitCode([diagnostic])).toBe(ExitCode.UNSUPPORTED_VERSION);
  });

  it("returns VALIDATION_FAILED for a generic schema error", () => {
    const diagnostic: Diagnostic = {
      code: "CONTRACT_SCHEMA_INVALID",
      severity: "error",
      summary: "x",
    };
    expect(resolveExitCode([diagnostic])).toBe(ExitCode.VALIDATION_FAILED);
  });

  it("returns INTERNAL_ERROR for an internal invariant violation", () => {
    const diagnostic: Diagnostic = {
      code: "INTERNAL_INVARIANT_VIOLATION",
      severity: "error",
      summary: "x",
    };
    expect(resolveExitCode([diagnostic])).toBe(ExitCode.INTERNAL_ERROR);
  });

  it("prioritizes internal error over other categories when mixed", () => {
    const diagnostics: Diagnostic[] = [
      { code: "CONTRACT_SCHEMA_INVALID", severity: "error", summary: "x" },
      { code: "INTERNAL_INVARIANT_VIOLATION", severity: "error", summary: "y" },
    ];
    expect(resolveExitCode(diagnostics)).toBe(ExitCode.INTERNAL_ERROR);
  });
});
