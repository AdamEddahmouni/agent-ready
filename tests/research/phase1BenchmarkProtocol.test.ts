import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateDecision } from "../../research/phase1-benchmark/evaluate-decision.mjs";

const rule = JSON.parse(
  readFileSync(
    join(process.cwd(), "docs/research/phase1-benchmark-protocol/v1/decision-rule.json"),
    "utf8",
  ),
);

describe("Phase 1 benchmark protocol v1", () => {
  it("manifest, repositories, and tasks agree on protocol version", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(process.cwd(), "docs/research/phase1-benchmark-protocol/v1/manifest.json"),
        "utf8",
      ),
    );
    const repos = JSON.parse(
      readFileSync(
        join(process.cwd(), "docs/research/phase1-benchmark-protocol/v1/repositories.json"),
        "utf8",
      ),
    );
    const tasks = JSON.parse(
      readFileSync(
        join(process.cwd(), "docs/research/phase1-benchmark-protocol/v1/tasks.json"),
        "utf8",
      ),
    );
    expect(manifest.protocolVersion).toBe(1);
    expect(repos.protocolVersion).toBe(1);
    expect(tasks.protocolVersion).toBe(1);
    expect(tasks.tasks.length).toBeGreaterThanOrEqual(8);
    const ids = new Set(repos.repositories.map((entry: { id: string }) => entry.id));
    for (const task of tasks.tasks as { repositoryId: string }[]) {
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
