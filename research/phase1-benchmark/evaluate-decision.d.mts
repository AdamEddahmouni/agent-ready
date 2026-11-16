/**
 * Types for the Phase 1 decision-rule evaluator, which is plain ESM so the
 * benchmark harness can run it with `node` without a build step.
 */

export interface BenchmarkMetricSummary {
  readonly taskSuccessRate: number;
  readonly invalidAssumptionRate: number;
  readonly incorrectDependencyReasoningRate: number;
  readonly verificationSelectionFailureRate: number;
  readonly unnecessaryFileReadsMedian: number;
}

export interface BenchmarkDecisionRule {
  readonly primaryGate: {
    readonly metric: string;
    readonly condition: string;
    readonly comparedTo: string;
    readonly maxAllowedRelativeDrop: number;
  };
  readonly safetyGates: readonly {
    readonly metric: keyof BenchmarkMetricSummary;
    readonly maxAllowedRelativeIncrease: number;
  }[];
  readonly benefitGate: {
    readonly metric: string;
    readonly minRelativeImprovement: number;
  };
}

export type BenchmarkDecision = "helps" | "noDemonstratedBenefit" | "mixed" | "harms";

export function evaluateDecision(
  rule: BenchmarkDecisionRule,
  summary: Readonly<Record<"raw" | "agent-ready", BenchmarkMetricSummary>>,
): BenchmarkDecision;
