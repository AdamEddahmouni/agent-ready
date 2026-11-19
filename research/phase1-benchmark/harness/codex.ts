import { readFile } from "node:fs/promises";
import { resolveWorkspacePath } from "./score.js";
import { parseTranscript, type AgentTranscript, type TranscriptEvent } from "./transcript.js";
import {
  asNumber,
  asString,
  isRecord,
  readJsonl,
  repositoryPath,
  shellMutationRisk,
} from "./transcriptCapture.js";
import type { Condition, TokenMetrics } from "./types.js";

/**
 * Converts `codex exec --json` JSONL into Agent Transcript v1. Codex reports a
 * file change as a path and a kind without the resulting content, so the
 * adapter reads that file from the workspace the session ran in and records it
 * as a write event. It never runs the agent itself.
 */

export interface CodexCaptureOptions {
  readonly taskId: string;
  readonly condition: Condition;
  /** The checkout the session ran in, still holding the session's changes. */
  readonly workspaceRoot: string;
  readonly startedAt: string;
  readonly capturedAt: string;
  /** Codex events carry no model; the caller must state which one ran. */
  readonly modelId: string;
  readonly clientVersion?: string;
  /** Same contract as the Claude Code adapter: measured when live, index otherwise. */
  readonly timing?: (index: number) => number | undefined;
  readonly onShellMutation?: "refuse" | "flag";
}

export interface CodexCaptureResult {
  readonly transcript: AgentTranscript;
  readonly timingIsSequenceDerived: boolean;
}

interface CodexState {
  readonly events: TranscriptEvent[];
  lastAtMs: number;
  timingFallback: boolean;
  lastAgentMessage: string;
  usage: TokenMetrics | undefined;
  turnCount: number;
  readonly failures: string[];
  readonly notes: string[];
}

function nextAtMs(state: CodexState, timing: CodexCaptureOptions["timing"]): number {
  const index = state.events.length;
  const candidate = timing?.(index);
  if (candidate === undefined || !Number.isFinite(candidate)) state.timingFallback = true;
  const atMs =
    candidate === undefined || !Number.isFinite(candidate) ? index : Math.max(0, candidate);
  state.lastAtMs = Math.max(state.lastAtMs, atMs);
  return state.lastAtMs;
}

function usageFrom(value: unknown): TokenMetrics | undefined {
  if (!isRecord(value)) return undefined;
  return {
    input: asNumber(value["input_tokens"]),
    output: asNumber(value["output_tokens"]),
    cached: asNumber(value["cached_input_tokens"]),
    reasoning: asNumber(value["reasoning_output_tokens"]),
  };
}

async function fileChangeEvents(
  item: Record<string, unknown>,
  workspaceRoot: string,
  atMs: number,
): Promise<TranscriptEvent[]> {
  const changes = Array.isArray(item["changes"]) ? item["changes"] : [];
  const events: TranscriptEvent[] = [];
  for (const change of changes) {
    if (!isRecord(change)) continue;
    const rawPath = asString(change["path"]);
    if (rawPath === undefined) continue;
    const path = repositoryPath(rawPath, workspaceRoot);
    const kind = asString(change["kind"]) ?? "update";
    if (kind === "delete") {
      throw new Error(
        `refusing to capture a deletion of ${path}: a transcript has no way to express it, ` +
          "so a replay would keep the deleted file",
      );
    }
    let content: string;
    try {
      content = await readFile(resolveWorkspacePath(workspaceRoot, path), "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`file changed by the session is unreadable (${path}): ${reason}`, {
        cause: error,
      });
    }
    events.push({ kind: "write", path, content, atMs });
  }
  return events;
}

async function itemEvents(
  item: Record<string, unknown>,
  options: CodexCaptureOptions,
  atMs: number,
): Promise<TranscriptEvent[]> {
  const type = asString(item["type"]);
  if (type === "command_execution") {
    const command = asString(item["command"]);
    if (command === undefined) return [{ kind: "other", name: type, atMs }];
    const exitCode = asNumber(item["exit_code"]);
    return [
      {
        kind: "shell",
        command,
        atMs,
        ...(exitCode !== null && { exitCode }),
      },
    ];
  }
  if (type === "file_change") {
    return await fileChangeEvents(item, options.workspaceRoot, atMs);
  }
  if (type === "mcp_tool_call") {
    const server = asString(item["server"]) ?? "mcp";
    const tool = asString(item["tool"]) ?? "tool";
    return [{ kind: "other", name: `${server}/${tool}`, atMs }];
  }
  if (type === "web_search") {
    const query = asString(item["query"]);
    return query === undefined
      ? [{ kind: "other", name: type, atMs }]
      : [{ kind: "search", query, atMs }];
  }
  if (type === "plan_update" || type === "todo_list") {
    return [{ kind: "other", name: type, atMs }];
  }
  // `agent_message` and `reasoning` are prose and are handled before this
  // mapping. Anything else is an item type this adapter does not model: record
  // it as `other` rather than dropping it, so a replay cannot silently lose an
  // action the session took.
  return [{ kind: "other", name: type ?? "unrecognized-item", atMs }];
}

