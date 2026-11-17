import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aggregateRuns,
  evaluateAggregateDecision,
  median,
  runKey,
  sampleVariance,
  wilsonInterval,
} from "../../research/phase1-benchmark/aggregate.js";
import {
  evaluateDecision,
  type BenchmarkDecisionRule,
} from "../../research/phase1-benchmark/evaluate-decision.mjs";
import type { RawRunRecord } from "../../research/phase1-benchmark/harness/record.js";

const RULE = JSON.parse(
  readFileSync("docs/research/phase1-benchmark-protocol/v1/decision-rule.json", "utf8"),
) as BenchmarkDecisionRule;

function reads(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `src/file-${String(index)}.ts`,
    unnecessary: true,
  }));
}

function findings(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, () => ({ class: "dependency-scope" }));
}

function invalidAssumptions(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, () => ({
    claim: "a repository fact",
    adjudication: "invalid",
  }));
}

function makeRun(overrides: Partial<RawRunRecord> = {}): RawRunRecord {
  return {
    protocolVersion: 1,
    runManifestId: "manifest-1",
    taskId: "task-a",
    condition: "raw",
    runIndex: 0,
    startTime: "2026-11-17T00:00:00.000Z",
    endTime: "2026-11-17T00:01:00.000Z",
    success: true,
    toolCalls: [],
    fileReads: [],
    fileWrites: [],
    tokenMetrics: { input: null, output: null, cached: null, reasoning: null },
    assumptions: [],
    dependencyReasoningFindings: [],
    verificationSelectionResult: true,
    infrastructureFailure: false,
    ...overrides,
  };
}

interface ConditionOptions {
  readonly n: number;
  readonly successCount: number;
  readonly readCount: number;
  readonly invalidAssumptionCount: number;
  readonly dependencyFindingCount: number;
  readonly verificationFailureCount: number;
}

function conditionRuns(
  condition: "raw" | "agent-ready",
  options: ConditionOptions,
): RawRunRecord[] {
  return Array.from({ length: options.n }, (_, index) =>
    makeRun({
      condition,
      runIndex: index,
      success: index < options.successCount,
      fileReads: reads(options.readCount),
      assumptions: invalidAssumptions(options.invalidAssumptionCount),
      dependencyReasoningFindings: findings(options.dependencyFindingCount),
      verificationSelectionResult: index >= options.verificationFailureCount,
    }),
  );
}

function decisionRuns(
  raw: Partial<ConditionOptions>,
  agentReady: Partial<ConditionOptions>,
): RawRunRecord[] {
  const baseline: ConditionOptions = {
    n: 10,
    successCount: 8,
    readCount: 10,
    invalidAssumptionCount: 0,
    dependencyFindingCount: 0,
    verificationFailureCount: 0,
  };
  return [
    ...conditionRuns("raw", { ...baseline, ...raw }),
    ...conditionRuns("agent-ready", { ...baseline, ...agentReady }),
  ];
}

