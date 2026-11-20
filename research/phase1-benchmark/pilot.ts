import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CONDITIONS, loadProtocol, repositoryById, taskById } from "./harness/protocol.js";
import type { Condition, ProtocolBundle, TaskDefinition } from "./harness/types.js";
import {
  loadRunManifest,
  validateRunManifestAgainstProtocol,
  type RunManifest,
} from "./run-manifest.js";

export interface PlannedTrial {
  readonly key: string;
  readonly repositoryId: string;
  readonly taskId: string;
  readonly condition: Condition;
  readonly runIndex: number;
}

export interface PilotSelection {
  readonly repositoryId?: string;
  readonly taskId?: string;
  readonly runIndex?: number;
}

export interface PilotPlan {
  readonly protocolVersion: 1;
  readonly runManifestId: string;
  readonly randomizationSeed: string;
  readonly counts: {
    readonly perTaskPerCondition: number;
    readonly perCondition: number;
    readonly total: number;
  };
  readonly pilot: {
    readonly repositoryId: string;
    readonly taskId: string;
    readonly runIndex: number;
    readonly conditions: readonly Condition[];
  };
  readonly schedule: readonly PlannedTrial[];
  readonly pilotSchedule: readonly PlannedTrial[];
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function plannedTrialKey(
  manifestId: string,
  taskId: string,
  condition: Condition,
  runIndex: number,
): string {
  return `${manifestId}#${taskId}#${condition}#${String(runIndex)}`;
}

function seededRank(seed: string, key: string): string {
  return createHash("sha256").update(`${seed}\u0000${key}`).digest("hex");
}

/**
 * Expands the predeclared 3 × 13 × 2 trial set and orders it by
 * SHA-256(seed, key). The order is stable across platforms and Node versions
 * without depending on a mutable PRNG implementation.
 */
export function planTrials(manifest: RunManifest, protocol: ProtocolBundle): PlannedTrial[] {
  const trials: PlannedTrial[] = [];
  for (const task of protocol.tasks) {
    for (const condition of CONDITIONS) {
      for (let runIndex = 0; runIndex < manifest.runs.perTaskPerCondition; runIndex += 1) {
        trials.push({
          key: plannedTrialKey(manifest.id, task.id, condition, runIndex),
          repositoryId: task.repositoryId,
          taskId: task.id,
          condition,
          runIndex,
        });
      }
    }
  }
  return trials.sort((left, right) => {
    const rank = compareKeys(
      seededRank(manifest.randomizationSeed, left.key),
      seededRank(manifest.randomizationSeed, right.key),
    );
    return rank === 0 ? compareKeys(left.key, right.key) : rank;
  });
}

function firstTaskForRepository(protocol: ProtocolBundle, repositoryId: string): TaskDefinition {
  const task = protocol.tasks.find((candidate) => candidate.repositoryId === repositoryId);
  if (task === undefined) {
    throw new Error(`protocol repository ${JSON.stringify(repositoryId)} declares no task`);
  }
  return task;
}

/**
 * Selects the issue-#57 pilot: one repository, one task, one run index per
 * condition. Defaults to the first repository and its first task; an explicit
 * task implies its repository unless the caller pins a conflicting one.
 */
export function selectPilot(
  manifest: RunManifest,
  protocol: ProtocolBundle,
  selection: PilotSelection = {},
): PilotPlan["pilot"] {
  let task: TaskDefinition;
  if (selection.taskId !== undefined) {
    task = taskById(protocol, selection.taskId);
    if (selection.repositoryId !== undefined && selection.repositoryId !== task.repositoryId) {
      throw new Error(
        `pilot task ${JSON.stringify(task.id)} belongs to ${JSON.stringify(task.repositoryId)}, not ${JSON.stringify(selection.repositoryId)}`,
      );
    }
  } else {
    const repositoryId = selection.repositoryId ?? protocol.repositories[0]?.id;
    if (repositoryId === undefined) throw new Error("protocol v1 has no repositories");
    const repository = repositoryById(protocol, repositoryId);
    task = firstTaskForRepository(protocol, repository.id);
  }

  const runIndex = selection.runIndex ?? 0;
  if (
    !Number.isInteger(runIndex) ||
    runIndex < 0 ||
    runIndex >= manifest.runs.perTaskPerCondition
  ) {
    throw new Error(
      `pilot runIndex must be an integer in [0, ${String(manifest.runs.perTaskPerCondition - 1)}]`,
    );
  }

  return {
    repositoryId: task.repositoryId,
    taskId: task.id,
    runIndex,
    conditions: [...CONDITIONS],
  };
}

/** Builds a deterministic dry-run plan without invoking a model or network. */
export function buildPilotPlan(
  manifest: RunManifest,
  protocol: ProtocolBundle,
  selection: PilotSelection = {},
): PilotPlan {
  validateRunManifestAgainstProtocol(manifest, protocol);
  const schedule = planTrials(manifest, protocol);
  const pilot = selectPilot(manifest, protocol, selection);
  const pilotSchedule = schedule.filter(
    (trial) =>
      trial.repositoryId === pilot.repositoryId &&
      trial.taskId === pilot.taskId &&
      trial.runIndex === pilot.runIndex,
  );
  if (pilotSchedule.length !== pilot.conditions.length) {
    throw new Error(
      `pilot selection produced ${String(pilotSchedule.length)} trials, expected ${String(pilot.conditions.length)}`,
    );
  }
  return {
    protocolVersion: 1,
    runManifestId: manifest.id,
    randomizationSeed: manifest.randomizationSeed,
    counts: {
      perTaskPerCondition: manifest.runs.perTaskPerCondition,
      perCondition: manifest.runs.perCondition,
      total: manifest.runs.total,
    },
    pilot,
    schedule,
    pilotSchedule,
  };
}

export function renderPilotPlan(plan: PilotPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function emit(path: string, content: string, check: boolean): Promise<void> {
  if (check) {
    const existing = await readIfPresent(path);
    if (existing === null) throw new Error(`missing pilot plan: ${path}`);
    if (existing !== content) throw new Error(`pilot plan differs: ${path}`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

const USAGE =
  "Usage: tsx research/phase1-benchmark/pilot.ts --manifest <run-manifest.json> [--repository <id>] [--task <id>] [--index <n>] [--out <plan.json>] [--check] [--json]";

async function main(): Promise<void> {
  let values: {
    readonly manifest?: string;
    readonly repository?: string;
    readonly task?: string;
    readonly index?: string;
    readonly out?: string;
    readonly check?: boolean;
    readonly json?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        manifest: { type: "string" },
        repository: { type: "string" },
        task: { type: "string" },
        index: { type: "string" },
        out: { type: "string" },
        check: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (values.manifest === undefined) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (values.check === true && values.out === undefined) {
    console.error("--check requires --out");
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  let runIndex: number | undefined;
  if (values.index !== undefined) {
    runIndex = Number(values.index);
    if (!Number.isInteger(runIndex)) {
      console.error(`--index must be an integer, got ${JSON.stringify(values.index)}`);
      process.exitCode = 1;
      return;
    }
  }

  const protocol = await loadProtocol();
  const manifest = await loadRunManifest(values.manifest);
  const plan = buildPilotPlan(manifest, protocol, {
    ...(values.repository !== undefined && { repositoryId: values.repository }),
    ...(values.task !== undefined && { taskId: values.task }),
    ...(runIndex !== undefined && { runIndex }),
  });

  if (values.out !== undefined) {
    await emit(values.out, renderPilotPlan(plan), values.check ?? false);
  }
  if (values.json === true) {
    console.log(renderPilotPlan(plan).trimEnd());
  } else {
    console.log(
      `${values.check === true ? "verified" : values.out !== undefined ? "wrote" : "planned"} ${String(plan.schedule.length)} trials; pilot=${plan.pilot.repositoryId}/${plan.pilot.taskId}#${String(plan.pilot.runIndex)} for ${plan.pilot.conditions.join(", ")}`,
    );
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