/** Keeps the last write per path, which is the state a replay needs. */
function collapseRepeatedWrites(events: readonly TranscriptEvent[]): TranscriptEvent[] {
  const lastIndex = new Map<string, number>();
  events.forEach((event, index) => {
    if (event.kind === "write") lastIndex.set(event.path, index);
  });
  return events.filter(
    (event, index) => event.kind !== "write" || lastIndex.get(event.path) === index,
  );
}

export async function transcriptFromCodexStream(
  stream: string | readonly unknown[],
  options: CodexCaptureOptions,
): Promise<CodexCaptureResult> {
  const state: CodexState = {
    events: [],
    lastAtMs: 0,
    timingFallback: false,
    lastAgentMessage: "",
    usage: undefined,
    turnCount: 0,
    failures: [],
    notes: [],
  };

  for (const event of readJsonl(stream)) {
    if (!isRecord(event)) continue;
    const type = event["type"];

    if (type === "item.completed") {
      const item = isRecord(event["item"]) ? event["item"] : undefined;
      if (item === undefined) continue;
      const itemType = asString(item["type"]);
      if (itemType === "agent_message") {
        const text = asString(item["text"]);
        if (text !== undefined) state.lastAgentMessage = text;
        continue;
      }
      if (itemType === "reasoning") continue;
      const atMs = nextAtMs(state, options.timing);
      state.events.push(...(await itemEvents(item, options, atMs)));
      continue;
    }

    if (type === "turn.completed") {
      state.turnCount += 1;
      state.usage = usageFrom(event["usage"]) ?? state.usage;
      continue;
    }

    if (type === "turn.failed") {
      const error = isRecord(event["error"]) ? event["error"] : {};
      state.failures.push(`a turn failed: ${asString(error["message"]) ?? "no message"}`);
      continue;
    }

    if (type === "error") {
      state.failures.push(`the stream reported: ${asString(event["message"]) ?? "no message"}`);
    }
  }

  const usage = state.usage;
  if (usage === undefined) {
    throw new Error("Codex stream has no turn.completed usage; the capture is incomplete");
  }

  if (state.turnCount > 1) {
    state.notes.push(
      `usage spans ${String(state.turnCount)} turns and is the thread's running total, not one turn`,
    );
  }
  if (options.clientVersion === undefined) {
    state.notes.push("client version not supplied");
  }

  const shellCommands = state.events
    .flatMap((event) =>
      event.kind === "shell"
        ? [{ command: event.command, level: shellMutationRisk(event.command) }]
        : [],
    )
    .filter((risk) => risk.level !== "none");
  const certainShellMutations = shellCommands.filter((risk) => risk.level === "certain");
  if (certainShellMutations.length > 0 && options.onShellMutation !== "flag") {
    throw new Error(
      "Bash certainly changed files but Codex reported no file_change for them, so replay cannot " +
        `reproduce this session: ${certainShellMutations.map((risk) => JSON.stringify(risk.command)).join(", ")}. ` +
        'Pass onShellMutation: "flag" to accept the gap.',
    );
  }
  const shellMutation = shellCommands.length > 0;
  if (shellMutation) {
    state.notes.push(
      "Bash may have changed files without a file_change item; replay is not guaranteed to match this session",
    );
  }
  if (state.events.some((event) => event.kind === "write")) {
    state.notes.push(
      "write contents were read from the workspace when Codex reported each file change",
    );
  }

  const sequenceDerived = state.timingFallback;
  if (sequenceDerived) {
    state.notes.push(
      "atMs is sequence-derived, not measured; do not report a duration from this capture",
    );
  }
  state.notes.push(...state.failures);

  const transcript = parseTranscript({
    transcriptVersion: 1,
    taskId: options.taskId,
    condition: options.condition,
    agent: {
      client: "codex-cli",
      version: options.clientVersion ?? "unknown",
      modelId: options.modelId,
    },
    provenance: {
      captured: true,
      clientLogFormat: "jsonl",
      capturedAt: options.capturedAt,
      ...(sequenceDerived && { note: "timing is sequence-derived" }),
    },
    startedAt: options.startedAt,
    events: collapseRepeatedWrites(state.events),
    finalResponse: state.lastAgentMessage,
    usage,
    ...(shellMutation && { shellMutationRisk: true }),
    ...(state.notes.length > 0 && { notes: state.notes.join("; ") }),
  });

  return { transcript, timingIsSequenceDerived: sequenceDerived };
}
