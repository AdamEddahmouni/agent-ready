import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyObservations,
  FakeAgentRunner,
} from "../../research/phase1-benchmark/harness/fakeRunner.js";
import type { RunManifest } from "../../research/phase1-benchmark/harness/manifest.js";
import { planTrials, recordFileName } from "../../research/phase1-benchmark/harness/plan.js";
import { loadProtocol } from "../../research/phase1-benchmark/harness/protocol.js";
import { recordRawRun, type RawRunRecord } from "../../research/phase1-benchmark/harness/record.js";
import type { AgentRunner } from "../../research/phase1-benchmark/harness/run.js";
import type { PreparedConditionWorkspace } from "../../research/phase1-benchmark/harness/prepare.js";
import {
  executeProtocolRun,
  type ProtocolRunOptions,
  type TrialRunner,
} from "../../research/phase1-benchmark/run.js";
import { FakeCommandExecutor, FixtureFetcher, FixtureSnapshotBuilder } from "./harnessDoubles.js";
import { removeTree } from "../../src/filesystem/removeTree.js";

const protocol = await loadProtocol();

function manifest(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    protocolVersion: 1,
    id: "test-manifest",
    createdAt: "2026-11-19T00:00:00Z",
    model: { id: "gpt-6.2-sol", configuration: {} },
    agentClient: { name: "codex-cli", version: "0.166.0" },
    environment: { os: "linux", node: "26.13.0" },
    agentReadyCommit: "a".repeat(40),
    repositories: protocol.repositories.map(({ id, commit }) => ({ id, commit })),
    runs: { perTaskPerCondition: 3, perCondition: 39, total: 78 },
    budgets: {
      maxTotalTokens: 5_000_000,
      maxTotalWallClockMinutes: 60,
      maxInfrastructureRetriesPerTrial: 1,
    },
    randomizationSeed: "test-seed",
    ...overrides,
  };
}

const tasks = ["axios-01-identify-test-script", "axios-02-add-devdep"];

function options(
  outputDirectory: string,
  overrides: Partial<ProtocolRunOptions> = {},
): ProtocolRunOptions {
  return {
    manifest: manifest(),
    protocol,
    plan: planTrials(protocol, { seed: "test-seed", taskIds: tasks, runsPerTaskPerCondition: 1 }),
    outputDirectory,
    createRunner: () => new FakeAgentRunner(() => emptyObservations()),
    agentReadyCliPath: "/srv/agent-ready/dist/cli/index.js",
    commandExecutor: new FakeCommandExecutor(),
    fetcher: new FixtureFetcher(),
    snapshotBuilder: new FixtureSnapshotBuilder(),
    baseDirectory: join(outputDirectory, "workspaces"),
    log: () => undefined,
    ...overrides,
  };
}

async function readRecords(directory: string): Promise<RawRunRecord[]> {
  const names = await readdir(join(directory, "raw"));
  const records: RawRunRecord[] = [];
  for (const name of names.sort()) {
    records.push(recordRawRun(JSON.parse(await readFile(join(directory, "raw", name), "utf8"))));
  }
  return records;
}

