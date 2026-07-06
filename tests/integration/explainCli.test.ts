import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runExplain } from "../../src/cli/commands/explain.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";
import { createTestRepo } from "./testRepo.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

const CONTRACT_VALID = [
  "version: 1",
  "project:",
  "  name: explain-integration",
  "environment:",
  "  packageManager:",
  "    name: pnpm",
  '    version: "10"',
  "",
].join("\n");

describe("agent-ready explain (CLI composition)", () => {
  it("exits 0 and prints structured human output for a valid code", async () => {
    const fs = new NodeFileSystem();
    const outcome = await runExplain(fs, {
      json: false,
      code: "CONTRACT_NOT_FOUND",
    });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("agent-ready explain CONTRACT_NOT_FOUND");
    expect(outcome.stdout).toContain("What it means:");
    expect(outcome.stdout).toContain("Why it happens:");
    expect(outcome.stdout).toContain("How to fix it:");
  });

  it("exits 0 with JSON envelope for a valid code", async () => {
    const fs = new NodeFileSystem();
    const outcome = await runExplain(fs, {
      json: true,
      code: "PACKAGE_MANAGER_UNAVAILABLE",
    });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const body = JSON.parse(outcome.stdout) as {
      ok: boolean;
      code: string;
      what: string;
      why: string;
      fix: string;
      diagnostics: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.code).toBe("PACKAGE_MANAGER_UNAVAILABLE");
    expect(body.diagnostics).toEqual([]);
  });

  it("exits 1 with error on unknown code", async () => {
    const fs = new NodeFileSystem();
    const outcome = await runExplain(fs, {
      json: false,
      code: "MADE_UP_CODE",
    });
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    expect(outcome.stderr).toContain("MADE_UP_CODE");
  });

  it("includes 'Your contract' section when --config loads a valid contract", async () => {
    const { root, cleanup } = await createTestRepo({
      "agent-ready.yaml": CONTRACT_VALID,
    });
    cleanups.push(cleanup);
    const outcome = await runExplain(
      new NodeFileSystem(),
      {
        json: false,
        code: "PACKAGE_MANAGER_UNAVAILABLE",
        config: join(root, "agent-ready.yaml"),
      },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("Your contract");
    expect(outcome.stdout).toContain("/environment/packageManager");
  });

  it("exits 2 when --config points to a non-existent file", async () => {
    const { root, cleanup } = await createTestRepo({});
    cleanups.push(cleanup);
    const outcome = await runExplain(
      new NodeFileSystem(),
      {
        json: false,
        code: "CONTRACT_NOT_FOUND",
        config: join(root, "agent-ready.yaml"),
      },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.CONTRACT_NOT_FOUND);
  });
});
