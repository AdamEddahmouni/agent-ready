import { readFile } from "node:fs/promises";
import { resolveWorkspacePath } from "./score.js";
import { parseTranscript, type AgentTranscript, type TranscriptEvent } from "./transcript.js";
import {
  asNumber,
  asString,
  assessShellMutation,
  isRecord,
  readJsonl,
  repositoryPath,
  shellMutationRisk,
} from "./transcriptCapture.js";
import type { Condition, TokenMetrics } from "./types.js";

/**
 * Converts Claude Code's `--output-format stream-json` event stream into Agent
 * Transcript v1. This is the adapter the pilot uses to replace the authored
 * fixture with a real capture; it reads a stream it is given and never runs the
 * agent itself.
 */

export interface ClaudeCodeCaptureOptions {
  readonly taskId: string;
  readonly condition: Condition;
  /** The checkout the session ran in; absolute tool paths are relativized to it. */
  readonly workspaceRoot: string;
  readonly startedAt: string;
  readonly capturedAt: string;
  /** Overrides `model` from the stream's init event when absent. */
  readonly modelId?: string;
  readonly client?: string;
  readonly clientVersion?: string;
  /**
   * Millisecond offset for the event at `index`. A live capture passes elapsed
   * time. A saved log has none; the default is the event index, which is
   * recorded as a limitation because it is sequence, not duration.
   */
  readonly timing?: (index: number) => number | undefined;
  /**
   * `refuse` (default) aborts when a shell command certainly changed files;
   * `flag` records the risk and continues. Ambiguous interpreters are always
   * flagged, never refused.
   */
  readonly onShellMutation?: "refuse" | "flag";
}

export interface ClaudeCodeCaptureResult {
  readonly transcript: AgentTranscript;
  /** True when `atMs` came from the index rather than a measured clock. */
  readonly timingIsSequenceDerived: boolean;
}

function applyEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  path: string,
): string {
  if (!content.includes(oldString)) {
    throw new Error(`recorded edit targets text not present in ${path}`);
  }
  return replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);
}

interface CaptureState {
  readonly events: TranscriptEvent[];
  readonly overlay: Map<string, string>;
  lastAtMs: number;
  timingFallback: boolean;
  lastAssistantText: string;
  modelId: string | undefined;
  clientVersion: string | undefined;
  usage: TokenMetrics | undefined;
  isError: boolean;
}

async function readTracked(state: CaptureState, path: string, root: string): Promise<string> {
  const tracked = state.overlay.get(path);
  if (tracked !== undefined) return tracked;
  return await readFile(resolveWorkspacePath(root, path), "utf8");
}

async function eventForToolUse(
  state: CaptureState,
  name: string,
  input: Record<string, unknown>,
  atMs: number,
  root: string,
): Promise<TranscriptEvent | undefined> {
  switch (name) {
    case "Read": {
      const path = asString(input["file_path"]);
      if (path === undefined) return undefined;
      return { kind: "read", path: repositoryPath(path, root), atMs };
    }
    case "Write": {
      const path = asString(input["file_path"]);
      const content = asString(input["content"]);
      if (path === undefined || content === undefined) return undefined;
      const repositoryRelative = repositoryPath(path, root);
      state.overlay.set(repositoryRelative, content);
      return { kind: "write", path: repositoryRelative, content, atMs };
    }
    case "Edit": {
      const path = asString(input["file_path"]);
      const oldString = asString(input["old_string"]);
      const newString = asString(input["new_string"]);
      if (path === undefined || oldString === undefined || newString === undefined)
        return undefined;
      const repositoryRelative = repositoryPath(path, root);
      const content = applyEdit(
        await readTracked(state, repositoryRelative, root),
        oldString,
        newString,
        input["replace_all"] === true,
        repositoryRelative,
      );
      state.overlay.set(repositoryRelative, content);
      return { kind: "write", path: repositoryRelative, content, atMs };
    }
    case "MultiEdit": {
      const path = asString(input["file_path"]);
      const edits = input["edits"];
      if (path === undefined || !Array.isArray(edits)) return undefined;
      const repositoryRelative = repositoryPath(path, root);
      let content = await readTracked(state, repositoryRelative, root);
      for (const edit of edits) {
        if (!isRecord(edit)) continue;
        const oldString = asString(edit["old_string"]);
        const newString = asString(edit["new_string"]);
        if (oldString === undefined || newString === undefined) continue;
        content = applyEdit(
          content,
          oldString,
          newString,
          edit["replace_all"] === true,
          repositoryRelative,
        );
      }
      state.overlay.set(repositoryRelative, content);
      return { kind: "write", path: repositoryRelative, content, atMs };
    }
    case "Bash": {
      const command = asString(input["command"]);
      return command === undefined ? undefined : { kind: "shell", command, atMs };
    }
    case "Grep":
    case "Glob": {
      const query = asString(input["pattern"]);
      return query === undefined ? undefined : { kind: "search", query, atMs };
    }
    default:
      return { kind: "other", name, atMs };
  }
}

