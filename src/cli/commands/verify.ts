import { loadContract } from "../../contract/pipeline.js";
import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../diagnostics/jsonRender.js";
import { ExitCode, resolveExitCode } from "../../diagnostics/exitCodes.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import { joinPath } from "../../filesystem/pathJoin.js";
import { FileSystemError } from "../../filesystem/types.js";
import type { FileSystem } from "../../filesystem/types.js";
import type { CommandOutcome, CommandOutcomeStatus, CommandRunner } from "../../verify/types.js";
import type { CliOutcome } from "./validate.js";
import { checkGeneratedFiles } from "../../generate/check.js";
import type { GenerateCheckFile } from "../../generate/check.js";
import { readHandoff } from "../../verify/handoff.js";
import type { HandoffEvidence } from "../../verify/handoff.js";

export const DEFAULT_VERIFY_TIMEOUT_SECONDS = 900;

/**
 * Hardcoded, repo-root-relative filename for `verify --execute --record`'s
 * evidence output. Never contract-supplied and never a subdirectory
 * (FileSystem.writeTextFile deliberately has no mkdir — see ADR-0010 and
 * ADR-0015).
 */
export const VERIFICATION_RECORD_FILENAME = "agent-ready-verify-result.json";

export interface VerifyArgs {
  readonly json: boolean;
  readonly config?: string;
  readonly execute: boolean;
  readonly timeoutSeconds?: number;
  readonly record?: boolean;
  readonly handoffPath?: string;
  readonly checkGenerate?: boolean;
}

type VerifyMode = "dry-run" | "execute";

interface CommandReport {
  readonly id: string;
  readonly run: string;
  readonly status: CommandOutcomeStatus | "planned";
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly timeoutSeconds?: number;
}

interface FinishContext {
  readonly contractPath?: string;
  readonly repoRoot?: string;
  readonly reports?: readonly CommandReport[];
  readonly handoff?: HandoffEvidence;
  readonly generatePreflight?: {
    readonly ok: boolean;
    readonly files: readonly PreflightFile[];
  };
}

type PreflightFile = Omit<GenerateCheckFile, "content">;

/**
 * Runs the contract's `verification.required` commands, in declared order.
 * Defaults to a dry run — nothing is spawned unless `--execute` is passed
 * (see ADR-0014). This is the only code path in Agent-Ready that executes
 * contract-declared `run` strings; `validate`/`inspect`/`generate`/`check`
 * are unaffected.
 */
