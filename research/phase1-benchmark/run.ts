import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { twinQueryWrapper } from "./harness/access.js";
import {
  AgentReadyCliError,
  BUILD_DIRECTORY,
  buildAgentReadyCli,
  verifyAgentReadyCli,
} from "./harness/agentReadyCli.js";
import { CodexAgentRunner, type LiveTrialArtifacts } from "./harness/codexRunner.js";
import { NodeCommandExecutor } from "./harness/command.js";
import type { CommandExecutor } from "./harness/score.js";
import { emptyObservations, FakeAgentRunner } from "./harness/fakeRunner.js";
import {
  assertManifestMatchesProtocol,
  DEFAULT_RUN_MANIFEST_PATH,
  loadRunManifest,
  type RunManifest,
} from "./harness/manifest.js";
import { planTrials, recordFileName, type PlannedTrial } from "./harness/plan.js";
import {
  prepareConditionWorkspace,
  removePreparedWorkspace,
  type PreparedConditionWorkspace,
  type RepositoryFetcher,
  type SnapshotBuilder,
} from "./harness/prepare.js";
import { loadProtocolForVersion, repositoryById, taskById } from "./harness/protocol.js";
import { executeTrial, type RunConfiguration } from "./harness/run.js";
import type { AgentRunner } from "./harness/run.js";
import type { RawRunRecord } from "./harness/record.js";
import type { Condition, ProtocolBundle, RepositoryPin, TaskDefinition } from "./harness/types.js";
import { CONDITIONS } from "./harness/protocol.js";

/**
 * Executes a planned set of protocol trials end to end: fresh checkout per
 * attempt, one client session, the raw log and transcript written beside the
 * record, scoring through `executeTrial`, and one schema-valid raw record per
 * trial. Preparation, invocation, capture, scoring and record writing are the
 * same functions the offline tests and the capture path already use; this file
 * adds only orchestration, retry and budget accounting.
 */

export interface TrialRunner extends AgentRunner {
  readonly last?: LiveTrialArtifacts;
}

export type TrialStatus = "recorded" | "skipped" | "aborted";

export interface TrialOutcome {
  readonly trial: PlannedTrial;
  readonly status: TrialStatus;
  readonly attempts: number;
  readonly recordPath?: string;
  readonly infrastructureFailure?: boolean;
}

export interface ProtocolRunOutcome {
  readonly outcomes: readonly TrialOutcome[];
  readonly recorded: number;
  readonly skipped: number;
  readonly retried: number;
  readonly tokensUsed: number;
  readonly elapsedMs: number;
  /** Set when a budget cap stopped the run before the plan finished. */
  readonly aborted?: string;
}

export interface CreateRunnerContext {
  readonly trial: PlannedTrial;
  readonly task: TaskDefinition;
  readonly workspace: PreparedConditionWorkspace;
  readonly attempt: number;
}

export interface ProtocolRunOptions {
  readonly manifest: RunManifest;
  readonly protocol: ProtocolBundle;
  readonly plan: readonly PlannedTrial[];
  readonly outputDirectory: string;
  readonly createRunner: (context: CreateRunnerContext) => TrialRunner;
  /** Path to a built CLI used to answer the agent-ready condition's queries. */
  readonly agentReadyCliPath?: string;
  readonly fetcher?: RepositoryFetcher;
  readonly snapshotBuilder?: SnapshotBuilder;
  readonly commandExecutor: CommandExecutor;
  /** Overrides the manifest id; the dry run uses a suffixed id. */
  readonly runManifestId?: string;
  readonly force?: boolean;
  readonly keepWorkspaces?: boolean;
  readonly baseDirectory?: string;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export class TrialRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrialRunnerError";
  }
}

