import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConditionAccessError,
  buildAgentPrompt,
  conditionInstructions,
  twinQueryWrapper,
} from "../../research/phase1-benchmark/harness/access.js";
import { buildCodexInvocation } from "../../research/phase1-benchmark/harness/codexRunner.js";
import {
  orderFromSeed,
  planTrials,
  recordFileName,
  trialKey,
} from "../../research/phase1-benchmark/harness/plan.js";
import { loadProtocol } from "../../research/phase1-benchmark/harness/protocol.js";
import type { AgentRunRequest } from "../../research/phase1-benchmark/harness/run.js";

const protocol = await loadProtocol();
const seed = "phase1-v1-2026-11-19-codex-gpt-6.2-sol-8f3c1a";

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runManifestId: "manifest",
    repositoryId: "axios",
    taskId: "axios-03-add-sponsor-data-check",
    condition: "raw",
    runIndex: 0,
    prompt: "the task prompt",
    config: { modelId: "gpt-6.2-sol", agentClientVersion: "0.166.0" },
    workspacePath: "/tmp/run/repo",
    access: {
      condition: "raw",
      shell: true,
      fileRead: true,
      fileWrite: true,
      snapshot: false,
      twinQuery: false,
    },
    timeoutMs: 1_000,
    ...overrides,
  };
}

describe("trial plan", () => {
  it("plans the 78 trials the manifest declares, once each", () => {
    const plan = planTrials(protocol, { seed });
    expect(plan).toHaveLength(78);
    expect(new Set(plan.map(trialKey)).size).toBe(78);
    expect(plan.filter((trial) => trial.condition === "raw")).toHaveLength(39);
    expect(plan.filter((trial) => trial.condition === "agent-ready")).toHaveLength(39);
    for (const trial of plan) {
      expect(protocol.tasks.some((task) => task.id === trial.taskId)).toBe(true);
      expect(trial.runIndex).toBeGreaterThanOrEqual(0);
      expect(trial.runIndex).toBeLessThan(3);
    }
  });

  it("derives the same order from the same seed and a different one otherwise", () => {
    const first = planTrials(protocol, { seed }).map(trialKey);
    const second = planTrials(protocol, { seed }).map(trialKey);
    const other = planTrials(protocol, { seed: `${seed}-other` }).map(trialKey);
    expect(first).toEqual(second);
    expect(other).not.toEqual(first);
    expect([...other].sort()).toEqual([...first].sort());
  });

  it("shuffles rather than emitting the canonical order", () => {
    const canonical = [...planTrials(protocol, { seed })].sort(
      (left, right) =>
        left.taskId.localeCompare(right.taskId) ||
        left.condition.localeCompare(right.condition) ||
        left.runIndex - right.runIndex,
    );
    const shuffled = planTrials(protocol, { seed });
    expect(shuffled).not.toEqual(canonical);
    expect(orderFromSeed([1, 2, 3, 4, 5], seed)).toHaveLength(5);
  });

  it("keeps a filtered plan in the full plan's order", () => {
    const full = planTrials(protocol, { seed });
    const filtered = planTrials(protocol, {
      seed,
      conditions: ["agent-ready"],
      taskIds: ["axios-03-add-sponsor-data-check"],
    });
    expect(filtered).toHaveLength(3);
    const expected = full.filter(
      (trial) =>
        trial.condition === "agent-ready" && trial.taskId === "axios-03-add-sponsor-data-check",
    );
    expect(filtered).toEqual(expected);
    expect(new Set(filtered.map(recordFileName)).size).toBe(3);
  });
});

describe("condition access", () => {
  it("passes the task prompt through and adds only the access block", () => {
    const raw = buildAgentPrompt(request());
    const agentReady = buildAgentPrompt(
      request({
        condition: "agent-ready",
        snapshotPath: "/tmp/run/snapshot.json",
        access: { ...request().access, condition: "agent-ready", snapshot: true, twinQuery: true },
      }),
      "/tmp/run/bin",
    );
    expect(raw.startsWith("the task prompt\n\n")).toBe(true);
    expect(agentReady.startsWith("the task prompt\n\n")).toBe(true);
    expect(raw).toContain("shell and file tools only");
    expect(raw).not.toContain("snapshot");
    expect(agentReady).toContain("/tmp/run/snapshot.json");
    expect(agentReady).toContain("agent-ready twin query --kind");
    expect(agentReady).toContain("/tmp/run/bin");
  });

  it("refuses to describe agent-ready access without a snapshot", () => {
    expect(() => conditionInstructions("agent-ready", { workspacePath: "/tmp/run/repo" })).toThrow(
      ConditionAccessError,
    );
  });

  it("binds the snapshot in the wrapper so the query cannot read another file", () => {
    const wrapper = twinQueryWrapper({
      cliPath: "/srv/agent-ready/dist/cli/index.js",
      snapshotPath: "/tmp/run/snapshot.json",
    });
    expect(wrapper).toContain("#!/bin/sh");
    expect(wrapper).toContain('--snapshot "/tmp/run/snapshot.json"');
    expect(wrapper).toContain('cd "/srv/agent-ready"');
    expect(wrapper).toContain('"$@"');
    // A caller-supplied snapshot would defeat the pin, so the wrapper refuses one.
    expect(wrapper).toContain("--snapshot|--snapshot=*)");
    expect(wrapper).toContain("exit 2");
  });
});

describe("codex invocation", () => {
  it("runs the pinned model in the prepared workspace and names the snapshot wrapper on PATH", () => {
    const raw = buildCodexInvocation(request(), { prompt: "p", baseEnv: { PATH: "/usr/bin" } });
    expect(raw.command).toBe("codex");
    expect(raw.args.slice(0, 3)).toEqual(["exec", "--json", "--skip-git-repo-check"]);
    expect(raw.args).toContain("workspace-write");
    expect(raw.args).toContain("gpt-6.2-sol");
    expect(raw.args[raw.args.length - 1]).toBe("p");
    expect(raw.cwd).toBe("/tmp/run/repo");
    expect(raw.env["PATH"]).toBe("/usr/bin");

    const agentReady = buildCodexInvocation(request(), {
      prompt: "p",
      baseEnv: { PATH: "/usr/bin" },
      binDirectory: "/tmp/run/bin",
    });
    expect(agentReady.env["PATH"]).toBe(`/tmp/run/bin${delimiter}/usr/bin`);
  });
});
