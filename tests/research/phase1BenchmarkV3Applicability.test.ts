import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateRuns,
  evaluateAggregateDecision,
} from "../../research/phase1-benchmark/aggregate.js";
import { loadProtocolForVersion } from "../../research/phase1-benchmark/harness/protocol.js";
import {
  recordRawRun,
  validateRawRun,
  type RawRunRecord,
} from "../../research/phase1-benchmark/harness/record.js";
import { executeTrial } from "../../research/phase1-benchmark/harness/run.js";
import {
  FakeAgentRunner,
  emptyObservations,
} from "../../research/phase1-benchmark/harness/fakeRunner.js";
import {
  buildBenchmarkReport,
  renderReportMarkdown,
  type RawRunFile,
} from "../../research/phase1-benchmark/report.js";
import {
  readDecisionRule,
  decisionRulePathFor,
} from "../../research/phase1-benchmark/reproduce.js";

function raw(overrides: Partial<RawRunRecord> = {}): RawRunRecord {
  return {
    protocolVersion: 3,
    runManifestId: "fixture-v3",
    taskId: "task",
    condition: "raw",
    runIndex: 0,
    startTime: "2026-11-20T00:00:00.000Z",
    endTime: "2026-11-20T00:00:01.000Z",
    success: true,
    toolCalls: [],
    fileReads: [],
    fileWrites: [],
    tokenMetrics: { input: null, output: null, cached: null, reasoning: null },
    assumptions: [],
    dependencyReasoningFindings: [],
    verificationSelectionResult: null,
    infrastructureFailure: false,
    ...overrides,
  };
}

function file(record: RawRunRecord, path: string): RawRunFile {
  return {
    record,
    file: path,
    sha256: createHash("sha256").update(JSON.stringify(record)).digest("hex"),
  };
}

describe("protocol v3 applicability without retroactive v1/v2 rewriting", () => {
  it("loads v3 with the same tasks, repositories and decision thresholds as v2", async () => {
    const v2 = await loadProtocolForVersion(2);
    const v3 = await loadProtocolForVersion(3);
    expect(v3.repositories).toEqual(v2.repositories);
    expect(v3.tasks).toEqual(v2.tasks);
    expect(v3.tasks).toHaveLength(13);
    const rule2 = await readDecisionRule(decisionRulePathFor(2));
    const rule3 = await readDecisionRule(decisionRulePathFor(3));
    expect({ ...rule3, protocolVersion: 2 }).toEqual(rule2);
  });

  it("accepts null only in v3; v1/v2 remain strict boolean", () => {
    const noCheck = raw();
    expect(recordRawRun(noCheck).verificationSelectionResult).toBeNull();
    expect(validateRawRun({ ...noCheck, protocolVersion: 1 }).ok).toBe(false);
    expect(validateRawRun({ ...noCheck, protocolVersion: 2 }).ok).toBe(false);
    expect(validateRawRun({ ...noCheck, verificationSelectionResult: false }).ok).toBe(true);
    expect(validateRawRun({ ...noCheck, verificationSelectionResult: true }).ok).toBe(true);
  });

  it("uses the applicable denominator, discloses coverage and renders n/a", async () => {
    const records = [
      raw(),
      raw({ runIndex: 1, verificationSelectionResult: true }),
      raw({ runIndex: 2, verificationSelectionResult: false }),
      raw({ condition: "agent-ready" }),
      raw({ condition: "agent-ready", runIndex: 1, verificationSelectionResult: true }),
    ];
    const result = aggregateRuns(records);
    expect(result.summaries.raw.n).toBe(3);
    expect(result.summaries.raw.verificationSelectionApplicableCount).toBe(2);
    expect(result.summaries.raw.verificationSelectionNotApplicableCount).toBe(1);
    expect(result.summaries.raw.verificationSelectionFailureRate).toBe(0.5);
    expect(result.summaries["agent-ready"].verificationSelectionApplicableCount).toBe(1);
    expect(result.summaries["agent-ready"].verificationSelectionNotApplicableCount).toBe(1);
    expect(result.summaries["agent-ready"].verificationSelectionFailureRate).toBe(0);
    const decision = evaluateAggregateDecision(
      await readDecisionRule(decisionRulePathFor(3)),
      result,
    );
    const report = buildBenchmarkReport({
      rawFiles: records.map((record, index) => file(record, `run-${String(index)}.json`)),
      aggregation: result,
      decision: decision.decision,
    });
    const markdown = renderReportMarkdown(report);
    expect(markdown).toContain("## Verification applicability (v3 only)");
    expect(markdown).toContain("| Overall | raw | 2 | 1 | 3 |");
    expect(
      report.validRuns.filter((run) => run.verificationSelectionFailure === null),
    ).toHaveLength(2);
    expect(markdown).toContain("| n/a |");
    expect(report.limitations.join(" ")).toContain("applicable and not-applicable counts");
  });

  it("keeps a missing applicable safety metric fail-closed", async () => {
    const result = aggregateRuns([raw(), raw({ condition: "agent-ready" })]);
    expect(result.summaries.raw.verificationSelectionFailureRate).toBeNull();
    expect(result.summaries.raw.verificationSelectionApplicableCount).toBe(0);
    expect(
      evaluateAggregateDecision(await readDecisionRule(decisionRulePathFor(3)), result).decision,
    ).toBe("mixed");
  });

  it("records v3 null for no check regardless of a client's self-reported success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phase1-v3-applicability-"));
    try {
      const task = {
        id: "simple",
        repositoryId: "fixture",
        prompt: "Return true",
        successOracle: { type: "response-json-path-equals" as const, path: "ok", value: true },
        forbidden: [],
        verificationSurface: ["package.json"],
        timeoutMinutes: 1,
      };
      const workspace = {
        repositoryId: "fixture",
        commit: "a".repeat(40),
        path: dir,
        runRoot: dir,
      };
      const runner = new FakeAgentRunner(() =>
        emptyObservations({
          finalResponse: '{"ok":true}',
          verificationSelectionResult: true,
        }),
      );
      const commandExecutor = {
        async run() {
          return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
        },
      };
      const common = {
        runManifestId: "fixture",
        task,
        repositoryId: "fixture",
        condition: "raw" as const,
        runIndex: 0,
        config: { modelId: "test", agentClientVersion: "test" },
        workspace,
        runner,
        commandExecutor,
        now: () => Date.parse("2026-11-20T00:00:00.000Z"),
      };
      const v3 = await executeTrial({ ...common, protocolVersion: 3 });
      const v2 = await executeTrial({ ...common, protocolVersion: 2 });
      expect(v3.record.verificationSelectionResult).toBeNull();
      expect(v2.record.verificationSelectionResult).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
