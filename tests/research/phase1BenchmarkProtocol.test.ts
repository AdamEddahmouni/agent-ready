import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateDecision,
  type BenchmarkDecisionRule,
} from "../../research/phase1-benchmark/evaluate-decision.mjs";

interface ProtocolManifest {
  readonly protocolVersion: number;
  readonly runsPerTaskPerCondition: number;
  readonly tasksFile: string;
}

interface RepositorySet {
  readonly protocolVersion: number;
  readonly repositories: readonly { readonly id: string }[];
}

interface TaskSet {
  readonly protocolVersion: number;
  readonly tasks: readonly { readonly repositoryId: string }[];
}

const PROTOCOL_DIR = "docs/research/phase1-benchmark-protocol/v1";

function readProtocolJson(file: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), PROTOCOL_DIR, file), "utf8")) as unknown;
}

const rule = readProtocolJson("decision-rule.json") as BenchmarkDecisionRule;

describe("Phase 1 benchmark protocol v1", () => {
  it("manifest, repositories, and tasks agree on protocol version", () => {
    const manifest = readProtocolJson("manifest.json") as ProtocolManifest;
    const repos = readProtocolJson("repositories.json") as RepositorySet;
    const tasks = readProtocolJson("tasks.json") as TaskSet;

    expect(manifest.protocolVersion).toBe(1);
    expect(repos.protocolVersion).toBe(1);
    expect(tasks.protocolVersion).toBe(1);
    expect(tasks.tasks.length).toBeGreaterThanOrEqual(8);

    const ids = new Set(repos.repositories.map((entry) => entry.id));
    for (const task of tasks.tasks) {
      expect(ids.has(task.repositoryId)).toBe(true);
    }
  });

  it("decision rule classifies synthetic summaries", () => {
    expect(
      evaluateDecision(rule, {
        raw: {
          taskSuccessRate: 0.8,
          invalidAssumptionRate: 0.1,
          incorrectDependencyReasoningRate: 0.05,
          verificationSelectionFailureRate: 0.1,
          unnecessaryFileReadsMedian: 100,
        },
        "agent-ready": {
          taskSuccessRate: 0.78,
          invalidAssumptionRate: 0.1,
          incorrectDependencyReasoningRate: 0.05,
          verificationSelectionFailureRate: 0.1,
          unnecessaryFileReadsMedian: 70,
        },
      }),
    ).toBe("helps");

    expect(
      evaluateDecision(rule, {
        raw: {
          taskSuccessRate: 0.8,
          invalidAssumptionRate: 0.1,
          incorrectDependencyReasoningRate: 0.05,
          verificationSelectionFailureRate: 0.1,
          unnecessaryFileReadsMedian: 100,
        },
        "agent-ready": {
          taskSuccessRate: 0.5,
          invalidAssumptionRate: 0.1,
          incorrectDependencyReasoningRate: 0.05,
          verificationSelectionFailureRate: 0.1,
          unnecessaryFileReadsMedian: 50,
        },
      }),
    ).toBe("harms");
  });
});
