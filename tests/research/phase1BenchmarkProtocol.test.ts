import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";
import {
  evaluateDecision,
  type BenchmarkDecisionRule,
  type BenchmarkMetricSummary,
} from "../../research/phase1-benchmark/evaluate-decision.mjs";

interface ProtocolManifest {
  readonly protocolVersion: number;
  readonly runsPerTaskPerCondition: number;
  readonly conditions: readonly { readonly id: string }[];
}

interface ProtocolRepository {
  readonly id: string;
  readonly commit: string;
}

interface RepositorySet {
  readonly protocolVersion: number;
  readonly repositories: readonly ProtocolRepository[];
}

interface ProtocolOracle {
  readonly type: string;
  readonly clauses?: readonly ProtocolOracle[];
}

interface ProtocolTask {
  readonly id: string;
  readonly repositoryId: string;
  readonly prompt: string;
  readonly successOracle: ProtocolOracle;
  readonly forbidden: readonly string[];
  readonly verificationSurface: readonly string[];
  readonly timeoutMinutes: number;
}

interface TaskSet {
  readonly protocolVersion: number;
  readonly tasks: readonly ProtocolTask[];
}

interface RunManifestTemplate {
  readonly protocolVersion: number;
  readonly repositories: readonly { readonly id: string; readonly commit: string }[];
  readonly runs: {
    readonly perTaskPerCondition: number;
    readonly perCondition: number;
    readonly total: number;
  };
}

const PROTOCOL_DIR = "docs/research/phase1-benchmark-protocol/v1";
const RUN_MANIFEST_SCHEMA_PATH = "schemas/research/phase1-benchmark-run-manifest-v1.schema.json";
const FROZEN_PATHS = [
  "docs/research/phase1-benchmark-protocol/v1/PROTOCOL.md",
  "docs/research/phase1-benchmark-protocol/v1/decision-rule.json",
  "docs/research/phase1-benchmark-protocol/v1/manifest.json",
  "docs/research/phase1-benchmark-protocol/v1/repositories.json",
  "docs/research/phase1-benchmark-protocol/v1/run-manifest.template.json",
  "docs/research/phase1-benchmark-protocol/v1/tasks.json",
  "schemas/research/phase1-benchmark-raw-run-v1.schema.json",
  "schemas/research/phase1-benchmark-run-manifest-v1.schema.json",
];
const SAFETY_METRICS = [
  "invalidAssumptionRate",
  "incorrectDependencyReasoningRate",
  "verificationSelectionFailureRate",
] as const satisfies readonly (keyof BenchmarkMetricSummary)[];
const KNOWN_ORACLE_TYPES = new Set([
  "response-json-path-equals",
  "file-contains",
  "file-json-equals",
  "command-exit-zero",
  "manual-rubric",
  "all-of",
]);

function readProtocolJson(file: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), PROTOCOL_DIR, file), "utf8")) as unknown;
}

const rule = readProtocolJson("decision-rule.json") as BenchmarkDecisionRule;
const runManifestSchema = JSON.parse(readFileSync(RUN_MANIFEST_SCHEMA_PATH, "utf8")) as object;
const runManifestAjv = new Ajv2020({ allErrors: true, strict: true });
const validateRunManifest: ValidateFunction = runManifestAjv.compile(runManifestSchema);

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

function withoutMetric(
  document: Readonly<Record<"raw" | "agent-ready", BenchmarkMetricSummary>>,
  condition: "raw" | "agent-ready",
  metric: keyof BenchmarkMetricSummary,
): Readonly<Record<"raw" | "agent-ready", BenchmarkMetricSummary>> {
  const conditionSummary = { ...document[condition] } as Record<
    keyof BenchmarkMetricSummary,
    number | undefined
  >;
  conditionSummary[metric] = undefined;
  return {
    ...document,
    [condition]: conditionSummary as unknown as BenchmarkMetricSummary,
  };
}

function collectOracleTypes(oracle: ProtocolOracle): string[] {
  const types = [oracle.type];
  for (const clause of oracle.clauses ?? []) {
    types.push(...collectOracleTypes(clause));
  }
  return types;
}

function freezeEntries(): { readonly hash: string; readonly path: string }[] {
  const text = readFileSync(join(process.cwd(), PROTOCOL_DIR, "FROZEN.sha256"), "utf8");
  const entries: { hash: string; path: string }[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(trimmed);
    if (!match) throw new Error(`invalid freeze record line: ${line}`);
    const [, hash, path] = match;
    if (!hash || !path) throw new Error(`invalid freeze record line: ${line}`);
    entries.push({ hash, path });
  }
  return entries;
}

