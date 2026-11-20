import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";

/**
 * A committed run manifest is the environment a protocol run executes inside:
 * its id is cited by every raw record, and the protocol forbids mutating it
 * after the first trial. Each version's manifest is checked against that
 * version's protocol and schema, and against its own digest, so a value can
 * only change through a deliberate re-freeze.
 */

/** Largest measured session: axios-02, 92,038 input tokens, per captures/README. */
const LARGEST_MEASURED_INPUT_TOKENS = 92_038;

interface RunManifest {
  readonly protocolVersion: number;
  readonly id: string;
  readonly createdAt: string;
  readonly model: { readonly id: string; readonly configuration: Record<string, unknown> };
  readonly agentClient: { readonly name: string; readonly version: string };
  readonly environment: { readonly os: string; readonly node: string };
  readonly agentReadyCommit: string;
  readonly repositories: readonly { readonly id: string; readonly commit: string }[];
  readonly runs: {
    readonly perTaskPerCondition: number;
    readonly perCondition: number;
    readonly total: number;
  };
  readonly budgets: Record<string, number>;
  readonly randomizationSeed: string;
  readonly notes?: string;
}

const SUITES = [
  { version: 1, runDir: "docs/research/phase1-benchmark-run-v1" },
  { version: 2, runDir: "docs/research/phase1-benchmark-run-v2" },
] as const;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as unknown;
}

describe.each(SUITES)("committed run manifest (v$version)", (suite) => {
  const manifestPath = `${suite.runDir}/run-manifest.json`;
  const digestPath = `${suite.runDir}/run-manifest.sha256`;
  const protocolDir = `docs/research/phase1-benchmark-protocol/v${String(suite.version)}`;
  const schemaPath = `schemas/research/phase1-benchmark-run-manifest-v${String(suite.version)}.schema.json`;

  const manifestText = readFileSync(join(process.cwd(), manifestPath), "utf8");
  const manifest = JSON.parse(manifestText) as RunManifest;
  const repositories = readJson(`${protocolDir}/repositories.json`) as {
    readonly repositories: readonly { readonly id: string; readonly commit: string }[];
  };
  const tasks = readJson(`${protocolDir}/tasks.json`) as {
    readonly tasks: readonly { readonly id: string; readonly timeoutMinutes: number }[];
  };
  const schema = readJson(schemaPath) as object;
  const validate: ValidateFunction = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

  function budget(name: string): number {
    const value = manifest.budgets[name];
    if (typeof value !== "number") throw new Error(`run manifest has no numeric budget ${name}`);
    return value;
  }

  it("conforms to its protocol version's frozen schema", () => {
    const valid = validate(manifest);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
    expect(manifest.protocolVersion).toBe(suite.version);
  });

  it("records real values instead of template placeholders", () => {
    expect(manifestText).not.toContain("REPLACE_WITH_");
    expect(manifestText).not.toContain("0000000000000000000000000000000000000000");
    expect(manifest.model.id.length).toBeGreaterThan(0);
    expect(manifest.agentClient.name.length).toBeGreaterThan(0);
    expect(manifest.agentClient.version.length).toBeGreaterThan(0);
    expect(manifest.environment.os.length).toBeGreaterThan(0);
    expect(manifest.environment.node.length).toBeGreaterThan(0);
    expect(manifest.randomizationSeed.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(manifest.createdAt))).toBe(false);
  });

  it("pins the same five repositories as its frozen protocol", () => {
    expect(manifest.repositories.map(({ id, commit }) => ({ id, commit }))).toEqual(
      repositories.repositories.map(({ id, commit }) => ({ id, commit })),
    );
    expect(/^[0-9a-f]{40}$/.test(manifest.agentReadyCommit)).toBe(true);
    expect(manifest.agentReadyCommit).not.toMatch(/^0+$/);
  });

  it("declares run arithmetic that matches the frozen task set", () => {
    expect(manifest.runs.perTaskPerCondition).toBe(3);
    expect(manifest.runs.perCondition).toBe(tasks.tasks.length * 3);
    expect(manifest.runs.perCondition).toBe(39);
    expect(manifest.runs.total).toBe(78);
  });

  it("bounds spend and wall clock above what measurement and the timeouts imply", () => {
    expect(budget("maxTotalTokens")).toBeGreaterThanOrEqual(
      manifest.runs.total * LARGEST_MEASURED_INPUT_TOKENS,
    );
    // Six passes (three runs in each of two conditions) of the declared timeouts.
    const declaredMinutes =
      tasks.tasks.reduce((total, task) => total + task.timeoutMinutes, 0) *
      manifest.runs.perTaskPerCondition *
      2;
    expect(budget("maxTotalWallClockMinutes")).toBeGreaterThanOrEqual(declaredMinutes);
    // Protocol: one retry per infrastructure failure, no replacement runs.
    expect(budget("maxInfrastructureRetriesPerTrial")).toBe(1);
  });

  it("is frozen by digest, so changing it takes a deliberate re-freeze", () => {
    const lines = readFileSync(join(process.cwd(), digestPath), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(lines[0] ?? "");
    expect(match).not.toBeNull();
    const [, recorded, artifact] = match ?? [];
    expect(artifact).toBe(manifestPath);
    const actual = createHash("sha256").update(manifestText).digest("hex");
    expect(actual).toBe(recorded);
  });
});

describe("run manifest versions stay comparable but separate", () => {
  const v1 = readJson("docs/research/phase1-benchmark-run-v1/run-manifest.json") as RunManifest;
  const v2 = readJson("docs/research/phase1-benchmark-run-v2/run-manifest.json") as RunManifest;

  it("gives each version its own id, so records cannot be confused", () => {
    expect(v1.id).not.toBe(v2.id);
    expect(v1.protocolVersion).toBe(1);
    expect(v2.protocolVersion).toBe(2);
    expect(v2.id).toContain("v2");
  });

  it("reuses the v1 seed, so the 78-trial order is the same in both versions", () => {
    expect(v2.randomizationSeed).toBe(v1.randomizationSeed);
  });
});