function configurationFor(manifest: RunManifest): RunConfiguration {
  const configuration = manifest.model.configuration;
  const temperature = configuration["temperature"];
  const maxOutputTokens = configuration["maxOutputTokens"];
  return {
    modelId: manifest.model.id,
    agentClientVersion: manifest.agentClient.version,
    ...(typeof temperature === "number" && { temperature }),
    ...(typeof maxOutputTokens === "number" && { maxOutputTokens }),
  };
}

function tokensOf(record: RawRunRecord): number {
  const metrics = record.tokenMetrics;
  return (
    (metrics.input ?? 0) + (metrics.output ?? 0) + (metrics.cached ?? 0) + (metrics.reasoning ?? 0)
  );
}

async function writeAgentReadyWrapper(options: {
  readonly workspace: PreparedConditionWorkspace;
  readonly cliPath: string;
}): Promise<string> {
  const { snapshotPath } = options.workspace;
  if (snapshotPath === undefined) {
    throw new TrialRunnerError(
      "an agent-ready workspace without a snapshot cannot answer queries; refusing to run it as raw",
    );
  }
  const binDirectory = join(options.workspace.runRoot, "bin");
  await mkdir(binDirectory, { recursive: true });
  const wrapperPath = join(binDirectory, "agent-ready");
  await writeFile(
    wrapperPath,
    twinQueryWrapper({ cliPath: options.cliPath, snapshotPath }),
    "utf8",
  );
  await chmod(wrapperPath, 0o755);
  return binDirectory;
}

/**
 * Runs the plan. A trial that fails infrastructure is retried once (protocol v1)
 * and then recorded with `infrastructureFailure: true`; it is never silently
 * dropped. Existing records are skipped on a resumed run unless `force` is set.
 */
