import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { transcriptFromClaudeCodeStream } from "./harness/claudeCode.js";
import { transcriptFromCodexStream } from "./harness/codex.js";
import { CONDITIONS, loadProtocol, taskById } from "./harness/protocol.js";
import type { AgentTranscript } from "./harness/transcript.js";
import type { Condition } from "./harness/types.js";

/**
 * Converts a saved client event log into Agent Transcript v1 and writes it.
 * It never runs the agent: the log must already exist, and a Codex capture
 * needs the checkout the session ran in because Codex reports a file change as
 * a path without content.
 */

export const CAPTURE_CLIENTS = ["codex", "claude-code"] as const;

export type CaptureClient = (typeof CAPTURE_CLIENTS)[number];

export interface CaptureRequest {
  readonly client: CaptureClient;
  /** The client's raw log, exactly as it was written. */
  readonly logPath: string;
  readonly taskId: string;
  readonly condition: Condition;
  /** The checkout the session ran in, still holding its changes. */
  readonly workspaceRoot: string;
  /** When the session started; required because the log does not record it. */
  readonly startedAt: string;
  /** Defaults to the moment the capture runs. */
  readonly capturedAt?: string;
  /** Required for Codex, whose stream carries no model; optional otherwise. */
  readonly modelId?: string;
  readonly clientVersion?: string;
  readonly onShellMutation?: "refuse" | "flag";
}

export interface CaptureOutcome {
  readonly transcript: AgentTranscript;
  readonly timingIsSequenceDerived: boolean;
}

export async function captureTranscript(request: CaptureRequest): Promise<CaptureOutcome> {
  const protocol = await loadProtocol();
  const task = taskById(protocol, request.taskId);
  if (!CONDITIONS.includes(request.condition)) {
    throw new Error(`unknown condition: ${JSON.stringify(request.condition)}`);
  }
  const stream = await readFile(request.logPath, "utf8");
  const capturedAt = request.capturedAt ?? new Date().toISOString();
  const shared = {
    taskId: task.id,
    condition: request.condition,
    workspaceRoot: request.workspaceRoot,
    startedAt: request.startedAt,
    capturedAt,
    ...(request.clientVersion !== undefined && { clientVersion: request.clientVersion }),
    ...(request.onShellMutation !== undefined && {
      onShellMutation: request.onShellMutation,
    }),
  };

  if (request.client === "codex") {
    if (request.modelId === undefined) {
      throw new Error("a Codex capture needs --model-id: the stream does not record the model");
    }
    return await transcriptFromCodexStream(stream, { ...shared, modelId: request.modelId });
  }
  return await transcriptFromClaudeCodeStream(stream, {
    ...shared,
    ...(request.modelId !== undefined && { modelId: request.modelId }),
  });
}

export async function writeTranscript(path: string, transcript: AgentTranscript): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(transcript, null, 2)}\n`, "utf8");
}

const USAGE =
  "Usage: pnpm research:benchmark-capture --client codex|claude-code --log <client-log> " +
  "--task <task-id> --condition raw|agent-ready --workspace <checkout> --started-at <ISO-8601> " +
  "--out <transcript.json> [--model-id <id>] [--client-version <version>] " +
  "[--captured-at <ISO-8601>] [--on-shell-mutation refuse|flag]";

function isCaptureClient(value: string): value is CaptureClient {
  return (CAPTURE_CLIENTS as readonly string[]).includes(value);
}

function isCondition(value: string): value is Condition {
  return (CONDITIONS as readonly string[]).includes(value);
}

/** Returns the process exit code; prints a single summary line on success. */
export async function runCaptureCli(argv: readonly string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        client: { type: "string" },
        log: { type: "string" },
        task: { type: "string" },
        condition: { type: "string" },
        workspace: { type: "string" },
        "started-at": { type: "string" },
        out: { type: "string" },
        "model-id": { type: "string" },
        "client-version": { type: "string" },
        "captured-at": { type: "string" },
        "on-shell-mutation": { type: "string" },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 1;
  }

  const required = [
    "client",
    "log",
    "task",
    "condition",
    "workspace",
    "started-at",
    "out",
  ] as const;
  const missing = required.filter((key) => typeof values[key] !== "string");
  if (missing.length > 0) {
    console.error(`missing required option(s): ${missing.map((key) => `--${key}`).join(", ")}`);
    console.error(USAGE);
    return 1;
  }

  const client = values["client"] as string;
  const condition = values["condition"] as string;
  const mutation = values["on-shell-mutation"];
  if (!isCaptureClient(client)) {
    console.error(`unknown --client ${JSON.stringify(client)}; expected codex or claude-code`);
    return 1;
  }
  if (!isCondition(condition)) {
    console.error(`unknown --condition ${JSON.stringify(condition)}; expected raw or agent-ready`);
    return 1;
  }
  if (mutation !== undefined && mutation !== "refuse" && mutation !== "flag") {
    console.error(
      `unknown --on-shell-mutation ${JSON.stringify(mutation)}; expected refuse or flag`,
    );
    return 1;
  }

  const outcome = await captureTranscript({
    client,
    logPath: values["log"] as string,
    taskId: values["task"] as string,
    condition,
    workspaceRoot: values["workspace"] as string,
    startedAt: values["started-at"] as string,
    ...(values["captured-at"] !== undefined && { capturedAt: values["captured-at"] as string }),
    ...(values["model-id"] !== undefined && { modelId: values["model-id"] as string }),
    ...(values["client-version"] !== undefined && {
      clientVersion: values["client-version"] as string,
    }),
    ...(mutation !== undefined && { onShellMutation: mutation }),
  });

  const out = values["out"] as string;
  await writeTranscript(out, outcome.transcript);
  const kinds = outcome.transcript.events.reduce<Record<string, number>>((counts, event) => {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
    return counts;
  }, {});
  const summary = Object.entries(kinds)
    .map(([kind, count]) => `${kind}=${String(count)}`)
    .join(" ");
  console.log(
    `wrote ${out}: ${outcome.transcript.agent.client} ${outcome.transcript.agent.modelId}, ` +
      `${String(outcome.transcript.events.length)} events${summary.length > 0 ? ` (${summary})` : ""}` +
      (outcome.transcript.shellMutationRisk === true ? ", shell mutation risk" : ""),
  );
  if (outcome.timingIsSequenceDerived) {
    console.log("note: atMs is sequence-derived; do not report a duration from this capture");
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await runCaptureCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