describe("Wilson intervals and variance", () => {
  it("computes the standard Wilson score interval and rejects invalid counts", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    const interval = wilsonInterval(5, 10);
    expect(interval).not.toBeNull();
    expect(interval?.lower).toBeCloseTo(0.2366, 3);
    expect(interval?.upper).toBeCloseTo(0.7634, 3);
    expect(interval?.center).toBeCloseTo(0.5, 6);
    expect(wilsonInterval(0, 10)?.lower).toBe(0);
    expect(wilsonInterval(10, 10)?.upper).toBe(1);
    expect(() => wilsonInterval(11, 10)).toThrow();
  });

  it("computes sample variance and medians deterministically", () => {
    expect(sampleVariance([])).toBeNull();
    expect(sampleVariance([1])).toBeNull();
    expect(sampleVariance([1, 2, 3])).toBe(1);
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("aggregation", () => {
  it("aggregates every valid run and excludes infrastructure and forbidden runs", () => {
    const records = [
      makeRun({
        runIndex: 0,
        success: true,
        fileReads: reads(1),
        assumptions: invalidAssumptions(1),
      }),
      makeRun({
        runIndex: 1,
        success: false,
        fileReads: reads(2),
        verificationSelectionResult: false,
        dependencyReasoningFindings: findings(1),
      }),
      makeRun({ runIndex: 2, success: true, fileReads: reads(3) }),
      makeRun({ runIndex: 3, infrastructureFailure: true }),
      makeRun({ runIndex: 4, notes: "forbidden modifying any file (modify-any-file): x" }),
      makeRun({ condition: "agent-ready", runIndex: 0, fileReads: reads(0) }),
      makeRun({ condition: "agent-ready", runIndex: 1, fileReads: reads(1) }),
      makeRun({ condition: "agent-ready", runIndex: 2, fileReads: reads(1) }),
    ];

    const result = aggregateRuns(records);
    expect(result.summaries.raw.n).toBe(3);
    expect(result.summaries.raw.taskSuccessRate).toBeCloseTo(2 / 3, 10);
    expect(result.summaries.raw.invalidAssumptionRate).toBeCloseTo(1 / 3, 10);
    expect(result.summaries.raw.incorrectDependencyReasoningRate).toBeCloseTo(1 / 3, 10);
    expect(result.summaries.raw.verificationSelectionFailureRate).toBeCloseTo(1 / 3, 10);
    expect(result.summaries.raw.unnecessaryFileReadsMedian).toBe(2);
    expect(result.summaries.raw.variance.taskSuccessRate).toBeCloseTo(1 / 3, 10);
    expect(result.summaries.raw.wilson.taskSuccessRate).not.toBeNull();
    expect(result.summaries.raw.wilson.taskSuccessRate?.lower).toBeCloseTo(0.2077, 3);
    expect(result.summaries["agent-ready"].taskSuccessRate).toBe(1);
    expect(result.summaries["agent-ready"].unnecessaryFileReadsMedian).toBe(1);
    expect(result.validRunKeys).toHaveLength(6);
    expect(result.excludedRuns).toEqual([
      { key: "manifest-1#task-a#raw#3", reason: "infrastructure-failure" },
      { key: "manifest-1#task-a#raw#4", reason: "forbidden-action" },
    ]);
    expect(result.perTask).toHaveLength(2);
    expect(result.perTask.map((task) => `${task.taskId}:${task.condition}`)).toEqual([
      "task-a:raw",
      "task-a:agent-ready",
    ]);
  });

  it("uses adjudicated unnecessary-read counts and rejects unknown adjudication keys", () => {
    const record = makeRun({ runIndex: 0, fileReads: reads(5) });
    const result = aggregateRuns([record], {
      adjudications: { [runKey(record)]: { unnecessaryFileReads: 2 } },
    });
    expect(result.summaries.raw.unnecessaryFileReadsMedian).toBe(2);
    expect(() =>
      aggregateRuns([record], {
        adjudications: { "unknown#task#raw#0": { unnecessaryFileReads: 1 } },
      }),
    ).toThrow(/unknown raw run key/);
  });

  it("rejects duplicate run keys and schema-invalid records", () => {
    const record = makeRun();
    expect(() => aggregateRuns([record, record])).toThrow(/duplicate raw run key/);
    expect(() => aggregateRuns([{ ...record, success: "yes" }])).toThrow(
      /raw run record failed schema validation/,
    );
  });

  it("returns empty summaries when no valid runs exist and fails the primary gate closed", () => {
    const result = aggregateRuns([]);
    expect(result.summaries.raw.n).toBe(0);
    expect(result.summaries.raw.taskSuccessRate).toBeNull();
    expect(result.summaries.raw.wilson.taskSuccessRate).toBeNull();
    expect(() => evaluateAggregateDecision(RULE, result)).toThrow(/taskSuccessRate/);
  });
});

describe("decision rule integration", () => {
  it("reports all four outcomes from aggregated records", () => {
    const helps = aggregateRuns(decisionRuns({}, { readCount: 5 }));
    expect(evaluateAggregateDecision(RULE, helps).decision).toBe("helps");

    const harms = aggregateRuns(decisionRuns({}, { successCount: 7, readCount: 5 }));
    expect(evaluateAggregateDecision(RULE, harms).decision).toBe("harms");

    const mixed = aggregateRuns(decisionRuns({}, { invalidAssumptionCount: 2, readCount: 5 }));
    expect(evaluateAggregateDecision(RULE, mixed).decision).toBe("mixed");

    const noBenefit = aggregateRuns(decisionRuns({}, { readCount: 9 }));
    expect(evaluateAggregateDecision(RULE, noBenefit).decision).toBe("noDemonstratedBenefit");
  });

  it("fails a safety gate closed when its aggregated metric is missing", () => {
    const summary = {
      raw: {
        taskSuccessRate: 0.8,
        invalidAssumptionRate: undefined,
        incorrectDependencyReasoningRate: 0,
        verificationSelectionFailureRate: 0,
        unnecessaryFileReadsMedian: 10,
      },
      "agent-ready": {
        taskSuccessRate: 0.8,
        invalidAssumptionRate: 0,
        incorrectDependencyReasoningRate: 0,
        verificationSelectionFailureRate: 0,
        unnecessaryFileReadsMedian: 5,
      },
    };
    // The frozen evaluator, not the aggregator, owns this fail-closed policy.
    expect(evaluateDecision(RULE, summary as never)).toBe("mixed");
  });
});
