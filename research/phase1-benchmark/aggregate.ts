import {
  evaluateDecision,
  type BenchmarkDecision,
  type BenchmarkDecisionRule,
  type BenchmarkMetricSummary,
} from "./evaluate-decision.mjs";
import { recordRawRun, type RawRunRecord } from "./harness/record.js";
import type { Condition } from "./harness/types.js";

export interface WilsonInterval {
  readonly lower: number;
  readonly upper: number;
  readonly center: number;
}

export interface MetricVariance {
  readonly taskSuccessRate: number | null;
  readonly invalidAssumptionRate: number | null;
  readonly incorrectDependencyReasoningRate: number | null;
  readonly verificationSelectionFailureRate: number | null;
  /** Sample variance of the per-run unnecessary-read count, not of the median. */
  readonly unnecessaryFileReads: number | null;
}

export interface ConditionAggregate {
  readonly condition: Condition;
  readonly n: number;
  readonly taskSuccessRate: number | null;
  readonly invalidAssumptionRate: number | null;
  readonly incorrectDependencyReasoningRate: number | null;
  readonly verificationSelectionFailureRate: number | null;
  readonly unnecessaryFileReadsMedian: number | null;
  readonly variance: MetricVariance;
  readonly wilson: {
    readonly taskSuccessRate: WilsonInterval | null;
    readonly verificationSelectionFailureRate: WilsonInterval | null;
  };
}

export interface TaskAggregate extends ConditionAggregate {
  readonly taskId: string;
}

export interface ExcludedRun {
  readonly key: string;
  readonly reason: string;
}

export interface AggregationResult {
  readonly summaries: Readonly<Record<Condition, ConditionAggregate>>;
  readonly perTask: readonly TaskAggregate[];
  readonly validRunKeys: readonly string[];
  readonly excludedRuns: readonly ExcludedRun[];
}

export interface RunAdjudication {
  /** Adjudicated count of unnecessary file reads for one run. */
  readonly unnecessaryFileReads?: number;
}

export interface AggregateOptions {
  readonly adjudications?: Readonly<Record<string, RunAdjudication>>;
}

export interface RunMetricValues {
  readonly key: string;
  readonly taskId: string;
  readonly condition: Condition;
  readonly runIndex: number;
  readonly success: boolean;
  readonly invalidAssumptions: number;
  readonly dependencyReasoningFindings: number;
  readonly verificationSelectionFailure: boolean;
  readonly unnecessaryFileReads: number;
  readonly timeToFirstCorrectModification: number | null;
}

export interface DecisionResult {
  readonly summary: Readonly<Record<Condition, BenchmarkMetricSummary>>;
  readonly decision: BenchmarkDecision;
}

/** Stable identifier for a raw trial; the three protocol dimensions are unique. */
export function runKey(
  record: Pick<RawRunRecord, "runManifestId" | "taskId" | "condition" | "runIndex">,
): string {
  return `${record.runManifestId}#${record.taskId}#${record.condition}#${String(record.runIndex)}`;
}

/**
 * Protocol validity is decided before aggregation. Infrastructure failures are
 * excluded; a harness-recorded forbidden action is also excluded because the
 * protocol marks that run invalid rather than retrying it.
 */
export function exclusionReason(record: RawRunRecord): string | null {
  if (record.infrastructureFailure) return "infrastructure-failure";
  const notes = record.notes;
  if (notes === undefined) return null;
  if (notes.split("\n").some((line) => line.startsWith("forbidden "))) {
    return "forbidden-action";
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInvalidAssumption(entry: Record<string, unknown>): boolean {
  const adjudication = entry["adjudication"];
  if (adjudication === "invalid" || adjudication === "contradicted") return true;
  if (entry["invalid"] === true || entry["contradicted"] === true) return true;
  if (entry["valid"] === false) return true;
  if (isRecord(adjudication)) {
    return adjudication["status"] === "invalid" || adjudication["status"] === "contradicted";
  }
  return false;
}

export function invalidAssumptionCount(record: RawRunRecord): number {
  return record.assumptions.filter(isInvalidAssumption).length;
}

function isUnnecessaryRead(entry: Record<string, unknown>): boolean {
  return entry["unnecessary"] === true || entry["classification"] === "unnecessary";
}

function adjudicatedUnnecessaryReads(
  record: RawRunRecord,
  adjudication: RunAdjudication | undefined,
): number {
  const override = adjudication?.unnecessaryFileReads;
  if (override !== undefined) {
    if (!Number.isInteger(override) || override < 0) {
      throw new Error(
        `adjudicated unnecessaryFileReads for ${runKey(record)} must be a non-negative integer`,
      );
    }
    return override;
  }
  return record.fileReads.filter(isUnnecessaryRead).length;
}

export function runMetricValues(
  record: RawRunRecord,
  adjudication?: RunAdjudication,
): RunMetricValues {
  return {
    key: runKey(record),
    taskId: record.taskId,
    condition: record.condition,
    runIndex: record.runIndex,
    success: record.success,
    invalidAssumptions: invalidAssumptionCount(record),
    dependencyReasoningFindings: record.dependencyReasoningFindings.length,
    verificationSelectionFailure: !record.verificationSelectionResult,
    unnecessaryFileReads: adjudicatedUnnecessaryReads(record, adjudication),
    timeToFirstCorrectModification: record.timeToFirstCorrectModification ?? null,
  };
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Sample variance (n − 1); null when fewer than two observations exist. */
export function sampleVariance(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values);
  if (average === null) return null;
  const squared = values.reduce((total, value) => total + (value - average) ** 2, 0);
  return squared / (values.length - 1);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) return null;
  return (left + right) / 2;
}

/** Wilson score interval for a binomial proportion at the requested z value. */
export function wilsonInterval(successes: number, total: number, z = 1.96): WilsonInterval | null {
  if (!Number.isFinite(successes) || !Number.isFinite(total) || total <= 0) return null;
  if (successes < 0 || successes > total || z <= 0) {
    throw new Error("wilsonInterval requires 0 <= successes <= total and z > 0");
  }
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((proportion * (1 - proportion)) / total + (z * z) / (4 * total * total))) /
    denominator;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    center,
  };
}