describe("trial runner", () => {
  it("writes one schema-valid record per planned trial", async () => {
    const out = await mkdtemp(join(tmpdir(), "phase1-run-"));
    try {
      const outcome = await executeProtocolRun(options(out));
      expect(outcome.recorded).toBe(4);
      expect(outcome.skipped).toBe(0);
      expect(outcome.aborted).toBeUndefined();
      const records = await readRecords(out);
      expect(records).toHaveLength(4);
      expect(records.map((record) => `${record.taskId}#${record.condition}`).sort()).toEqual([
        "axios-01-identify-test-script#agent-ready",
        "axios-01-identify-test-script#raw",
        "axios-02-add-devdep#agent-ready",
        "axios-02-add-devdep#raw",
      ]);
      for (const record of records) {
        expect(record.runManifestId).toBe("test-manifest");
        expect(record.infrastructureFailure).toBe(false);
      }
      for (const trial of options(out).plan) {
        expect(existsSync(join(out, "raw", recordFileName(trial)))).toBe(true);
      }
    } finally {
      await removeTree(out);
    }
  });

  it("resumes by skipping trials that already have a record", async () => {
    const out = await mkdtemp(join(tmpdir(), "phase1-run-"));
    try {
      await executeProtocolRun(options(out));
      const resumed = await executeProtocolRun(options(out));
      expect(resumed.recorded).toBe(0);
      expect(resumed.skipped).toBe(4);
      const forced = await executeProtocolRun(options(out, { force: true }));
      expect(forced.recorded).toBe(4);
    } finally {
      await removeTree(out);
    }
  });

  it("retries an infrastructure failure once and records the successful attempt", async () => {
    const out = await mkdtemp(join(tmpdir(), "phase1-run-"));
    const failures = new Set<string>();
    try {
      const outcome = await executeProtocolRun(
        options(out, {
          plan: planTrials(protocol, {
            seed: "test-seed",
            taskIds: ["axios-01-identify-test-script"],
            runsPerTaskPerCondition: 1,
          }),
          createRunner: ({ trial, attempt }) => {
            const key = `${trial.taskId}#${trial.condition}`;
            if (attempt === 0 && !failures.has(key)) {
              failures.add(key);
              return new FakeAgentRunner(() =>
                emptyObservations({ infrastructureFailure: true, notes: "client crashed" }),
              );
            }
            return new FakeAgentRunner(() => emptyObservations());
          },
        }),
      );
      expect(outcome.retried).toBe(2);
      expect(outcome.recorded).toBe(2);
      expect(outcome.outcomes.map((entry) => entry.attempts)).toEqual([2, 2]);
      const records = await readRecords(out);
      expect(records.every((record) => !record.infrastructureFailure)).toBe(true);
    } finally {
      await removeTree(out);
    }
  });

  it("writes the twin wrapper outside the checkout for agent-ready trials", async () => {
    const out = await mkdtemp(join(tmpdir(), "phase1-run-"));
    const workspaces: PreparedConditionWorkspace[] = [];
    try {
      await executeProtocolRun(
        options(out, {
          plan: planTrials(protocol, {
            seed: "test-seed",
            taskIds: ["axios-02-add-devdep"],
            conditions: ["agent-ready"],
            runsPerTaskPerCondition: 1,
          }),
          agentReadyCliPath: "/srv/agent-ready/dist/cli/index.js",
          keepWorkspaces: true,
          createRunner: ({ workspace }) => {
            workspaces.push(workspace);
            return new FakeAgentRunner(() => emptyObservations());
          },
        }),
      );
      const workspace = workspaces[0];
      expect(workspace?.snapshotPath).toBeDefined();
      const wrapper = join(workspace?.runRoot ?? "", "bin", "agent-ready");
      const content = await readFile(wrapper, "utf8");
      // The wrapper JSON-escapes the path, so compare against the escaped form.
      expect(content).toContain(JSON.stringify(workspace?.snapshotPath ?? "missing"));
      expect(content).toContain("/srv/agent-ready/dist/cli/index.js");
      expect(content).toContain('"$@"');
    } finally {
      for (const workspace of workspaces) await removeTree(workspace.runRoot);
      await removeTree(out);
    }
  });

  it("refuses to run an agent-ready trial without snapshot access", async () => {
    const out = await mkdtemp(join(tmpdir(), "phase1-run-"));
    try {
      await expect(
        executeProtocolRun(
          options(out, {
            plan: planTrials(protocol, {
              seed: "test-seed",
              taskIds: ["axios-02-add-devdep"],
              conditions: ["agent-ready"],
              runsPerTaskPerCondition: 1,
            }),
            agentReadyCliPath: undefined,
          }),
        ),
      ).rejects.toThrow(/--agent-ready-cli/);
    } finally {
      await removeTree(out);
    }
  });

  it("stops on the token budget and marks the rest aborted", async () => {
    const out = await mkdtemp(join(tmpdir(), "phase1-run-"));
    try {
      const outcome = await executeProtocolRun(
        options(out, {
          manifest: manifest({
            budgets: {
              maxTotalTokens: 10,
              maxTotalWallClockMinutes: 60,
              maxInfrastructureRetriesPerTrial: 1,
            },
          }),
          createRunner: () =>
            new FakeAgentRunner(() =>
              emptyObservations({
                tokenMetrics: { input: 1_000, output: 10, cached: 0, reasoning: 0 },
              }),
            ),
        }),
      );
      expect(outcome.recorded).toBe(1);
      expect(outcome.aborted).toContain("token budget exhausted");
      expect(outcome.outcomes.filter((entry) => entry.status === "aborted")).toHaveLength(3);
    } finally {
      await removeTree(out);
    }
  });

  it("keeps the transcripts a live runner produced next to the records", async () => {
    const out = await mkdtemp(join(tmpdir(), "phase1-run-"));
    try {
      const transcript = {
        transcriptVersion: 1 as const,
        taskId: "axios-01-identify-test-script",
        condition: "raw" as const,
        agent: { client: "codex-cli", version: "0.166.0", modelId: "gpt-6.2-sol" },
        provenance: { captured: true },
        startedAt: "2026-11-19T00:00:00Z",
        events: [],
        finalResponse: "",
        usage: { input: 1, output: 1, cached: 0, reasoning: 0 },
      };
      const runner = (): TrialRunner => {
        const base: AgentRunner = new FakeAgentRunner(() => emptyObservations());
        return Object.assign(base, {
          last: { logPath: "", stderrPath: "", transcript, exitCode: 0, timedOut: false },
        });
      };
      await executeProtocolRun(
        options(out, {
          plan: planTrials(protocol, {
            seed: "test-seed",
            taskIds: ["axios-01-identify-test-script"],
            conditions: ["raw"],
            runsPerTaskPerCondition: 1,
          }),
          createRunner: runner,
        }),
      );
      const names = await readdir(join(out, "transcripts"));
      expect(names).toEqual(["axios-01-identify-test-script--raw--0.json"]);
      const saved = JSON.parse(
        await readFile(join(out, "transcripts", names[0] ?? ""), "utf8"),
      ) as { readonly provenance: { readonly captured: boolean } };
      expect(saved.provenance.captured).toBe(true);
    } finally {
      await removeTree(out);
    }
  });
});
