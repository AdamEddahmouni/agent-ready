import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateDecision,
  type BenchmarkDecisionRule,
  type BenchmarkMetricSummary,
} from "../../research/phase1-benchmark/evaluate-decision.mjs";

interface ProtocolManifest {
  readonly protocolVersion: number;
  readonly runsPerTaskPerCondition: number;
}

interface RepositorySet {
  readonly protocolVersion: number;
  readonly repositories: readonly { readonly id: string; readonly commit: string }[];
}

interface TaskSet {
  readonly protocolVersion: number;
  readonly tasks: readonly {
    readonly id: string;
    readonly repositoryId: string;
    readonly successOracle: { readonly type: string };
  }[];
}

const PROTOCOL_DIR = "docs/research/phase1-benchmark-protocol/v1";

function readProtocolJson(file: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), PROTOCOL_DIR, file), "utf8")) as unknown;
}

const rule = readProtocolJson("decision-rule.json") as BenchmarkDecisionRule;

function summary(overrides: {
  readonly raw?: Partial<BenchmarkMetricSummary>;
  readonly treatment?: Partial<BenchmarkMetricSummary>;
}): Readonly<Record<"raw" | "agent-ready", BenchmarkMetricSummary>> {
  const base: BenchmarkMetricSummary = {
    taskSuccessRate: 0.8,
    invalidAssumptionRate: 0.1,
    incorrectDependencyReasoningRate: 0.05,
    verificationSelectionFailureRate: 0.1,
    unnecessaryFileReadsMedian: 100,
  };
  return {
    raw: { ...base, ...overrides.raw },
    "agent-ready": { ...base, ...overrides.treatment },
  };
}

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

  it("pins every repository to a full commit SHA", () => {
    const repos = readProtocolJson("repositories.json") as RepositorySet;
    for (const repo of repos.repositories) {
      expect(repo.commit).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("passes the protocol validator", () => {
    const output = execFileSync(
      process.execPath,
      ["research/phase1-benchmark/validate-protocol.mjs"],
      {
        encoding: "utf8",
      },
    );
    expect(output).toContain("protocol v1 ok");
  });

  it("decision rule classifies synthetic summaries", () => {
    expect(
      evaluateDecision(
        rule,
        summary({ treatment: { taskSuccessRate: 0.78, unnecessaryFileReadsMedian: 70 } }),
      ),
    ).toBe("helps");

    expect(evaluateDecision(rule, summary({ treatment: { taskSuccessRate: 0.5 } }))).toBe("harms");

    // Safety thresholds are absolute percentage points: +11pp fails, +10pp passes.
    expect(evaluateDecision(rule, summary({ treatment: { invalidAssumptionRate: 0.21 } }))).toBe(
      "mixed",
    );
    expect(evaluateDecision(rule, summary({ treatment: { invalidAssumptionRate: 0.2 } }))).not.toBe(
      "mixed",
    );
  });

  it("fails closed when a safety metric is missing", () => {
    const missing = summary({});
    const withoutSafety = {
      raw: missing.raw,
      "agent-ready": {
        ...missing["agent-ready"],
        invalidAssumptionRate: undefined as unknown as number,
      },
    };
    expect(evaluateDecision(rule, withoutSafety)).toBe("mixed");
  });

  it("cannot pass the benefit gate on a zero baseline", () => {
    expect(
      evaluateDecision(
        rule,
        summary({
          raw: { unnecessaryFileReadsMedian: 0 },
          treatment: { unnecessaryFileReadsMedian: 0 },
        }),
      ),
    ).toBe("noDemonstratedBenefit");
  });

  it("throws when the primary metric is missing", () => {
    const incomplete = summary({});
    const withoutPrimary = {
      raw: { ...incomplete.raw, taskSuccessRate: undefined as unknown as number },
      "agent-ready": incomplete["agent-ready"],
    };
    expect(() => evaluateDecision(rule, withoutPrimary)).toThrow(/taskSuccessRate/);
  });
});
