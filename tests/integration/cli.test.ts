import { afterEach, describe, expect, it } from "vitest";
import { runValidate } from "../../src/cli/commands/validate.js";
import { runInspect } from "../../src/cli/commands/inspect.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";
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

describe("agent-ready validate (CLI composition)", () => {
  it("prints human-readable success output and exits 0", async () => {
    const { root } = await repo({
      "agent-ready.yaml": "version: 1\nproject:\n  name: cli-example\n",
    });
    const outcome = await runValidate(new NodeFileSystem(), { json: false }, root);
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("Contract is valid");
    expect(outcome.stderr).toBe("");
  });

  it("prints valid JSON and exits 0 on success", async () => {
    const { root } = await repo({
      "agent-ready.yaml": "version: 1\nproject:\n  name: cli-json-example\n",
    });
    const outcome = await runValidate(new NodeFileSystem(), { json: true }, root);
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const parsed: unknown = JSON.parse(outcome.stdout);
    expect(parsed).toMatchObject({ ok: true });
  });

  it("exits with CONTRACT_NOT_FOUND when no contract exists", async () => {
    const { root } = await repo({ "README.md": "hello" });
    const outcome = await runValidate(new NodeFileSystem(), { json: false }, root);
    expect(outcome.exitCode).toBe(ExitCode.CONTRACT_NOT_FOUND);
    expect(outcome.stderr).toContain("CONTRACT_NOT_FOUND");
  });

  it("exits with VALIDATION_FAILED for a schema-invalid contract", async () => {
    const { root } = await repo({
      "agent-ready.yaml": "version: 1\nproject:\n  name: bad-example\nunknownField: true\n",
    });
    const outcome = await runValidate(new NodeFileSystem(), { json: false }, root);
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
  });

  it("prints machine-parseable JSON diagnostics on failure", async () => {
    const { root } = await repo({ "README.md": "hello" });
    const outcome = await runValidate(new NodeFileSystem(), { json: true }, root);
    const parsed = JSON.parse(outcome.stdout) as { ok: boolean; diagnostics: { code: string }[] };
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics[0]?.code).toBe("CONTRACT_NOT_FOUND");
  });
});

describe("agent-ready inspect (CLI composition)", () => {
  it("prints a designed human-readable summary", async () => {
    const { root } = await repo({
      "agent-ready.yaml": [
        "version: 1",
        "project:",
        "  name: inspect-example",
        "commands:",
        "  test:",
        "    run: echo hi",
        "",
      ].join("\n"),
    });
    const outcome = await runInspect(new NodeFileSystem(), { json: false }, root);
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("Project: inspect-example");
    expect(outcome.stdout).toContain("test: echo hi");
  });

  it("prints the fully normalized contract as JSON", async () => {
    const { root } = await repo({
      "agent-ready.yaml": "version: 1\nproject:\n  name: inspect-json-example\n",
    });
    const outcome = await runInspect(new NodeFileSystem(), { json: true }, root);
    const parsed = JSON.parse(outcome.stdout) as { ok: boolean; contract: { version: number } };
    expect(parsed.ok).toBe(true);
    expect(parsed.contract.version).toBe(1);
  });

  it("produces byte-identical JSON output across repeated invocations", async () => {
    const { root } = await repo({
      "agent-ready.yaml": "version: 1\nproject:\n  name: stable-example\n",
    });
    const fs = new NodeFileSystem();
    const first = await runInspect(fs, { json: true }, root);
    const second = await runInspect(fs, { json: true }, root);
    expect(first.stdout).toBe(second.stdout);
  });
});