describe("Phase 1 benchmark protocol v1", () => {
  it("freezes exactly five repositories, thirteen tasks, and 78 trials", () => {
    const manifest = readProtocolJson("manifest.json") as ProtocolManifest;
    const repos = readProtocolJson("repositories.json") as RepositorySet;
    const tasks = readProtocolJson("tasks.json") as TaskSet;

    expect(manifest.protocolVersion).toBe(1);
    expect(repos.protocolVersion).toBe(1);
    expect(tasks.protocolVersion).toBe(1);

    expect(repos.repositories).toHaveLength(5);
    expect(new Set(repos.repositories.map((entry) => entry.id)).size).toBe(5);
    expect(tasks.tasks).toHaveLength(13);
    expect(new Set(tasks.tasks.map((task) => task.id)).size).toBe(13);

    expect(manifest.conditions).toHaveLength(2);
    expect(new Set(manifest.conditions.map((condition) => condition.id))).toEqual(
      new Set(["raw", "agent-ready"]),
    );
    expect(manifest.runsPerTaskPerCondition).toBe(3);

    const perCondition = tasks.tasks.length * manifest.runsPerTaskPerCondition;
    expect(perCondition).toBe(39);
    expect(perCondition * manifest.conditions.length).toBe(78);
  });

  it("pins every repository to a full commit SHA and uses every repository", () => {
    const repos = readProtocolJson("repositories.json") as RepositorySet;
    const tasks = readProtocolJson("tasks.json") as TaskSet;
    const repoIds = new Set(repos.repositories.map((entry) => entry.id));

    for (const repo of repos.repositories) {
      expect(repo.id, repo.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(repo.commit, repo.id).toMatch(/^[0-9a-f]{40}$/);
    }
    for (const task of tasks.tasks) {
      expect(repoIds.has(task.repositoryId), task.id).toBe(true);
    }
    expect(new Set(tasks.tasks.map((task) => task.repositoryId)).size).toBe(5);
  });

  it("requires every task to declare its oracle, forbidden actions, verification surface, and timeout", () => {
    const tasks = readProtocolJson("tasks.json") as TaskSet;

    for (const task of tasks.tasks) {
      expect(typeof task.successOracle.type, task.id).toBe("string");
      expect(task.forbidden, task.id).toBeInstanceOf(Array);
      expect(task.verificationSurface, task.id).toBeInstanceOf(Array);
      expect(task.verificationSurface.length, task.id).toBeGreaterThan(0);
      expect(Number.isInteger(task.timeoutMinutes), task.id).toBe(true);
      expect(task.timeoutMinutes, task.id).toBeGreaterThan(0);

      for (const oracleType of collectOracleTypes(task.successOracle)) {
        expect(KNOWN_ORACLE_TYPES.has(oracleType), `${task.id}: ${oracleType}`).toBe(true);
      }
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

  it("compares primary and safety gates as absolute proportion differences", () => {
    // A 4-point success drop passes the absolute 5-point primary gate; a
    // relative 5% gate would reject it because 0.46 < 0.5 * 0.95.
    expect(
      evaluateDecision(
        rule,
        summary({
          raw: { taskSuccessRate: 0.5 },
          treatment: { taskSuccessRate: 0.46, unnecessaryFileReadsMedian: 70 },
        }),
      ),
    ).toBe("helps");

    // A 9-point safety increase passes the absolute 10-point gate; a relative
    // 10% gate would reject it because 0.14 > 0.05 * 1.1.
    expect(
      evaluateDecision(
        rule,
        summary({
          raw: { invalidAssumptionRate: 0.05 },
          treatment: { invalidAssumptionRate: 0.14, unnecessaryFileReadsMedian: 70 },
        }),
      ),
    ).toBe("helps");
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

  it("fails closed when a safety metric is missing on either condition", () => {
    for (const metric of SAFETY_METRICS) {
      for (const condition of ["raw", "agent-ready"] as const) {
        expect(
          evaluateDecision(rule, withoutMetric(summary({}), condition, metric)),
          `${condition} is missing ${metric}`,
        ).toBe("mixed");
      }
    }
  });

  it("fails closed when the benefit metric is missing", () => {
    expect(
      evaluateDecision(
        rule,
        summary({ treatment: { unnecessaryFileReadsMedian: undefined as unknown as number } }),
      ),
    ).toBe("noDemonstratedBenefit");
  });

  it("uses a relative improvement for the benefit gate", () => {
    expect(evaluateDecision(rule, summary({ treatment: { unnecessaryFileReadsMedian: 85 } }))).toBe(
      "helps",
    );
    expect(evaluateDecision(rule, summary({ treatment: { unnecessaryFileReadsMedian: 86 } }))).toBe(
      "noDemonstratedBenefit",
    );
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

  it("throws when the primary metric is missing on either condition", () => {
    for (const condition of ["raw", "agent-ready"] as const) {
      expect(() =>
        evaluateDecision(rule, withoutMetric(summary({}), condition, "taskSuccessRate")),
      ).toThrow(/taskSuccessRate/);
    }
  });

  it("accepts the run-manifest template and rejects trial-arithmetic drift", () => {
    const template = readProtocolJson("run-manifest.template.json") as RunManifestTemplate;
    const repos = readProtocolJson("repositories.json") as RepositorySet;

    expect(
      validateRunManifest(template),
      runManifestAjv.errorsText(validateRunManifest.errors ?? []),
    ).toBe(true);
    expect(template.repositories.map(({ id, commit }) => ({ id, commit }))).toEqual(
      repos.repositories.map(({ id, commit }) => ({ id, commit })),
    );

    const drifted = {
      ...template,
      runs: { ...template.runs, total: 77 },
    };
    expect(
      validateRunManifest(drifted),
      runManifestAjv.errorsText(validateRunManifest.errors ?? []),
    ).toBe(false);
  });

  it("matches the freeze record for every listed v1 artifact and schema", () => {
    const entries = freezeEntries();
    expect(entries.map((entry) => entry.path).sort()).toEqual([...FROZEN_PATHS].sort());

    for (const entry of entries) {
      const digest = createHash("sha256").update(readFileSync(entry.path)).digest("hex");
      expect(digest, `${entry.path} changed after freeze; create v2 instead`).toBe(entry.hash);
    }
  });
});