export async function runVerify(
  fs: FileSystem,
  commandRunner: CommandRunner,
  args: VerifyArgs,
  startDir?: string,
  now: () => Date = () => new Date(),
): Promise<CliOutcome> {
  const mode: VerifyMode = args.execute ? "execute" : "dry-run";

  if (
    args.timeoutSeconds !== undefined &&
    (!Number.isInteger(args.timeoutSeconds) ||
      args.timeoutSeconds < 1 ||
      args.timeoutSeconds > 3600)
  ) {
    const message = "--timeout must be an integer from 1 through 3600 seconds.";
    return args.json
      ? {
          exitCode: ExitCode.VALIDATION_FAILED,
          stdout: JSON.stringify({ ok: false, error: message }, null, 2) + "\n",
          stderr: "",
        }
      : {
          exitCode: ExitCode.VALIDATION_FAILED,
          stdout: "",
          stderr: `agent-ready verify: ${message}\n`,
        };
  }

  if (args.record === true && !args.execute) {
    const message = "--record requires --execute (there is nothing to record from a dry run).";
    if (args.json) {
      const body = { ok: false, error: message };
      return {
        exitCode: ExitCode.VALIDATION_FAILED,
        stdout: JSON.stringify(body, null, 2) + "\n",
        stderr: "",
      };
    }
    return {
      exitCode: ExitCode.VALIDATION_FAILED,
      stdout: "",
      stderr: `agent-ready verify: ${message}\n`,
    };
  }
  if ((args.handoffPath !== undefined || args.checkGenerate === true) && !args.execute) {
    const option = args.handoffPath !== undefined ? "--handoff" : "--check-generate";
    const message = `${option} requires --execute.`;
    return args.json
      ? {
          exitCode: ExitCode.VALIDATION_FAILED,
          stdout: JSON.stringify({ ok: false, error: message }, null, 2) + "\n",
          stderr: "",
        }
      : {
          exitCode: ExitCode.VALIDATION_FAILED,
          stdout: "",
          stderr: `agent-ready verify: ${message}\n`,
        };
  }

  const result = await loadContract({
    fs,
    startDir,
    ...(args.config !== undefined && { explicitConfigPath: args.config }),
  });

  if (!result.ok) {
    return finish(fs, mode, args, now, result.diagnostics);
  }

  const { contract, repoRoot, contractPath } = result.value;
  const diagnostics: Diagnostic[] = [...result.diagnostics];
  let handoff: HandoffEvidence | undefined;
  if (args.handoffPath !== undefined) {
    const handoffPath = isAbsolutePath(args.handoffPath)
      ? args.handoffPath
      : joinPath(fs.cwd, args.handoffPath);
    const handoffResult = await readHandoff(fs, handoffPath);
    if (!handoffResult.ok) {
      return finish(fs, mode, args, now, [...diagnostics, ...handoffResult.diagnostics], {
        contractPath,
        repoRoot,
        reports: [],
      });
    }
    handoff = handoffResult.value;
  }

  const commandsById = new Map(contract.commands.map((c) => [c.name, c]));
  const toRun = contract.verification.required.map((id) => {
    const command = commandsById.get(id);
    // Guaranteed to exist: semantic validation already rejects a
    // verification.required entry that doesn't reference a declared
    // command (COMMAND_REFERENCE_INVALID), so loadContract would have
    // failed above otherwise.
    return {
      id,
      run: command?.run ?? "",
      description: command?.description,
      timeout: command?.timeout,
    };
  });

  if (toRun.length === 0) {
    let emptyPreflight: FinishContext["generatePreflight"];
    if (mode === "execute" && args.checkGenerate === true) {
      const checked = await checkGeneratedFiles(fs, contract, repoRoot);
      diagnostics.push(...checked.diagnostics);
      emptyPreflight = { ok: checked.ok, files: toPreflightFiles(checked.files) };
      if (!checked.ok) diagnostics.push(generateDriftDiagnostic());
    }
    diagnostics.push({
      code: "VERIFICATION_NOT_DECLARED",
      severity: "warning",
      summary: "The contract declares no verification.required commands.",
      remediation:
        "Add a verification.required list to agent-ready.yaml to enable `agent-ready verify`.",
    });
    return finish(fs, mode, args, now, diagnostics, {
      contractPath,
      repoRoot,
      reports: [],
      ...(emptyPreflight && { generatePreflight: emptyPreflight }),
      ...(handoff && { handoff }),
    });
  }

  if (mode === "dry-run") {
    const reports: CommandReport[] = toRun.map((c) => ({
      id: c.id,
      run: c.run,
      status: "planned",
      exitCode: null,
      durationMs: 0,
    }));
    return finish(fs, mode, args, now, diagnostics, { contractPath, repoRoot, reports });
  }

  let generatePreflight: FinishContext["generatePreflight"];
  if (args.checkGenerate === true) {
    const checked = await checkGeneratedFiles(fs, contract, repoRoot);
    diagnostics.push(...checked.diagnostics);
    generatePreflight = { ok: checked.ok, files: toPreflightFiles(checked.files) };
    if (!checked.ok) {
      diagnostics.push(generateDriftDiagnostic());
      const skipped = toRun.map((command) => ({
        id: command.id,
        run: command.run,
        status: "skipped" as const,
        exitCode: null,
        durationMs: 0,
        timeoutSeconds: command.timeout ?? args.timeoutSeconds ?? DEFAULT_VERIFY_TIMEOUT_SECONDS,
      }));
      return finish(fs, mode, args, now, diagnostics, {
        contractPath,
        repoRoot,
        reports: skipped,
        generatePreflight,
        ...(handoff && { handoff }),
      });
    }
  }
  const reports: CommandReport[] = [];
  let stopped = false;

  for (const command of toRun) {
    if (stopped) {
      const timeoutSeconds =
        command.timeout ?? args.timeoutSeconds ?? DEFAULT_VERIFY_TIMEOUT_SECONDS;
      reports.push({
        id: command.id,
        run: command.run,
        status: "skipped",
        exitCode: null,
        durationMs: 0,
        timeoutSeconds,
      });
      continue;
    }

    const timeoutSeconds = command.timeout ?? args.timeoutSeconds ?? DEFAULT_VERIFY_TIMEOUT_SECONDS;
    const outcome = await commandRunner.run(command, {
      cwd: repoRoot,
      timeoutMs: timeoutSeconds * 1000,
    });
    reports.push({ ...outcome, timeoutSeconds });

    if (outcome.status !== "passed") {
      stopped = true;
      diagnostics.push(diagnosticForOutcome(outcome));
    }
  }

  return finish(fs, mode, args, now, diagnostics, {
    contractPath,
    repoRoot,
    reports,
    ...(generatePreflight && { generatePreflight }),
    ...(handoff && { handoff }),
  });
}