function nextAtMs(state: CaptureState, timing: ClaudeCodeCaptureOptions["timing"]): number {
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
  const cached =
    (asNumber(value["cache_read_input_tokens"]) ?? 0) +
    (asNumber(value["cache_creation_input_tokens"]) ?? 0);
  return {
    input: asNumber(value["input_tokens"]),
    output: asNumber(value["output_tokens"]),
    cached: cached === 0 ? null : cached,
    reasoning: null,
  };
}

/**
 * Normalizes one Claude Code session. Tool calls the converter cannot ground in
 * the workspace (an edit whose target text is gone, a path outside the root)
 * throw rather than produce a transcript that would score differently from the
 * session that produced it.
 */
export async function transcriptFromClaudeCodeStream(
  stream: string | readonly unknown[],
  options: ClaudeCodeCaptureOptions,
): Promise<ClaudeCodeCaptureResult> {
  const state: CaptureState = {
    events: [],
    overlay: new Map<string, string>(),
    lastAtMs: 0,
    timingFallback: false,
    lastAssistantText: "",
    modelId: undefined,
    clientVersion: undefined,
    usage: undefined,
    isError: false,
  };

  for (const event of readJsonl(stream)) {
    if (!isRecord(event)) continue;
    const type = event["type"];

    if (type === "system" && event["subtype"] === "init") {
      state.modelId = state.modelId ?? asString(event["model"]);
      state.clientVersion = state.clientVersion ?? asString(event["claude_code_version"]);
      continue;
    }

    if (type === "assistant") {
      const message = isRecord(event["message"]) ? event["message"] : undefined;
      const content =
        message !== undefined && Array.isArray(message["content"]) ? message["content"] : [];
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block["type"] === "text") {
          const text = asString(block["text"]);
          if (text !== undefined) state.lastAssistantText = text;
          continue;
        }
        if (block["type"] !== "tool_use") continue;
        const name = asString(block["name"]);
        if (name === undefined) continue;
        const input = isRecord(block["input"]) ? block["input"] : {};
        const atMs = nextAtMs(state, options.timing);
        const mapped = await eventForToolUse(state, name, input, atMs, options.workspaceRoot);
        if (mapped !== undefined) state.events.push(mapped);
      }
      continue;
    }

    if (type === "result") {
      const result = asString(event["result"]);
      if (result !== undefined) state.lastAssistantText = result;
      if (event["is_error"] === true) state.isError = true;
      state.usage = usageFrom(event["usage"]) ?? state.usage;
    }
  }

  const modelId = options.modelId ?? state.modelId;
  if (modelId === undefined) {
    throw new Error("Claude Code stream has no model in its init event; pass modelId explicitly");
  }
  const usage = state.usage;
  if (usage === undefined) {
    throw new Error("Claude Code stream has no result usage; the capture is incomplete");
  }

  const assessment = await assessShellMutation({
    workspaceRoot: options.workspaceRoot,
    recordedWrites: state.events.flatMap((event) =>
      event.kind === "write" ? [{ path: event.path, content: event.content }] : [],
    ),
    commands: state.events.flatMap((event) =>
      event.kind === "shell"
        ? [{ command: event.command, level: shellMutationRisk(event.command) }]
        : [],
    ),
  });
  if (assessment.refusal !== undefined && options.onShellMutation !== "flag") {
    throw new Error(assessment.refusal);
  }
  const shellMutation = assessment.risk;

  const sequenceDerived = state.timingFallback;
  const warnings: string[] = [];
  if (assessment.note !== undefined) warnings.push(assessment.note);
  if (sequenceDerived) {
    warnings.push(
      "atMs is sequence-derived, not measured; do not report a duration from this capture",
    );
  }
  if (state.isError) warnings.push("the client reported an error for this session");

  const transcript = parseTranscript({
    transcriptVersion: 1,
    taskId: options.taskId,
    condition: options.condition,
    agent: {
      client: options.client ?? "claude-code",
      version: options.clientVersion ?? state.clientVersion ?? "unknown",
      modelId,
    },
    provenance: {
      captured: true,
      clientLogFormat: "stream-json",
      capturedAt: options.capturedAt,
      ...(sequenceDerived && { note: "timing is sequence-derived" }),
    },
    startedAt: options.startedAt,
    events: state.events,
    finalResponse: state.lastAssistantText,
    usage,
    ...(shellMutation && { shellMutationRisk: true }),
    ...(warnings.length > 0 && { notes: warnings.join("; ") }),
  });

  return { transcript, timingIsSequenceDerived: sequenceDerived };
}
