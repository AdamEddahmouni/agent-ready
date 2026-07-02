import type { Diagnostic } from "./types.js";

/**
 * Stable process exit codes. Structured diagnostic codes provide detailed
 * machine distinction; exit codes intentionally stay coarse so scripts can
 * branch on outcome category without enumerating every diagnostic code.
 */
export const ExitCode = {
  SUCCESS: 0,
  VALIDATION_FAILED: 1,
  CONTRACT_NOT_FOUND: 2,
  UNSUPPORTED_VERSION: 3,
  INTERNAL_ERROR: 10,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Maps a set of diagnostics to a single exit code. When diagnostics span
 * multiple categories, the most specific/severe category wins, in this
 * precedence order: internal error > contract not found > unsupported
 * version > validation failure > success.
 */
export function resolveExitCode(diagnostics: readonly Diagnostic[]): ExitCode {
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length === 0) {
    return ExitCode.SUCCESS;
  }

  if (
    errors.some(
      (d) =>
        d.code === "INTERNAL_INVARIANT_VIOLATION" ||
        d.code === "GENERATE_WRITE_FAILED" ||
        d.code === "GENERATE_OUTSIDE_REPO_ROOT",
    )
  ) {
    return ExitCode.INTERNAL_ERROR;
  }

  if (errors.some((d) => d.code === "CONTRACT_NOT_FOUND" || d.code === "CONTRACT_READ_FAILED")) {
    return ExitCode.CONTRACT_NOT_FOUND;
  }

  if (errors.some((d) => d.code === "CONTRACT_VERSION_UNSUPPORTED")) {
    return ExitCode.UNSUPPORTED_VERSION;
  }

  return ExitCode.VALIDATION_FAILED;
}
