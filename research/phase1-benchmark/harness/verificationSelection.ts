import type { Oracle, TaskDefinition, ToolCallRecord } from "./types.js";

/**
 * Verification selection, measured rather than adjudicated.
 *
 * The protocol defines `verificationSelectionResult` as "the agent ran a
 * command matching the task's `verificationSurface` expectation". Left to
 * adjudication that field defaults to `false`, which reported a run that
 * executed the task's own check as a verification failure, so it is derived
 * here — but only from the task's `command-exit-zero` oracle clauses.
 *
 * A script merely named in `verificationSurface` is not a check the task asks
 * the agent to run. `axios-01` names `package.json scripts.test` because the
 * answer lives there, not because a correct run executes `npm test`; counting
 * that would let a read-only task score as verified by running the suite.
 *
 * A task with no command clause returns `undefined`, so the caller keeps
 * whatever was recorded rather than inventing a result either way.
 */

export function expectedVerificationCommands(task: TaskDefinition): readonly string[] {
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
  return commands;
}

/** Quotes and whitespace differ between clients; the command itself does not. */
function normalize(command: string): string {
  return command.replace(/["'`]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * `true` when a recorded shell call ran one of the task's own check commands,
 * `undefined` when the task declares none and the answer must come from
 * elsewhere.
 */
export function selectedVerificationFor(
  task: TaskDefinition,
  toolCalls: readonly ToolCallRecord[],
): boolean | undefined {
  const expected = expectedVerificationCommands(task);
  if (expected.length === 0) return undefined;

  const commands = toolCalls
    .map((call) => call.command)
    .filter((command): command is string => typeof command === "string")
    .map(normalize);

  return expected.some((command) => {
    const needle = normalize(command);
    return needle.length > 0 && commands.some((call) => call.includes(needle));
  });
}
