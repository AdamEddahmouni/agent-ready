/**
 * Stable, documented diagnostic codes. These strings are part of the public
 * contract: CI consumers may match on them and must not need to parse human
 * message wording. See docs/specification/diagnostics.md for the full
 * reference, including remediation guidance for each code.
 */
export const DIAGNOSTIC_CODES = [
  "CONTRACT_NOT_FOUND",
  "CONTRACT_READ_FAILED",
  "YAML_PARSE_FAILED",
  "YAML_DUPLICATE_KEY",
  "YAML_NESTING_TOO_DEEP",
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
  "ARCHITECTURE_DECISION_INVALID",
  "AGENT_CONTEXT_FILE_INVALID",
  "ADAPTER_DECLARATION_INVALID",
  "NORMALIZATION_FAILED",
  "INTERNAL_INVARIANT_VIOLATION",
  "GENERATE_TARGET_UNMANAGED",
  "GENERATE_WRITE_FAILED",
  "GENERATED_FILES_OUT_OF_DATE",
  "GENERATE_OUTSIDE_REPO_ROOT",
  "ADAPTER_NOT_YET_IMPLEMENTED",
  "PROTECTED_PATH_MODIFIED",
  "GIT_UNAVAILABLE",
  "GIT_REPOSITORY_NOT_FOUND",
  "VERIFICATION_NOT_DECLARED",
  "VERIFICATION_COMMAND_FAILED",
  "VERIFICATION_COMMAND_TIMEOUT",
  "VERIFICATION_COMMAND_TERMINATION_FAILED",
  "VERIFICATION_COMMAND_SPAWN_FAILED",
  "VERIFICATION_RECORD_WRITE_FAILED",
  "HANDOFF_FILE_INVALID",
  "HANDOFF_FIELD_TOO_LONG",
  "DOCUMENTATION_SOURCE_READ_FAILED",
  "DOCUMENTATION_LINK_CHECK_FAILED",
  "DOCUMENTATION_LINK_BROKEN",
  "DOCUMENTATION_LINK_OUTSIDE_REPOSITORY",
  "INSTRUCTION_SOURCE_TOO_LARGE",
  "RUNTIME_VERSION_MISMATCH",
  "RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED",
  "PACKAGE_MANAGER_UNAVAILABLE",
  "PACKAGE_MANAGER_VERSION_MISMATCH",
  "GIT_REQUIRED_BUT_UNAVAILABLE",
  "INIT_CONTRACT_EXISTS",
  "UPGRADE_NO_CHANGES_NEEDED",
  "UPGRADE_MANUAL_REVIEW_REQUIRED",
  "UPGRADE_WRITE_FAILED",
  // Repository discovery (ADR-0044, extended by ADR-0045). Reserved namespace
  // for `discover` and the discovery core.
  //
  // DISCOVERY_FACT_UNSUPPORTED was reserved in ADR-0044 and became reachable in
  // ADR-0045: it now reports a fact whose *shape* this implementation does not
  // model (a `packageManager` field that is not `<name>@<version>`), rather than
  // a kind outside the four defined kinds. The four epistemic kinds are
  // unchanged; no fifth kind exists.
  "DISCOVERY_ROOT_UNREADABLE",
  "DISCOVERY_PARTIAL",
  "DISCOVERY_FACT_CONFLICT",
  "DISCOVERY_FACT_INCOMPLETE",
  "DISCOVERY_WORKSPACE_UNSUPPORTED",
  "DISCOVERY_LOCKFILE_UNREADABLE",
  "DISCOVERY_NO_SIGNALS",
  "DISCOVERY_FACT_UNSUPPORTED",
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

/**
 * The codes emitted as `severity: "warning"` rather than `"error"`.
 *
 * Warning diagnostics describe a real condition that must not fail the
 * command: an enabled-but-unimplemented adapter, a contract with nothing to
 * verify, a runtime doctor does not probe yet, an upgrade that is a no-op, and
 * the discovery conditions that leave a snapshot usable but incomplete or
 * empty. Every other code is an error.
 *
 * This is a single source of truth on purpose. The list used to be restated
 * inside `agent-ready explain`, which meant a newly registered informational
 * code was reported by `explain` with the wrong severity until someone
 * remembered to edit a second list. `explain` now derives from here, and a
 * unit test asserts the two never diverge.
 */
export const WARNING_DIAGNOSTIC_CODES = [
  "ADAPTER_NOT_YET_IMPLEMENTED",
  "VERIFICATION_NOT_DECLARED",
  "RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED",
  "UPGRADE_NO_CHANGES_NEEDED",
  "UPGRADE_MANUAL_REVIEW_REQUIRED",
  "DISCOVERY_PARTIAL",
  "DISCOVERY_FACT_CONFLICT",
  "DISCOVERY_FACT_INCOMPLETE",
  "DISCOVERY_WORKSPACE_UNSUPPORTED",
  "DISCOVERY_LOCKFILE_UNREADABLE",
  "DISCOVERY_NO_SIGNALS",
  "DISCOVERY_FACT_UNSUPPORTED",
] as const satisfies readonly DiagnosticCode[];

export type WarningDiagnosticCode = (typeof WARNING_DIAGNOSTIC_CODES)[number];

/** True when the code is documented as informational rather than fatal. */
export function isWarningDiagnosticCode(code: DiagnosticCode): boolean {
  return (WARNING_DIAGNOSTIC_CODES as readonly string[]).includes(code);
}

export function isDiagnosticCode(value: string): value is DiagnosticCode {
  return (DIAGNOSTIC_CODES as readonly string[]).includes(value);
}
