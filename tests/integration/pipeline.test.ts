import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadContract } from "../../src/contract/pipeline.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import { createTestRepo } from "./testRepo.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

async function repo(files: Record<string, string>) {
  const testRepo = await createTestRepo(files);
  cleanups.push(testRepo.cleanup);
  return testRepo;
}

describe("loadContract (real file system)", () => {
  it("reports CONTRACT_NOT_FOUND when no contract exists", async () => {
    const { root } = await repo({ "README.md": "hello" });
    const result = await loadContract({ fs: new NodeFileSystem(), startDir: root });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("CONTRACT_NOT_FOUND");
    }
  });

  it("reports YAML_PARSE_FAILED for malformed YAML", async () => {
    const { root } = await repo({ "agent-ready.yaml": "version: [1\n" });
    const result = await loadContract({ fs: new NodeFileSystem(), startDir: root });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("YAML_PARSE_FAILED");
    }
  });

  it("reports YAML_DUPLICATE_KEY for a duplicate top-level key", async () => {
    const { root } = await repo({
      "agent-ready.yaml": "version: 1\nversion: 1\nproject:\n  name: x\n",
    });
    const result = await loadContract({ fs: new NodeFileSystem(), startDir: root });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("YAML_DUPLICATE_KEY");
    }
  });

  it("finds the contract from a nested working directory", async () => {
    const { root } = await repo({
      "agent-ready.yaml": "version: 1\nproject:\n  name: nested-example\n",
      "src/nested/dir/.keep": "",
    });
    const result = await loadContract({
      fs: new NodeFileSystem(),
      startDir: join(root, "src", "nested", "dir"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.repoRoot).toBe(root);
    }
  });

  it("honors an explicit --config path outside the ancestor search", async () => {
    const { root } = await repo({
      "custom/contract.yaml": "version: 1\nproject:\n  name: explicit-config-example\n",
    });
    const result = await loadContract({
      fs: new NodeFileSystem(),
      explicitConfigPath: join(root, "custom", "contract.yaml"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.repoRoot).toBe(join(root, "custom"));
    }
  });

  it("produces identical normalized output across repeated runs (deterministic)", async () => {
    const { root } = await repo({
      "agent-ready.yaml": [
        "version: 1",
        "project:",
        "  name: deterministic-example",
        "commands:",
        "  test:",
        "    run: echo test",
        "  build:",
        "    run: echo build",
        "verification:",
        "  required:",
        "    - build",
        "    - test",
        "",
      ].join("\n"),
    });
    const fs = new NodeFileSystem();
    const first = await loadContract({ fs, startDir: root });
    const second = await loadContract({ fs, startDir: root });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(JSON.stringify(first.value.contract)).toBe(JSON.stringify(second.value.contract));
    }
  });

  it("reports a missing instruction source document", async () => {
    const { root } = await repo({
      "agent-ready.yaml": [
        "version: 1",
        "project:",
        "  name: missing-doc-example",
        "instructions:",
        "  sources:",
        "    - docs/missing.md",
        "",
      ].join("\n"),
    });
    const result = await loadContract({ fs: new NodeFileSystem(), startDir: root });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === "INSTRUCTION_SOURCE_INVALID")).toBe(true);
    }
  });

  it("loads ordered architecture and agent guidance additively", async () => {
    const { root } = await repo({
      "agent-ready.yaml": [
        "version: 1",
        "project:",
        "  name: v0-5-example",
        "architecture:",
        "  boundaries:",
        "    - second",
        "    - first",
        "  key_decisions:",
        "    - file: docs/decisions/0001.md",
        "      summary: Keep it simple.",
        "agents:",
        "  approval_required_for:",
        "    - second approval",
        "    - first approval",
        "  context_files:",
        "    - docs/context.md",
        "",
      ].join("\n"),
    });
    const result = await loadContract({ fs: new NodeFileSystem(), startDir: root });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contract.architecture.boundaries).toEqual(["second", "first"]);
      expect(result.value.contract.architecture.keyDecisions).toEqual([
        { file: "docs/decisions/0001.md", summary: "Keep it simple." },
      ]);
      expect(result.value.contract.agents.approvalRequiredFor).toEqual([
        "second approval",
        "first approval",
      ]);
    }
  });
});