function aggregateCondition(
  condition: Condition,
  records: readonly RawRunRecord[],
  adjudications: Readonly<Record<string, RunAdjudication>>,
): ConditionAggregate {
  const values = records.map((record) => runMetricValues(record, adjudications[runKey(record)]));
  const successValues = values.map((value) => (value.success ? 1 : 0));
  const invalidAssumptionValues = values.map((value) => value.invalidAssumptions);
  const dependencyValues = values.map((value) => value.dependencyReasoningFindings);
  const verificationFailureValues = values.map((value) =>
    value.verificationSelectionFailure ? 1 : 0,
  );
  const readValues = values.map((value) => value.unnecessaryFileReads);

  return {
    condition,
    n: values.length,
    taskSuccessRate: mean(successValues),
    invalidAssumptionRate: mean(invalidAssumptionValues),
    incorrectDependencyReasoningRate: mean(dependencyValues),
    verificationSelectionFailureRate: mean(verificationFailureValues),
    unnecessaryFileReadsMedian: median(readValues),
    variance: {
      taskSuccessRate: sampleVariance(successValues),
      invalidAssumptionRate: sampleVariance(invalidAssumptionValues),
      incorrectDependencyReasoningRate: sampleVariance(dependencyValues),
      verificationSelectionFailureRate: sampleVariance(verificationFailureValues),
      unnecessaryFileReads: sampleVariance(readValues),
    },
    wilson: {
      taskSuccessRate: wilsonInterval(
        successValues.filter((value) => value === 1).length,
        values.length,
      ),
      verificationSelectionFailureRate: wilsonInterval(
        verificationFailureValues.filter((value) => value === 1).length,
        values.length,
      ),
    },
  };
}

/**
 * Aggregates only schema-valid raw records. Duplicate run keys and unknown
 * adjudication keys are errors, never silently ignored.
 */
export function aggregateRuns(
  inputs: readonly unknown[],
  options: AggregateOptions = {},
): AggregationResult {
  const valid: RawRunRecord[] = [];
  const excluded: ExcludedRun[] = [];
  const seen = new Set<string>();
  const adjudications = options.adjudications ?? {};

  for (const input of inputs) {
    const record = recordRawRun(input);
    const key = runKey(record);
    if (seen.has(key)) throw new Error(`duplicate raw run key ${JSON.stringify(key)}`);
    seen.add(key);
    const reason = exclusionReason(record);
    if (reason === null) valid.push(record);
    else excluded.push({ key, reason });
  }

  for (const key of Object.keys(adjudications)) {
    if (!seen.has(key)) {
      throw new Error(`adjudication references unknown raw run key ${JSON.stringify(key)}`);
    }
  }

  const summaries: Record<Condition, ConditionAggregate> = {
    raw: aggregateCondition(
      "raw",
      valid.filter((record) => record.condition === "raw"),
      adjudications,
    ),
    "agent-ready": aggregateCondition(
      "agent-ready",
      valid.filter((record) => record.condition === "agent-ready"),
      adjudications,
    ),
  };

  const taskIds = [...new Set(valid.map((record) => record.taskId))].sort();
  const perTask: TaskAggregate[] = [];
  for (const taskId of taskIds) {
    for (const condition of ["raw", "agent-ready"] as const) {
      const records = valid.filter(
        (record) => record.taskId === taskId && record.condition === condition,
      );
      if (records.length === 0) continue;
      perTask.push({
        taskId,
        ...aggregateCondition(condition, records, adjudications),
      });
    }
  }

  return {
    summaries,
    perTask,
    validRunKeys: valid.map(runKey).sort(),
    excludedRuns: excluded.sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
    ),
  };
}

function decisionSummary(value: ConditionAggregate): BenchmarkMetricSummary {
  // Nulls are intentionally retained at runtime. The unchanged evaluator
  // treats missing safety metrics as failing and throws for a missing primary
  // metric, which is the protocol's fail-closed policy.
  return {
    taskSuccessRate: value.taskSuccessRate,
    invalidAssumptionRate: value.invalidAssumptionRate,
    incorrectDependencyReasoningRate: value.incorrectDependencyReasoningRate,
    verificationSelectionFailureRate: value.verificationSelectionFailureRate,
    unnecessaryFileReadsMedian: value.unnecessaryFileReadsMedian,
  } as unknown as BenchmarkMetricSummary;
}

/** Calls the unchanged frozen decision evaluator on aggregated metrics. */
export function evaluateAggregateDecision(
  rule: BenchmarkDecisionRule,
  aggregation: AggregationResult,
): DecisionResult {
  const summary: Record<Condition, BenchmarkMetricSummary> = {
    raw: decisionSummary(aggregation.summaries.raw),
    "agent-ready": decisionSummary(aggregation.summaries["agent-ready"]),
  };
  return {
    summary,
    decision: evaluateDecision(rule, summary),
  };
}
