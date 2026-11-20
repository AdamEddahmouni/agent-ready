import type { Oracle, TaskDefinition, ToolCallRecord } from "./types.js";

/**
 * Verification selection, measured rather than adjudicated.
 *
 * The protocol defines `verificationSelectionResult` as "the agent ran a
 * command matching the task's `verificationSurface` expectation". It is derived
 * here from the task's `command-exit-zero` oracle clauses — and only from a
 * command the session actually executed.
 *
 * Substring matching is not enough for that second half. `rg "npm run
 * check:sponsor-data"`, `echo "npm run check:sponsor-data"` and a run that
 * prints its own log all contain the check command without running it, so a
 * recorded shell call is tokenized (respecting quotes), split into simple
 * commands, unwrapped from `bash -lc "…"`, stripped of `env`/`FOO=bar`
 * prefixes, and compared word for word with the oracle command. A command that
 * only appears as another program's argument therefore never counts.
 *
 * A script merely named in `verificationSurface` does not count either: the
 * surface says where an answer lives, not what the agent must run, and
 * counting it would let a read-only task read as verified for running
 * `npm test`. A task with no command clause returns `undefined`, so the caller
 * keeps whatever was recorded rather than inventing a result either way.
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

type Words = readonly string[];

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const PREFIX_PROGRAMS = new Set(["env", "time", "command", "exec", "nohup", "sudo", "xargs"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Splits a recorded shell command into simple commands, keeping quoted text
 * intact so an operator or program name inside quotes is not mistaken for
 * execution.
 */
export function tokenizeCommand(command: string): Words[] {
  const segments: Words[] = [];
  let words: string[] = [];
  let word = "";
  let started = false;
  let quote: '"' | "'" | null = null;

  const endWord = (): void => {
    if (started) {
      words.push(word);
      word = "";
      started = false;
    }
  };
  const endSegment = (): void => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command.charAt(index);

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else if (character === "\\" && quote === '"' && index + 1 < command.length) {
        index += 1;
        word += command.charAt(index);
        started = true;
      } else {
        word += character;
        started = true;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (character === "\\" && index + 1 < command.length) {
      index += 1;
      word += command.charAt(index);
      started = true;
      continue;
    }
    if (character === " " || character === "\t" || character === "\n" || character === "\r") {
      endWord();
      continue;
    }
    if (character === "&" || character === "|" || character === ";") {
      endSegment();
      if ((character === "&" || character === "|") && command[index + 1] === character) index += 1;
      continue;
    }
    if (character === ">" || character === "<") {
      endSegment();
      continue;
    }
    word += character;
    started = true;
  }
  endSegment();
  return segments;
}

/** `bash -lc "…"` and `sh -c '…'` run their argument, so look inside it. */
function unwrapShell(segment: Words): Words[] {
  const [head, ...rest] = segment;
  if (head === undefined) return [];
  const program = head.split("/").pop() ?? head;
  if (!SHELLS.has(program)) return [segment];

  const flagIndex = rest.findIndex((word) => /^-[A-Za-z]*c[A-Za-z]*$/.test(word));
  const script = flagIndex >= 0 ? rest[flagIndex + 1] : undefined;
  if (script === undefined) return [segment];
  return tokenizeCommand(script).flatMap((inner) => unwrapShell(inner));
}

/** `env FOO=bar npm …`, `time npm …`, `xargs npm …` still execute `npm …`. */
function stripPrefixes(segment: Words): Words {
  let index = 0;
  while (index < segment.length) {
    const word = segment[index];
    if (word === undefined) break;
    if (ASSIGNMENT.test(word) || PREFIX_PROGRAMS.has(word)) {
      index += 1;
      continue;
    }
    break;
  }
  return segment.slice(index);
}

function sameProgram(left: string, right: string): boolean {
  return left === right || (left.split("/").pop() ?? left) === (right.split("/").pop() ?? right);
}

function isExactly(segment: Words, expected: Words): boolean {
  if (segment.length < expected.length) return false;
  const head = segment[0];
  if (head === undefined) return false;
  return expected.every((word, index) =>
    index === 0 ? sameProgram(head, word) : segment[index] === word,
  );
}

/**
 * `true` when a recorded shell call executed one of the task's own check
 * commands, `undefined` when the task declares none.
 */
export function selectedVerificationFor(
  task: TaskDefinition,
  toolCalls: readonly ToolCallRecord[],
): boolean | undefined {
  const expected = expectedVerificationCommands(task);
  if (expected.length === 0) return undefined;

  const expectedSegments = expected
    .map((command) => tokenizeCommand(command)[0])
    .filter((segment): segment is Words => segment !== undefined);

  const executed = toolCalls
    .map((call) => call.command)
    .filter((command): command is string => typeof command === "string")
    .flatMap((command) =>
      tokenizeCommand(command)
        .flatMap((segment) => unwrapShell(segment))
        .map((segment) => stripPrefixes(segment)),
    );

  return expectedSegments.some((wanted) => executed.some((segment) => isExactly(segment, wanted)));
}
