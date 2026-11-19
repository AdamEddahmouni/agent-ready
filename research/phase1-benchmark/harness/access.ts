import { dirname } from "node:path";
import { TWIN_QUERY_KINDS } from "../../../src/twin/queryEngine.js";
import type { AgentRunRequest } from "./run.js";
import type { Condition } from "./types.js";

/**
 * Condition access, expressed as the one thing a client can actually use: a
 * fixed tool description appended to the unchanged task prompt, plus — for
 * `agent-ready` — an executable that answers bounded queries from the snapshot.
 *
 * The task prompt is passed through verbatim. Only this block differs between
 * conditions, it is built from a template rather than written per run, and the
 * snapshot and wrapper live outside the checkout so neither appears in the
 * agent's diff.
 */

export const TWIN_QUERY_COMMAND = "agent-ready";

export interface ConditionPaths {
  readonly workspacePath: string;
  /** Present only for the agent-ready condition. */
  readonly snapshotPath?: string;
  /** Directory prepended to `PATH`, holding the snapshot query wrapper. */
  readonly binDirectory?: string;
}

export class ConditionAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConditionAccessError";
  }
}

/**
 * The CLI's own `twin query` surface with this trial's snapshot appended, so
 * the agent calls the documented command and cannot make the query read a
 * different artifact. Only the query arguments pass through.
 */
export function twinQueryWrapper(options: {
  readonly cliPath: string;
  readonly snapshotPath: string;
}): string {
  // The CLI resolves its bundled schemas from the package root, so the wrapper
  // changes there first. The snapshot is absolute and query parameters are
  // names rather than paths, so nothing else depends on the working directory.
  const packageRoot = dirname(dirname(dirname(options.cliPath)));
  return [
    "#!/bin/sh",
    "# Agent-Ready snapshot query for this trial. Answers from the snapshot only.",
    `cd ${JSON.stringify(packageRoot)} || exit 1`,
    `exec node ${JSON.stringify(options.cliPath)} "$@" --snapshot ${JSON.stringify(options.snapshotPath)}`,
    "",
  ].join("\n");
}

function rawInstructions(paths: ConditionPaths): string {
  return [
    `You are working in the repository at ${paths.workspacePath}.`,
    "You have shell and file tools only.",
  ].join("\n");
}

function agentReadyInstructions(paths: ConditionPaths): string {
  if (paths.snapshotPath === undefined || paths.binDirectory === undefined) {
    throw new ConditionAccessError(
      "the agent-ready condition needs both a snapshot path and a wrapper directory",
    );
  }
  return [
    `You are working in the repository at ${paths.workspacePath}.`,
    "You have the same shell and file tools, and in addition an Agent-Ready repository snapshot:",
    "",
    `- Snapshot file (read-only): ${paths.snapshotPath}`,
    `- Query it with: ${TWIN_QUERY_COMMAND} twin query --kind <kind> [--parameter <value>] [--limit <n>] --json`,
    `- Query kinds: ${TWIN_QUERY_KINDS.join(", ")}`,
    "",
    "The query command answers repository-structure questions from the snapshot and never reads the checkout.",
    "The checkout remains the source of truth for any change you make. Do not modify the snapshot file.",
    `The command is on PATH for this session (${paths.binDirectory}).`,
  ].join("\n");
}

export function conditionInstructions(condition: Condition, paths: ConditionPaths): string {
  return condition === "raw" ? rawInstructions(paths) : agentReadyInstructions(paths);
}

/**
 * The client prompt for one trial: the protocol's task text untouched, then the
 * condition's access description. Both conditions get the same structure, so a
 * difference in behaviour cannot come from how the prompt was assembled.
 */
export function buildAgentPrompt(
  request: Pick<AgentRunRequest, "condition" | "prompt" | "workspacePath" | "snapshotPath">,
  binDirectory?: string,
): string {
  const instructions = conditionInstructions(request.condition, {
    workspacePath: request.workspacePath,
    ...(request.snapshotPath !== undefined && { snapshotPath: request.snapshotPath }),
    ...(binDirectory !== undefined && { binDirectory }),
  });
  return `${request.prompt}\n\n${instructions}`;
}
