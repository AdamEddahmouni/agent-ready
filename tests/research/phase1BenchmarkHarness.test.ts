import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeTree } from "../../research/phase1-benchmark/harness/removeTree.js";
import { runTwinQuery } from "../../src/cli/commands/twinQuery.js";
import { loadCorpus, runCase } from "../../src/conformance/discovery.js";
import type { FileStat, FileSystem, FileSystemEntry } from "../../src/filesystem/types.js";
import {
  prepareConditionWorkspace,
  type CheckoutRequest,
  type RepositoryFetcher,
  type SnapshotBuilder,
} from "../../research/phase1-benchmark/harness/prepare.js";
import {
  loadProtocol,
  repositoryById,
  taskById,
} from "../../research/phase1-benchmark/harness/protocol.js";
import { validateRawRun } from "../../research/phase1-benchmark/harness/record.js";
import {
  executeTrial,
  type RunConfiguration,
} from "../../research/phase1-benchmark/harness/run.js";
import {
  FakeAgentRunner,
  emptyObservations,
} from "../../research/phase1-benchmark/harness/fakeRunner.js";
import type {
  CommandExecution,
  CommandExecutor,
} from "../../research/phase1-benchmark/harness/score.js";

class FixtureFetcher implements RepositoryFetcher {
  readonly calls: CheckoutRequest[] = [];

  async checkout(request: CheckoutRequest): Promise<void> {
    this.calls.push(request);
    await mkdir(request.destination, { recursive: true });
    await writeFile(join(request.destination, "package.json"), '{"name":"fixture"}\n', "utf8");
  }
}

class FakeCommandExecutor implements CommandExecutor {
  readonly calls: string[] = [];

  async run(command: string): Promise<CommandExecution> {
    this.calls.push(command);
    return await Promise.resolve({
      exitCode: 0,
      timedOut: false,
      stdout: "",
      stderr: "",
    });
  }
}

class SnapshotOnlyFileSystem implements FileSystem {
  readonly cwd = "/";
  readonly reads: string[] = [];
  readonly repositoryAttempts: string[] = [];

  constructor(private readonly snapshot: string) {}

  async readTextFile(absolutePath: string): Promise<string> {
    this.reads.push(absolutePath);
    if (absolutePath !== "/snap.json") {
      this.repositoryAttempts.push(absolutePath);
      throw new Error(`unexpected repository read: ${absolutePath}`);
    }
    return await Promise.resolve(this.snapshot);
  }

  async stat(absolutePath: string): Promise<FileStat | undefined> {
    this.repositoryAttempts.push(absolutePath);
    return await Promise.reject(new Error("twin query must not stat the repository"));
  }

  async listDirectory(absolutePath: string): Promise<readonly FileSystemEntry[]> {
    this.repositoryAttempts.push(absolutePath);
    return await Promise.reject(new Error("twin query must not rescan the repository"));
  }

  async realPath(absolutePath: string): Promise<string> {
    this.repositoryAttempts.push(absolutePath);
    return await Promise.reject(new Error("twin query must not resolve repository paths"));
  }

  async writeTextFile(absolutePath: string): Promise<void> {
    this.repositoryAttempts.push(absolutePath);
    await Promise.reject(new Error("twin query must not write"));
  }
}

const FIXED_NOW = Date.parse("2026-11-17T00:00:00.000Z");
const CONFIG: RunConfiguration = {
  modelId: "fixture-model",
  agentClientVersion: "fixture-client/1.0.0",
  temperature: 0,
};

let baseDirectory: string;

beforeEach(async () => {
  baseDirectory = await mkdtemp(join(tmpdir(), "phase1-harness-test-"));
});

afterEach(async () => {
  await removeTree(baseDirectory);
});

