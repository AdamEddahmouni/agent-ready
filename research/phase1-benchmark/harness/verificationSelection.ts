import type { Oracle, TaskDefinition, ToolCallRecord } from "./types.js";

/**
 * Verification selection, measured rather than adjudicated.
 *
 * The protocol defines `verificationSelectionResult` as "the agent ran a
 * command matching the task's `verificationSurface` expectation". Left to
 * adjudication that field defaults to `false`, which reported a run that
 * executed the task's own check as a verification failure. The expectation is
 * derivable from the task itself, so it is derived here:
 *
 * - every `command-exit-zero` clause in the success oracle is a check the task
 *   expects the agent to run;
 * - every `<manifest> scripts.<name>` entry in `verificationSurface` names a
 *   script, which the task expects the agent to invoke through the package
 *   manager.
 *
 * A task with neither has no derivable expectation, and `undefined` is
 * returned so the caller keeps whatever was recorded instead of inventing a
 * failure.
 */

const SCRIPT_INVOCATION = /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+|run-script\s+)?([A-Za-z0-9:_.-]+)$/;

export interface ExpectedVerification {
  readonly commands: readonly string[];
  readonly scripts: readonly string[];
}

export function expectedVerification(task: TaskDefinition): ExpectedVerification {
  const commands: string[] = [];
  const collect = (oracle: Oracle): void => {
    switch (oracle.type) {
      case "command-exit-zero":
        commands.push(oracle.command);
        break;
      case "all-of":
        for (const clause of oracle.clauses) collect(clause);
        break;
      default:
        break;
    }
  };
  collect(task.successOracle);

  const scripts: string[] = [];
  for (const entry of task.verificationSurface) {
    const match = /^\S+\s+scripts\.([A-Za-z0-9:_.-]+)$/.exec(entry.trim());
    const script = match?.[1];
    if (script !== undefined) scripts.push(script);
  }

  return { commands, scripts };
}

/** Quotes and whitespace differ between clients; the command itself does not. */
function normalize(command: string): string {
  return command.replace(/["'`]/g, " ").replace(/\s+/g, " ").trim();
}

function invokesScript(command: string, script: string): boolean {
  for (const segment of command.split(/&&|\|\||[;|]/)) {
    const match = SCRIPT_INVOCATION.exec(segment.trim());
    if (match?.[1] === script) return true;
  }
  return false;
}

/**
 * `true` when a recorded shell call ran one of the task's checks, `undefined`
 * when the task declares no check and the answer must come from elsewhere.
 */
export function selectedVerificationFor(
  task: TaskDefinition,
  toolCalls: readonly ToolCallRecord[],
): boolean | undefined {
  const expected = expectedVerification(task);
  if (expected.commands.length === 0 && expected.scripts.length === 0) return undefined;

  const commands = toolCalls
    .map((call) => call.command)
    .filter((command): command is string => typeof command === "string")
    .map(normalize);

  const ranOracleCommand = expected.commands.some((command) => {
    const needle = normalize(command);
    return needle.length > 0 && commands.some((call) => call.includes(needle));
  });
  if (ranOracleCommand) return true;

  return expected.scripts.some((script) =>
    commands.some((command) => invokesScript(command, script)),
  );
}
