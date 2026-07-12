import type { CommandOutcome, CommandRunner, CommandToRun, RunCommandOptions } from "./types.js";

export interface FakeCommandRunnerOptions {
  /** Outcome status keyed by command id. Defaults to "passed" for any id not listed. */
  readonly statusById?: Readonly<Record<string, CommandOutcome["status"]>>;
  /** Exit code keyed by command id, used when the status isn't "passed"/"spawn-failed"/"timed-out". */
  readonly exitCodeById?: Readonly<Record<string, number>>;
}

/**
 * Deterministic test double for CommandRunner, in the same spirit as
 * FakeGitClient: no real process is ever spawned.
 */
export class FakeCommandRunner implements CommandRunner {
  readonly calls: CommandToRun[] = [];
  readonly optionsSeen: RunCommandOptions[] = [];

  constructor(private readonly options: FakeCommandRunnerOptions = {}) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  async run(command: CommandToRun, options: RunCommandOptions): Promise<CommandOutcome> {
    this.calls.push(command);
    this.optionsSeen.push(options);
    const status = this.options.statusById?.[command.id] ?? "passed";
    const exitCode =
      status === "passed" ? 0 : status === "spawn-failed" || status === "timed-out" ? null : 1;
    return {
      id: command.id,
      run: command.run,
      status,
      exitCode: this.options.exitCodeById?.[command.id] ?? exitCode,
      durationMs: 0,
    };
  }
}