function diagnosticForOutcome(outcome: CommandOutcome): Diagnostic {
  if (outcome.status === "termination-failed") {
    return {
      code: "VERIFICATION_COMMAND_TERMINATION_FAILED",
      severity: "error",
      summary: `Command "${outcome.id}" exceeded its timeout and termination could not be confirmed.`,
      detail: `"${outcome.run}" may still have descendants running.`,
      field: `/verification/required/${outcome.id}`,
      remediation:
        "Stop the remaining process tree manually before continuing, then investigate why termination failed.",
    };
  }
  if (outcome.status === "timed-out") {
    return {
      code: "VERIFICATION_COMMAND_TIMEOUT",
      severity: "error",
      summary: `Command "${outcome.id}" timed out.`,
      detail: `"${outcome.run}" did not complete before the timeout and was killed.`,
      field: `/verification/required/${outcome.id}`,
      remediation: "Increase --timeout, or fix the command if it is unexpectedly hanging.",
    };
  }
  if (outcome.status === "spawn-failed") {
    return {
      code: "VERIFICATION_COMMAND_SPAWN_FAILED",
      severity: "error",
      summary: `Command "${outcome.id}" could not be started.`,
      detail: `"${outcome.run}" failed to spawn.`,
      field: `/verification/required/${outcome.id}`,
      remediation: "Ensure the command's executable is installed and on PATH.",
    };
  }
  return {
    code: "VERIFICATION_COMMAND_FAILED",
    severity: "error",
    summary: `Command "${outcome.id}" failed with exit code ${String(outcome.exitCode)}.`,
    detail: `"${outcome.run}" exited with a non-zero status.`,
    field: `/verification/required/${outcome.id}`,
    remediation: "Fix the underlying failure, then re-run `agent-ready verify --execute`.",
  };
}

