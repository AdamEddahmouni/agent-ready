import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "../../src/cli/commands/check.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import { NodeGitClient } from "../../src/git/nodeGitClient.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";
import { createTestGitRepo, createTestRepo, initGitRepo } from "./testRepo.js";

const execFile = promisify(execFileCallback);

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

const CONTRACT_WITH_PROTECTED_ENV = [
  "version: 1",
  "project:",
  "  name: check-example",
  "paths:",
  "  protected:",
  '    - ".env*"',
  "",
].join("\n");

describe("agent-ready check (CLI composition, real Git)", () => {
  it("exits 0 on a clean working tree", async () => {
    const { root, cleanup } = await createTestGitRepo({
      "agent-ready.yaml": CONTRACT_WITH_PROTECTED_ENV,
      "README.md": "hello\n",
    });
    cleanups.push(cleanup);

    const outcome = await runCheck(
      new NodeFileSystem(),
      new NodeGitClient(),
      { json: false, staged: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("No protected-path violations found.");
  });

  it("flags a newly created untracked file matching paths.protected", async () => {
    const { root, cleanup } = await createTestGitRepo({
      "agent-ready.yaml": CONTRACT_WITH_PROTECTED_ENV,
      "README.md": "hello\n",
    });
    cleanups.push(cleanup);

    await writeFile(join(root, ".env.test"), "SECRET=1\n", "utf8");

    const outcome = await runCheck(
      new NodeFileSystem(),
      new NodeGitClient(),
      { json: true, staged: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as {
      ok: boolean;
      violations: { path: string; pattern: string }[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.violations).toEqual([{ path: ".env.test", pattern: ".env*" }]);
  });

  it("flags a modified tracked file matching paths.protected", async () => {
    const { root, cleanup } = await createTestGitRepo({
      "agent-ready.yaml": CONTRACT_WITH_PROTECTED_ENV,
      ".env.production": "SECRET=1\n",
    });
    cleanups.push(cleanup);

    await writeFile(join(root, ".env.production"), "SECRET=2\n", "utf8");

    const outcome = await runCheck(
      new NodeFileSystem(),
      new NodeGitClient(),
      { json: true, staged: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as { violations: { path: string }[] };
    expect(parsed.violations).toEqual([{ path: ".env.production", pattern: ".env*" }]);
  });

  it("only checks staged changes when --staged is passed", async () => {
    const { root, cleanup } = await createTestGitRepo({
      "agent-ready.yaml": CONTRACT_WITH_PROTECTED_ENV,
    });
    cleanups.push(cleanup);

    // Unstaged only: --staged should not see it.
    await writeFile(join(root, ".env.local"), "SECRET=1\n", "utf8");

    const outcome = await runCheck(
      new NodeFileSystem(),
      new NodeGitClient(),
      { json: false, staged: true },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("reports GIT_REPOSITORY_NOT_FOUND outside a Git working tree", async () => {
    const { root, cleanup } = await createTestRepo({
      "agent-ready.yaml": CONTRACT_WITH_PROTECTED_ENV,
    });
    cleanups.push(cleanup);

    const outcome = await runCheck(
      new NodeFileSystem(),
      new NodeGitClient(),
      { json: true, staged: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.CONTRACT_NOT_FOUND);
    const parsed = JSON.parse(outcome.stdout) as { diagnostics: { code: string }[] };
    expect(parsed.diagnostics[0]?.code).toBe("GIT_REPOSITORY_NOT_FOUND");
  });

  it("treats all current files as changed in a fresh repository with no commits", async () => {
    const { root, cleanup } = await createTestRepo({
      "agent-ready.yaml": CONTRACT_WITH_PROTECTED_ENV,
      ".env.fresh": "SECRET=1\n",
    });
    cleanups.push(cleanup);
    await initGitRepo(root);
    await execFile("git", ["add", "-A"], { cwd: root });

    const outcome = await runCheck(
      new NodeFileSystem(),
      new NodeGitClient(),
      { json: true, staged: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as { violations: { path: string }[] };
    expect(parsed.violations).toEqual([{ path: ".env.fresh", pattern: ".env*" }]);
  });

  it("reports GIT_UNAVAILABLE when the given --against ref does not exist", async () => {
    const { root, cleanup } = await createTestGitRepo({
      "agent-ready.yaml": CONTRACT_WITH_PROTECTED_ENV,
    });
    cleanups.push(cleanup);

    const outcome = await runCheck(
      new NodeFileSystem(),
      new NodeGitClient(),
      { json: true, staged: false, against: "does-not-exist" },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.CONTRACT_NOT_FOUND);
    const parsed = JSON.parse(outcome.stdout) as { diagnostics: { code: string }[] };
    expect(parsed.diagnostics[0]?.code).toBe("GIT_UNAVAILABLE");
  });

  it("treats an --against ref that looks like an option as a literal ref, not option injection", async () => {
    const { root, cleanup } = await createTestGitRepo({
      "agent-ready.yaml": CONTRACT_WITH_PROTECTED_ENV,
    });
    cleanups.push(cleanup);

    const outcome = await runCheck(
      new NodeFileSystem(),
      new NodeGitClient(),
      { json: true, staged: false, against: "--upload-pack=false" },
      root,
    );
    // Git rejects this as an unknown/invalid revision rather than treating
    // it as an option — either way, it must surface as a Git error, not a
    // silent success or an actually-executed option.
    expect(outcome.exitCode).toBe(ExitCode.CONTRACT_NOT_FOUND);
    const parsed = JSON.parse(outcome.stdout) as { diagnostics: { code: string }[] };
    expect(parsed.diagnostics[0]?.code).toBe("GIT_UNAVAILABLE");
  });
});
