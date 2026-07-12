/**
 * Command-execution boundary, mirroring `git/types.ts`'s pattern: domain/
 * CLI code depends on this interface, not on `node:child_process` directly,
 * so `agent-ready verify` can be tested against a fake without ever
 * spawning a real process. See ADR-0014 for why this is the project's
 * first (and only) code path that executes contract-declared `run`
 * strings, and how it stays a narrow, explicit, opt-in exception to the
 * "never execute contract content" boundary from ADR-0006.
 */

export interface CommandToRun {
  readonly id: string;
  readonly run: string;
  readonly description?: string;
  readonly timeout?: number;
}

export type CommandOutcomeStatus = "passed" | "failed" | "timed-out" | "spawn-failed" | "skipped";

export interface CommandOutcome {
  readonly id: string;
  readonly run: string;
  readonly status: CommandOutcomeStatus;
  /** Process exit code, or null when the process never exited normally (timeout, spawn failure, skipped). */
  readonly exitCode: number | null;
  readonly durationMs: number;
}

export interface RunCommandOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
}

export interface CommandRunner {
  /**
   * Runs a single command to completion and reports its outcome. Never
   * throws: a command that could not even be spawned resolves with status
   * `"spawn-failed"` rather than rejecting, so callers can always produce a
   * per-command result.
   */
  run(command: CommandToRun, options: RunCommandOptions): Promise<CommandOutcome>;
}