async function finish(
  fs: FileSystem,
  mode: VerifyMode,
  args: VerifyArgs,
  now: () => Date,
  diagnosticsIn: readonly Diagnostic[],
  context: FinishContext = {},
): Promise<CliOutcome> {
  const diagnostics = [...diagnosticsIn];
  let recordedTo: string | undefined;

  if (args.record === true && mode === "execute" && context.repoRoot !== undefined) {
    const ok = !diagnostics.some((d) => d.severity === "error");
    const evidencePath = joinPath(context.repoRoot, VERIFICATION_RECORD_FILENAME);
    const evidenceBody = {
      ok,
      recordedAt: now().toISOString(),
      contractPath: context.contractPath,
      repoRoot: context.repoRoot,
      mode,
      commands: (context.reports ?? []).map((r) => ({
        id: r.id,
        run: r.run,
        status: r.status,
        exitCode: r.exitCode,
        durationMs: r.durationMs,
        ...(r.timeoutSeconds !== undefined && { timeoutSeconds: r.timeoutSeconds }),
      })),
      ...(context.generatePreflight !== undefined && {
        generatePreflight: context.generatePreflight,
      }),
      ...(context.handoff !== undefined && { handoff: context.handoff }),
      diagnostics: renderDiagnosticsJson(diagnostics),
    };
    try {
      await fs.writeTextFile(evidencePath, JSON.stringify(evidenceBody, null, 2) + "\n", {
        allowedRoot: context.repoRoot,
      });
      recordedTo = evidencePath;
    } catch (error) {
      diagnostics.push({
        code: "VERIFICATION_RECORD_WRITE_FAILED",
        severity: "error",
        summary: `Failed to write verification evidence to ${VERIFICATION_RECORD_FILENAME}.`,
        detail: error instanceof FileSystemError ? error.message : "Unknown write error.",
        sourcePath: VERIFICATION_RECORD_FILENAME,
        remediation: "Check file permissions and available disk space.",
      });
    }
  }

  const exitCode = resolveExitCode(diagnostics);
  const ok = !diagnostics.some((d) => d.severity === "error");

  if (args.json) {
    const body = {
      ok,
      ...(context.contractPath !== undefined && { contractPath: context.contractPath }),
      ...(context.repoRoot !== undefined && { repoRoot: context.repoRoot }),
      mode,
      ...(context.reports !== undefined && {
        commands: context.reports.map((r) => ({
          id: r.id,
          run: r.run,
          status: r.status,
          exitCode: r.exitCode,
          durationMs: r.durationMs,
          ...(r.timeoutSeconds !== undefined && { timeoutSeconds: r.timeoutSeconds }),
        })),
      }),
      ...(context.generatePreflight !== undefined && {
        generatePreflight: context.generatePreflight,
      }),
      ...(recordedTo !== undefined && { recordedTo }),
      diagnostics: renderDiagnosticsJson(diagnostics),
    };
    return { exitCode, stdout: JSON.stringify(body, null, 2) + "\n", stderr: "" };
  }

  if (context.repoRoot === undefined) {
    // Contract failed to load before we ever got this far.
    return { exitCode, stdout: "", stderr: renderDiagnosticsHuman(diagnostics) + "\n" };
  }

  const lines = [`Verify (${mode}) - repoRoot: ${context.repoRoot}`, ""];
  if (context.reports === undefined || context.reports.length === 0) {
    lines.push("  (no verification.required commands declared)");
  } else if (mode === "dry-run") {
    context.reports.forEach((r, i) => lines.push(`  ${String(i + 1)}. ${r.id}: ${r.run}`));
    lines.push("", "Nothing was executed. Re-run with --execute to run these commands.");
  } else {
    for (const r of context.reports) {
      const suffix =
        r.status === "skipped" || r.status === "spawn-failed"
          ? ""
          : ` (exit ${String(r.exitCode)}, ${(r.durationMs / 1000).toFixed(1)}s)`;
      lines.push(`  ${r.id}: ${r.status}${suffix}`);
    }
  }
  if (recordedTo !== undefined) {
    lines.push("", `Recorded verification evidence to ${recordedTo}`);
  }
  if (diagnostics.length > 0) {
    lines.push("", renderDiagnosticsHuman(diagnostics));
  }
  return { exitCode, stdout: lines.join("\n") + "\n", stderr: "" };
}

function isAbsolutePath(path: string): boolean {
  return /^([A-Za-z]:[/\\]|[/\\])/.test(path);
}

function generateDriftDiagnostic(): Diagnostic {
  return {
    code: "GENERATED_FILES_OUT_OF_DATE",
    severity: "error",
    summary: "Generated instruction files are out of date.",
    detail: "Verification commands were not executed because the generate preflight failed.",
    remediation: "Run `agent-ready generate --write`, review the changes, then verify again.",
  };
}

function toPreflightFiles(files: readonly GenerateCheckFile[]): PreflightFile[] {
  return files.map(({ adapter, relativePath, absolutePath, status }) => ({
    adapter,
    relativePath,
    absolutePath,
    status,
  }));
}