export async function executeProtocolRun(options: ProtocolRunOptions): Promise<ProtocolRunOutcome> {
  const now = options.now ?? Date.now;
  const log =
    options.log ??
    ((line: string) => {
      console.log(line);
    });
  const runManifestId = options.runManifestId ?? options.manifest.id;
  const config = configurationFor(options.manifest);
  const maxRetries = Math.floor(options.manifest.budgets.maxInfrastructureRetriesPerTrial);
  const tokenCap = options.manifest.budgets.maxTotalTokens;
  const wallClockCapMs = options.manifest.budgets.maxTotalWallClockMinutes * 60_000;
  const startedAt = now();

  const rawDirectory = join(options.outputDirectory, "raw");
  const logDirectory = join(options.outputDirectory, "logs");
  const transcriptDirectory = join(options.outputDirectory, "transcripts");
  await mkdir(rawDirectory, { recursive: true });
  await mkdir(logDirectory, { recursive: true });

  const outcomes: TrialOutcome[] = [];
  let recorded = 0;
  let skipped = 0;
  let retried = 0;
  let tokensUsed = 0;
  let aborted: string | undefined;

  for (const trial of options.plan) {
    const recordPath = join(rawDirectory, recordFileName(trial));
    if (!options.force && existsSync(recordPath)) {
      skipped += 1;
      outcomes.push({ trial, status: "skipped", attempts: 0, recordPath });
      continue;
    }

    if (aborted !== undefined) {
      outcomes.push({ trial, status: "aborted", attempts: 0 });
      continue;
    }
    if (tokensUsed > tokenCap) {
      aborted = `token budget exhausted: ${String(tokensUsed)} > ${String(tokenCap)}`;
      outcomes.push({ trial, status: "aborted", attempts: 0 });
      continue;
    }
    if (now() - startedAt > wallClockCapMs) {
      aborted = `wall-clock budget exhausted: ${String(Math.round((now() - startedAt) / 60_000))} > ${String(options.manifest.budgets.maxTotalWallClockMinutes)} minutes`;
      outcomes.push({ trial, status: "aborted", attempts: 0 });
      continue;
    }

    const task = taskById(options.protocol, trial.taskId);
    const repository: RepositoryPin = repositoryById(options.protocol, trial.repositoryId);
    const pinned: RepositoryPin = {
      ...repository,
      commit:
        options.manifest.repositories.find((entry) => entry.id === repository.id)?.commit ??
        repository.commit,
    };

    let attempt = 0;
    let lastRecord: RawRunRecord | undefined;
    let lastRecordPath: string | undefined;
    let infraFailure = false;

    while (attempt <= maxRetries) {
      const workspace = await prepareConditionWorkspace({
        repository: pinned,
        condition: trial.condition,
        ...(options.baseDirectory !== undefined && { baseDirectory: options.baseDirectory }),
        ...(options.fetcher !== undefined && { fetcher: options.fetcher }),
        ...(options.snapshotBuilder !== undefined && { snapshotBuilder: options.snapshotBuilder }),
      });

      try {
        if (trial.condition === "agent-ready") {
          if (options.agentReadyCliPath === undefined) {
            throw new TrialRunnerError(
              "the agent-ready condition needs --agent-ready-cli; running it without snapshot access would be a second raw trial",
            );
          }
          await writeAgentReadyWrapper({
            workspace,
            cliPath: options.agentReadyCliPath,
          });
        }

        const runner = options.createRunner({ trial, task, workspace, attempt });
        const result = await executeTrial({
          runManifestId,
          protocolVersion: options.protocol.manifest.protocolVersion,
          task,
          repositoryId: trial.repositoryId,
          condition: trial.condition,
          runIndex: trial.runIndex,
          config,
          workspace,
          runner,
          commandExecutor: options.commandExecutor,
        });

        // Persist the transcript next to the log, before scoring side effects
        // can touch the checkout. The log itself was written by the runner.
        const transcript = runner.last?.transcript;
        if (transcript !== undefined) {
          await mkdir(transcriptDirectory, { recursive: true });
          await writeFile(
            join(transcriptDirectory, recordFileName(trial)),
            `${JSON.stringify(transcript, null, 2)}\n`,
            "utf8",
          );
        }

        lastRecord = result.record;
        infraFailure = result.record.infrastructureFailure;
        if (!infraFailure) {
          lastRecordPath = recordPath;
          await writeFile(recordPath, `${JSON.stringify(result.record, null, 2)}\n`, "utf8");
        }
      } finally {
        if (options.keepWorkspaces !== true) await removePreparedWorkspace(workspace);
      }

      if (!infraFailure || attempt >= maxRetries) break;
      attempt += 1;
      retried += 1;
      log(
        `retry ${attempt} for ${trial.taskId} (${trial.condition}, run ${String(trial.runIndex)}): ${lastRecord.notes ?? "infrastructure failure"}`,
      );
    }

    if (lastRecord === undefined) {
      outcomes.push({
        trial,
        status: "recorded",
        attempts: attempt + 1,
        infrastructureFailure: true,
      });
      continue;
    }

    tokensUsed += tokensOf(lastRecord);
    recorded += 1;
    outcomes.push({
      trial,
      status: "recorded",
      attempts: attempt + 1,
      ...(lastRecordPath !== undefined ? { recordPath: lastRecordPath } : {}),
      infrastructureFailure: infraFailure,
    });
    const verdict = infraFailure
      ? "infrastructure failure"
      : lastRecord.success
        ? "success"
        : "not successful";
    log(
      `${trial.taskId} (${trial.condition}, run ${trial.runIndex}): ${verdict}` +
        (lastRecordPath === undefined ? "" : ` -> ${recordPath}`),
    );
  }

  return {
    outcomes,
    recorded,
    skipped,
    retried,
    tokensUsed,
    elapsedMs: now() - startedAt,
    ...(aborted !== undefined && { aborted }),
  };
}

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const USAGE =
  "Usage: pnpm research:benchmark-run --out <run-dir> [--manifest <run-manifest.json>] " +
  "[--task <id>] [--repository <id>] [--condition raw|agent-ready] [--runs <n>] [--limit <n>] " +
  "[--agent-ready-cli <built-cli> | --build-agent-ready] [--agent-ready-build-dir <dir>] " +
  "[--codex <command>] [--base-dir <dir>] [--force] " +
  "[--keep-workspaces] [--dry-run]";

