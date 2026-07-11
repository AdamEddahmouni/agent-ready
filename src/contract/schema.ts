import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { Diagnostic, DiagnosticResult, SourceLocation } from "../diagnostics/types.js";
import type { DiagnosticCode } from "../diagnostics/codes.js";
import { fail, ok } from "../diagnostics/types.js";
import type { RawContract } from "./types.js";

const schemaText = readFileSync(
  new URL("../../schemas/v1/agent-ready.schema.json", import.meta.url),
  "utf8",
);
export const AGENT_READY_SCHEMA: object = JSON.parse(schemaText) as object;

const ajv = new Ajv2020({ allErrors: true, strict: true });
let compiled: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  compiled ??= ajv.compile(AGENT_READY_SCHEMA);
  return compiled;
}

/**
 * Maps an ajv error's instance path to a friendlier, field-specific
 * diagnostic code. Everything not covered by a specific area falls back
 * to CONTRACT_SCHEMA_INVALID.
 */
function codeForInstancePath(instancePath: string): DiagnosticCode {
  if (instancePath === "/version") return "CONTRACT_SCHEMA_INVALID";
  if (instancePath.startsWith("/commands")) return "COMMAND_IDENTIFIER_INVALID";
  if (instancePath.startsWith("/environment/runtimes")) return "RUNTIME_DECLARATION_INVALID";
  if (instancePath.startsWith("/environment/packageManager")) return "PACKAGE_MANAGER_INVALID";
  if (instancePath.startsWith("/paths")) return "PATH_PATTERN_INVALID";
  if (instancePath.startsWith("/instructions")) return "INSTRUCTION_SOURCE_INVALID";
  if (instancePath.startsWith("/architecture")) return "ARCHITECTURE_DECISION_INVALID";
  if (instancePath.startsWith("/agents")) return "AGENT_CONTEXT_FILE_INVALID";
  if (instancePath.startsWith("/adapters")) return "ADAPTER_DECLARATION_INVALID";
  return "CONTRACT_SCHEMA_INVALID";
}

function toDiagnostic(
  error: ErrorObject,
  sourcePath: string,
  locate: (pointer: string) => SourceLocation | undefined,
): Diagnostic {
  const propertyName =
    error.keyword === "additionalProperties"
      ? (error.params as { additionalProperty?: string }).additionalProperty
      : undefined;
  const field =
    propertyName !== undefined
      ? `${error.instancePath}/${propertyName}`
      : error.instancePath || "/";

  return {
    code: codeForInstancePath(
      error.instancePath || (propertyName !== undefined ? `/${propertyName}` : ""),
    ),
    severity: "error",
    summary: `Schema validation failed at "${field}".`,
    detail:
      error.message !== undefined
        ? `${field}: ${error.message}`
        : `${field} failed schema validation.`,
    field,
    sourcePath,
    location: locate(field.startsWith("/") ? field : `/${field}`),
    remediation:
      "See docs/specification/contract-reference.md for the expected shape of this field.",
    metadata: { keyword: error.keyword, schemaPath: error.schemaPath },
  };
}

/**
 * Validates a parsed YAML value against the public Agent-Ready v1 JSON
 * Schema. This stage only checks structural/type validity; cross-field
 * semantic checks (e.g. verification references, path traversal) happen
 * in the semantic-validation stage.
 */
export function validateSchema(
  value: unknown,
  sourcePath: string,
  locate: (pointer: string) => SourceLocation | undefined,
): DiagnosticResult<RawContract> {
  const validate = getValidator();
  const valid = validate(value);
  if (!valid) {
    const errors = validate.errors ?? [];
    return fail(errors.map((error) => toDiagnostic(error, sourcePath, locate)));
  }
  return ok(value as RawContract, []);
}