describe("prepared workspace cleanup", () => {
  it("removes a nested tree and tolerates one that is already gone", async () => {
    const tree = join(baseDirectory, "nested");
    await mkdir(join(tree, "a"), { recursive: true });
    await writeFile(join(tree, "a", "file.txt"), "x\n", "utf8");

    await removeTree(tree);

    await expect(readFile(join(tree, "a", "file.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    // Retrying a tree that is already gone must stay a no-op, since a cleanup
    // can run twice when a preparation fails after creating it.
    await expect(removeTree(tree)).resolves.toBeUndefined();
  });
});

describe("Phase 1 harness", () => {
  it("loads five repositories and thirteen tasks from the frozen protocol", async () => {
    const protocol = await loadProtocol();
    expect(protocol.repositories).toHaveLength(5);
    expect(protocol.tasks).toHaveLength(13);
    expect(taskById(protocol, "axios-02-add-devdep").repositoryId).toBe("axios");
    expect(repositoryById(protocol, "axios").commit).toHaveLength(40);
  });

  it("creates isolated checkouts and gives only agent-ready a snapshot", async () => {
    const protocol = await loadProtocol();
    const repository = repositoryById(protocol, "axios");
    const fetcher = new FixtureFetcher();
    let snapshotBuilds = 0;
    const snapshotBuilder: SnapshotBuilder = {
      async build(workspace): Promise<string> {
        snapshotBuilds += 1;
        const path = join(workspace.runRoot, "snapshot.json");
        await writeFile(path, "{}", "utf8");
        return path;
      },
    };

    const raw = await prepareConditionWorkspace({
      repository,
      condition: "raw",
      baseDirectory,
      fetcher,
      snapshotBuilder,
    });
    expect(raw.snapshotPath).toBeUndefined();
    expect(snapshotBuilds).toBe(0);
    expect(fetcher.calls[0]?.commit).toBe(repository.commit);
    expect(await readFile(join(raw.path, "package.json"), "utf8")).toContain("fixture");

    const agentReady = await prepareConditionWorkspace({
      repository,
      condition: "agent-ready",
      baseDirectory,
      fetcher,
      snapshotBuilder,
    });
    expect(snapshotBuilds).toBe(1);
    expect(agentReady.snapshotPath).toBe(join(agentReady.runRoot, "snapshot.json"));
    expect(agentReady.runRoot).not.toBe(raw.runRoot);
    expect(fetcher.calls).toHaveLength(2);
  });

  it("emits schema-valid raw records from a fake two-condition run", async () => {
    const protocol = await loadProtocol();
    const task = taskById(protocol, "axios-02-add-devdep");
    const repository = repositoryById(protocol, task.repositoryId);
    const fetcher = new FixtureFetcher();
    const snapshotBuilder: SnapshotBuilder = {
      async build(workspace): Promise<string> {
        const path = join(workspace.runRoot, "snapshot.json");
        await writeFile(path, "{}", "utf8");
        return path;
      },
    };
    const content = JSON.stringify(
      { name: "fixture", dependencies: { semver: "^7.6.0" } },
      null,
      2,
    );
    const runner = new FakeAgentRunner(async (request) => {
      if (request.condition === "agent-ready" && request.snapshotPath === undefined) {
        throw new Error("agent-ready request had no snapshot");
      }
      await writeFile(join(request.workspacePath, "package.json"), content, "utf8");
      return emptyObservations({
        finalResponse: "Added semver to dependencies.",
        toolCalls: [{ name: "write_file", path: "package.json" }],
        fileReads: [{ path: "package.json", atMs: 100 }],
        fileWrites: [{ path: "package.json", content, atMs: 1000 }],
        tokenMetrics: { input: 100, output: 20, cached: 0, reasoning: 0 },
        verificationSelectionResult: true,
      });
    });
    const rawWorkspace = await prepareConditionWorkspace({
      repository,
      condition: "raw",
      baseDirectory,
      fetcher,
      snapshotBuilder,
    });
    const agentWorkspace = await prepareConditionWorkspace({
      repository,
      condition: "agent-ready",
      baseDirectory,
      fetcher,
      snapshotBuilder,
    });

    let tick = 0;
    const now = (): number => FIXED_NOW + tick++ * 1000;
    const raw = await executeTrial({
      runManifestId: "fixture-manifest",
      task,
      repositoryId: repository.id,
      condition: "raw",
      runIndex: 0,
      config: CONFIG,
      workspace: rawWorkspace,
      runner,
      commandExecutor: new FakeCommandExecutor(),
      now,
    });
    const agentReady = await executeTrial({
      runManifestId: "fixture-manifest",
      task,
      repositoryId: repository.id,
      condition: "agent-ready",
      runIndex: 1,
      config: CONFIG,
      workspace: agentWorkspace,
      runner,
      commandExecutor: new FakeCommandExecutor(),
      now,
    });

    expect(raw.record.success).toBe(true);
    expect(raw.record.timeToFirstCorrectModification).toBe(1);
    expect(raw.score.forbidden).toEqual([]);
    expect(validateRawRun(raw.record).ok).toBe(true);
    expect(agentReady.record.success).toBe(true);
    expect(validateRawRun(agentReady.record).ok).toBe(true);

    expect(raw.request.prompt).toBe(task.prompt);
    expect(agentReady.request.prompt).toBe(raw.request.prompt);
    expect(agentReady.request.config).toEqual(raw.request.config);
    expect(raw.request.access.snapshot).toBe(false);
    expect(raw.request.access.twinQuery).toBe(false);
    expect(raw.request.snapshotPath).toBeUndefined();
    expect(agentReady.request.access.snapshot).toBe(true);
    expect(agentReady.request.access.twinQuery).toBe(true);
    expect(agentReady.request.snapshotPath).toBe(agentWorkspace.snapshotPath);

    expect(runner.requests).toHaveLength(2);
    expect(runner.requests[0]?.condition).toBe("raw");
    expect(runner.requests[1]?.condition).toBe("agent-ready");
  });

  it("rejects a raw record that drifts from the frozen schema", async () => {
    const protocol = await loadProtocol();
    const task = taskById(protocol, "axios-01-identify-test-script");
    const repository = repositoryById(protocol, "axios");
    const runner = new FakeAgentRunner(() =>
      emptyObservations({ finalResponse: '{"script":"test","body":"vitest run"}' }),
    );
    const workspace = await prepareConditionWorkspace({
      repository,
      condition: "raw",
      baseDirectory,
      fetcher: new FixtureFetcher(),
    });
    const result = await executeTrial({
      runManifestId: "fixture-manifest",
      task,
      repositoryId: repository.id,
      condition: "raw",
      runIndex: 0,
      config: CONFIG,
      workspace,
      runner,
      commandExecutor: new FakeCommandExecutor(),
      now: () => FIXED_NOW,
    });
    expect(validateRawRun(result.record).ok).toBe(true);
    expect(validateRawRun({ ...result.record, condition: "other" }).ok).toBe(false);
    expect(validateRawRun({ ...result.record, success: "yes" }).ok).toBe(false);
  });

  it("proves twin query answers from the snapshot and never rescans the repository", async () => {
    const entry = loadCorpus(1).find((candidate) => candidate.metadata.name === "minimal-package");
    if (entry === undefined) throw new Error("minimal-package conformance case missing");
    const snapshotText = await runCase(entry);
    const fs = new SnapshotOnlyFileSystem(snapshotText);

    const outcome = await runTwinQuery(fs, {
      snapshot: "/snap.json",
      kind: "summary",
      json: true,
    });
    expect(outcome.exitCode).toBe(0);
    expect(fs.reads).toEqual(["/snap.json"]);
    expect(fs.repositoryAttempts).toEqual([]);
    const body = JSON.parse(outcome.stdout) as { result: { complete?: boolean } };
    expect(body.result.complete).toBe(true);
  });
});