function multiples(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const strings = list.filter((entry): entry is string => typeof entry === "string");
  return strings.length > 0 ? strings : undefined;
}

function positiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TrialRunnerError(
      `--${name} must be a positive integer, got ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

/** A checkout-free fetcher for the dry run: it proves plumbing, not preparation. */
const dryRunFetcher: RepositoryFetcher = {
  async checkout(request) {
    await mkdir(request.destination, { recursive: true });
    await writeFile(
      join(request.destination, "package.json"),
      `${JSON.stringify({ name: "dry-run-fixture", private: true }, null, 2)}\n`,
      "utf8",
    );
  },
};

const dryRunSnapshotBuilder: SnapshotBuilder = {
  async build(workspace) {
    const path = join(workspace.runRoot, "snapshot.json");
    await writeFile(
      path,
      `${JSON.stringify({ ok: true, dryRun: true, snapshotVersion: 1 }, null, 2)}\n`,
      "utf8",
    );
    return path;
  },
};

async function main(): Promise<number> {
  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        out: { type: "string" },
        manifest: { type: "string" },
        task: { type: "string", multiple: true },
        repository: { type: "string", multiple: true },
        condition: { type: "string", multiple: true },
        runs: { type: "string" },
        limit: { type: "string" },
        "agent-ready-cli": { type: "string" },
        "agent-ready-build-dir": { type: "string" },
        "build-agent-ready": { type: "boolean", default: false },
        codex: { type: "string" },
        "base-dir": { type: "string" },
        force: { type: "boolean", default: false },
        "keep-workspaces": { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 1;
  }

  const out = values["out"];
  if (typeof out !== "string" || out.length === 0) {
    console.error(USAGE);
    return 1;
  }
  const dryRun = values["dry-run"] === true;

  const manifest = await loadRunManifest(
    typeof values["manifest"] === "string" ? values["manifest"] : DEFAULT_RUN_MANIFEST_PATH,
  );
  const protocol = await loadProtocolForVersion(manifest.protocolVersion);
  assertManifestMatchesProtocol(manifest, protocol.repositories);

  const conditions = multiples(values["condition"]);
  if (conditions !== undefined) {
    const unknown = conditions.filter(
      (entry) => !(CONDITIONS as readonly string[]).includes(entry),
    );
    if (unknown.length > 0) {
      console.error(`unknown condition(s): ${unknown.join(", ")}; expected raw or agent-ready`);
      return 1;
    }
  }

  const plan = planTrials(protocol, {
    seed: manifest.randomizationSeed,
    runsPerTaskPerCondition: positiveInteger(values["runs"], "runs") ?? 3,
    ...(conditions !== undefined && { conditions: conditions as readonly Condition[] }),
    ...(multiples(values["task"]) !== undefined && { taskIds: multiples(values["task"]) }),
    ...(multiples(values["repository"]) !== undefined && {
      repositoryIds: multiples(values["repository"]),
    }),
  });
  const limit = positiveInteger(values["limit"], "limit");
  const selected = limit === undefined ? plan : plan.slice(0, limit);
  if (selected.length === 0) {
    console.error("the selected plan is empty; check --task/--repository/--condition");
    return 1;
  }

  const outputDirectory = dryRun ? join(out, "dry-run") : out;
  const needsAgentReady = selected.some((trial) => trial.condition === "agent-ready");
  const defaultBuildRoot = join(
    REPOSITORY_ROOT,
    BUILD_DIRECTORY,
    `agent-ready-${manifest.agentReadyCommit.slice(0, 12)}`,
  );

  // A dry run writes the wrapper but never executes it, so it needs no build.
  let effectiveAgentReadyCli: string;
  if (dryRun) {
    effectiveAgentReadyCli =
      typeof values["agent-ready-cli"] === "string" ? values["agent-ready-cli"] : "dry-run-cli";
  } else if (!needsAgentReady) {
    effectiveAgentReadyCli = "";
  } else {
    // The CLI is the artifact under test, so it is built at the pinned commit
    // or verified against its build stamp. A path alone proves nothing.
    try {
      const resolved =
        values["build-agent-ready"] === true
          ? await buildAgentReadyCli({
              repositoryRoot: REPOSITORY_ROOT,
              pinnedCommit: manifest.agentReadyCommit,
              outputRoot:
                typeof values["agent-ready-build-dir"] === "string"
                  ? values["agent-ready-build-dir"]
                  : defaultBuildRoot,
            })
          : await verifyAgentReadyCli({
              cliPath:
                typeof values["agent-ready-cli"] === "string"
                  ? values["agent-ready-cli"]
                  : join(defaultBuildRoot, "dist", "cli", "index.js"),
              pinnedCommit: manifest.agentReadyCommit,
            });
      effectiveAgentReadyCli = resolved.cliPath;
      console.log(
        `agent-ready CLI ${resolved.cliPath} (commit ${resolved.buildInfo.commit}, ` +
          `version ${resolved.buildInfo.version ?? "unknown"})`,
      );
    } catch (error) {
      if (error instanceof AgentReadyCliError) {
        console.error(error.message);
        return 1;
      }
      throw error;
    }
  }
  if (!dryRun) {
    const probe = spawnSync(values["codex"] === undefined ? "codex" : String(values["codex"]), [
      "--version",
    ]);
    if (probe.error !== undefined || probe.status !== 0) {
      console.error(
        `codex is not runnable: ${probe.error?.message ?? `exit ${String(probe.status)}`}. ` +
          "Install the client named in the run manifest before running trials.",
      );
      return 1;
    }
  }

  let createRunner: (context: CreateRunnerContext) => TrialRunner;
  if (dryRun) {
    createRunner = () =>
      new FakeAgentRunner(() =>
        emptyObservations({ notes: "dry run: scripted runner, no model session" }),
      );
  } else {
    createRunner = () =>
      new CodexAgentRunner({
        logDirectory: join(outputDirectory, "logs"),
        clientVersion: manifest.agentClient.version,
        ...(typeof values["codex"] === "string" && { codexCommand: values["codex"] }),
      });
  }

  console.log(
    `${dryRun ? "dry run (not protocol data)" : "protocol run"}: ${String(selected.length)} trials ` +
      `from seed ${manifest.randomizationSeed}; manifest ${manifest.id}; out ${outputDirectory}`,
  );
  const outcome = await executeProtocolRun({
    manifest,
    protocol,
    plan: selected,
    outputDirectory,
    createRunner,
    commandExecutor: new NodeCommandExecutor(),
    ...(dryRun && { runManifestId: `${manifest.id}-dry-run` }),
    ...(dryRun && { fetcher: dryRunFetcher, snapshotBuilder: dryRunSnapshotBuilder }),
    ...(needsAgentReady && { agentReadyCliPath: effectiveAgentReadyCli }),
    ...(values["base-dir"] !== undefined && { baseDirectory: String(values["base-dir"]) }),
    force: values["force"] === true,
    keepWorkspaces: values["keep-workspaces"] === true,
  });

  console.log(
    `recorded ${String(outcome.recorded)}, skipped ${String(outcome.skipped)}, ` +
      `retried ${String(outcome.retried)}, tokens ${String(outcome.tokensUsed)}, ` +
      `${String(Math.round(outcome.elapsedMs / 1000))} s`,
  );
  if (outcome.aborted !== undefined) {
    console.error(`aborted: ${outcome.aborted}`);
    return 1;
  }
  if (dryRun) {
    console.log(
      `dry run records are under ${join(outputDirectory, "raw")}; they cite ` +
        `${manifest.id}-dry-run and must not be published as protocol results`,
    );
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

export { main as runTrialCli };
