import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProtocol } from "../../research/phase1-benchmark/harness/protocol.js";
import {
  buildPilotPlan,
  plannedTrialKey,
  renderPilotPlan,
  selectPilot,
} from "../../research/phase1-benchmark/pilot.js";
import {
  loadRunManifest,
  validateRunManifest,
  validateRunManifestAgainstProtocol,
  type RunManifest,
} from "../../research/phase1-benchmark/run-manifest.js";

const FIXTURE_DIRECTORY = "research/phase1-benchmark/fixtures/pilot";
const MANIFEST_PATH = join(FIXTURE_DIRECTORY, "run-manifest.json");
const PLAN_PATH = join(FIXTURE_DIRECTORY, "plan.json");

function clone(manifest: RunManifest): RunManifest {
  return JSON.parse(JSON.stringify(manifest)) as RunManifest;
}

describe("run manifest validation", () => {
  it("loads the fixture and rejects schema drift", async () => {
    const manifest = await loadRunManifest(MANIFEST_PATH);
    expect(manifest.id).toBe("fixture-pilot-manifest");
    expect(validateRunManifest(manifest).ok).toBe(true);
    expect(validateRunManifest({ ...manifest, runs: { ...manifest.runs, total: 79 } }).ok).toBe(
      false,
    );
    expect(validateRunManifest({ ...manifest, agentReadyCommit: "abc" }).ok).toBe(false);
  });

  it("rejects placeholders, the zero release pin, stale repository pins, and bad arithmetic", async () => {
    const protocol = await loadProtocol();
    const manifest = await loadRunManifest(MANIFEST_PATH);

    const placeholder = clone(manifest);
    (placeholder as { id: string }).id = "REPLACE_WITH_RUN_MANIFEST_ID";
    expect(() => {
      validateRunManifestAgainstProtocol(placeholder, protocol);
    }).toThrow(/REPLACE_WITH_/);

    const zeroPin = clone(manifest);
    (zeroPin as { agentReadyCommit: string }).agentReadyCommit = "0".repeat(40);
    expect(() => {
      validateRunManifestAgainstProtocol(zeroPin, protocol);
    }).toThrow(/all-zero/);

    const stalePin = clone(manifest);
    (stalePin.repositories[0] as { commit: string }).commit = "f".repeat(40);
    expect(() => {
      validateRunManifestAgainstProtocol(stalePin, protocol);
    }).toThrow(/pins .*expected/);

    const badRuns = clone(manifest);
    (badRuns as { runs: RunManifest["runs"] }).runs = {
      perTaskPerCondition: 3,
      perCondition: 38,
      total: 78,
    };
    expect(() => {
      validateRunManifestAgainstProtocol(badRuns, protocol);
    }).toThrow(/runs.perCondition must be 39/);

    const missingBudget = clone(manifest);
    (missingBudget as { budgets: Readonly<Record<string, number>> }).budgets = {
      maxTotalTokens: 1,
    };
    expect(() => {
      validateRunManifestAgainstProtocol(missingBudget, protocol);
    }).toThrow(/maxTotalCostUsd/);
  });
});

describe("pilot dry run", () => {
  it("expands every predeclared trial exactly once and reproducibly", async () => {
    const protocol = await loadProtocol();
    const manifest = await loadRunManifest(MANIFEST_PATH);
    const plan = buildPilotPlan(manifest, protocol);

    expect(plan.schedule).toHaveLength(78);
    expect(new Set(plan.schedule.map((trial) => trial.key)).size).toBe(78);
    expect(plan.schedule.filter((trial) => trial.condition === "raw")).toHaveLength(39);
    expect(plan.schedule.filter((trial) => trial.condition === "agent-ready")).toHaveLength(39);

    for (const task of protocol.tasks) {
      for (const condition of ["raw", "agent-ready"] as const) {
        expect(
          plan.schedule.filter(
            (trial) => trial.taskId === task.id && trial.condition === condition,
          ),
        ).toHaveLength(3);
      }
    }

    expect(plan.pilot).toEqual({
      repositoryId: "axios",
      taskId: "axios-01-identify-test-script",
      runIndex: 0,
      conditions: ["raw", "agent-ready"],
    });
    expect(plan.pilotSchedule).toHaveLength(2);
    expect(plan.pilotSchedule.map((trial) => trial.condition).sort()).toEqual([
      "agent-ready",
      "raw",
    ]);
    expect(plan.pilotSchedule.map((trial) => trial.key).sort()).toEqual([
      plannedTrialKey(manifest.id, "axios-01-identify-test-script", "agent-ready", 0),
      plannedTrialKey(manifest.id, "axios-01-identify-test-script", "raw", 0),
    ]);

    const again = buildPilotPlan(manifest, protocol);
    expect(again).toEqual(plan);
  });

  it("matches the committed plan byte-for-byte", async () => {
    const protocol = await loadProtocol();
    const manifest = await loadRunManifest(MANIFEST_PATH);
    const plan = buildPilotPlan(manifest, protocol);
    expect(renderPilotPlan(plan)).toBe(await readFile(PLAN_PATH, "utf8"));
  });

  it("selects a manual-rubric task for adjudication when requested", async () => {
    const protocol = await loadProtocol();
    const manifest = await loadRunManifest(MANIFEST_PATH);
    const pilot = selectPilot(manifest, protocol, {
      taskId: "jest-01-count-workspace-packages",
      runIndex: 2,
    });
    expect(pilot.repositoryId).toBe("jest");
    expect(pilot.taskId).toBe("jest-01-count-workspace-packages");
    expect(pilot.runIndex).toBe(2);

    expect(() =>
      selectPilot(manifest, protocol, {
        repositoryId: "axios",
        taskId: "jest-01-count-workspace-packages",
      }),
    ).toThrow(/belongs to/);
    expect(() => selectPilot(manifest, protocol, { runIndex: 3 })).toThrow(/runIndex/);
  });
});
