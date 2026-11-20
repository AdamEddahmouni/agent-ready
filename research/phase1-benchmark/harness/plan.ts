import type { Condition, ProtocolBundle } from "./types.js";
import { CONDITIONS } from "./protocol.js";

/**
 * The trial order is predeclared by the run manifest's seed, not chosen at run
 * time. `planTrials` produces the exact 78-trial plan the manifest describes,
 * and the runner executes it in this order unless a filter narrows it.
 */

export interface PlannedTrial {
  readonly taskId: string;
  readonly repositoryId: string;
  readonly condition: Condition;
  readonly runIndex: number;
}

export interface PlanOptions {
  readonly seed: string;
  readonly runsPerTaskPerCondition?: number;
  readonly conditions?: readonly Condition[];
  readonly taskIds?: readonly string[];
  readonly repositoryIds?: readonly string[];
}

/** FNV-1a over the seed, so a short seed string still spreads across the state. */
function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: small, deterministic, and adequate for ordering trials. */
function randomGenerator(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates with a seeded generator. The same seed always yields the same
 * order on every platform, and every item appears exactly once.
 */
export function orderFromSeed<T>(items: readonly T[], seed: string): T[] {
  const next = randomGenerator(seed);
  const ordered = [...items];
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    const current = ordered[index];
    const other = ordered[swap];
    if (current === undefined || other === undefined) continue;
    ordered[index] = other;
    ordered[swap] = current;
  }
  return ordered;
}

function canonicalTrials(
  protocol: ProtocolBundle,
  options: Required<Pick<PlanOptions, "runsPerTaskPerCondition" | "conditions">> & PlanOptions,
): PlannedTrial[] {
  const taskIds = options.taskIds ?? protocol.tasks.map((task) => task.id);
  const repositoryIds = new Set(
    options.repositoryIds ?? protocol.repositories.map((repository) => repository.id),
  );
  const trials: PlannedTrial[] = [];
  for (const task of protocol.tasks) {
    if (!taskIds.includes(task.id)) continue;
    if (!repositoryIds.has(task.repositoryId)) continue;
    for (const condition of options.conditions) {
      for (let runIndex = 0; runIndex < options.runsPerTaskPerCondition; runIndex += 1) {
        trials.push({
          taskId: task.id,
          repositoryId: task.repositoryId,
          condition,
          runIndex,
        });
      }
    }
  }
  return trials;
}

/**
 * Builds the plan in canonical order (task, condition, run index) and then
 * shuffles it with the manifest seed. Filters narrow the set; the order within
 * a narrowed set is the same as that set's order in the full plan.
 */
export function planTrials(protocol: ProtocolBundle, options: PlanOptions): PlannedTrial[] {
  const runsPerTaskPerCondition = options.runsPerTaskPerCondition ?? 3;
  const conditions = options.conditions ?? CONDITIONS;
  // The full plan is always shuffled as a whole, so a narrowed run follows the
  // same predeclared order as the trials it selects.
  const full = canonicalTrials(protocol, {
    ...options,
    runsPerTaskPerCondition,
    conditions: CONDITIONS,
  });
  const selected = canonicalTrials(protocol, {
    ...options,
    runsPerTaskPerCondition,
    conditions,
  });
  if (selected.length === 0) return [];
  const wanted = new Set(selected.map(trialKey));
  return orderFromSeed(full, options.seed).filter((trial) => wanted.has(trialKey(trial)));
}

export function trialKey(trial: PlannedTrial): string {
  return `${trial.taskId}#${trial.condition}#${String(trial.runIndex)}`;
}

/** One file per trial, so a resumed run can skip what already has a record. */
export function recordFileName(trial: PlannedTrial): string {
  return `${trial.taskId}--${trial.condition}--${String(trial.runIndex)}.json`;
}

export function logFileName(trial: PlannedTrial): string {
  return `${trial.taskId}--${trial.condition}--${String(trial.runIndex)}.jsonl`;
}
