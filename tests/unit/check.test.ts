import { describe, expect, it } from "vitest";
import { runCheck } from "../../src/cli/commands/check.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { FakeGitClient } from "../../src/git/fakeGitClient.js";
import type { ChangedFile, GitClient, GitDiffBase } from "../../src/git/types.js";
import { GitClientError } from "../../src/git/types.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";

function contractFs(protectedPaths: readonly string[] = [".env*"]): InMemoryFileSystem {
  const fs = new InMemoryFileSystem("/repo");
  const paths =
    protectedPaths.length > 0
      ? `paths:\n  protected:\n${protectedPaths.map((p) => `    - "${p}"`).join("\n")}\n`
      : "";
  fs.addFile("/repo/agent-ready.yaml", `version: 1\nproject:\n  name: example\n${paths}`);
  return fs;
}

/** Records how it was called, so tests can assert on the resolved GitDiffBase. */
class RecordingGitClient implements GitClient {
  isRepositoryCalls = 0;
  lastBase: GitDiffBase | undefined;

  constructor(private readonly changedFiles: readonly ChangedFile[] = []) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  async isRepository(): Promise<boolean> {
    this.isRepositoryCalls++;
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  async getChangedFiles(_root: string, base: GitDiffBase): Promise<readonly ChangedFile[]> {
    this.lastBase = base;
    return this.changedFiles;
  }
}

describe("runCheck", () => {
  it("reports success when no changed file matches a protected pattern", async () => {
    const fs = contractFs();
    const git = new FakeGitClient({
      isRepo: true,
      changedFiles: [{ path: "src/index.ts", status: "modified" }],
    });
    const outcome = await runCheck(fs, git, { json: false, staged: false }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("No protected-path violations found.");
  });

  it("flags a changed file matching paths.protected", async () => {
    const fs = contractFs();
    const git = new FakeGitClient({
      isRepo: true,
      changedFiles: [{ path: ".env.local", status: "modified" }],
    });
    const outcome = await runCheck(fs, git, { json: true, staged: false }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as {
      ok: boolean;
      violations: { path: string; pattern: string }[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.violations).toEqual([{ path: ".env.local", pattern: ".env*" }]);
  });

  it("flags a violation if either the old or new path of a rename matches", async () => {
    const fs = contractFs();
    const git = new FakeGitClient({
      isRepo: true,
      changedFiles: [{ path: "config.txt", previousPath: ".env.secret", status: "renamed" }],
    });
    const outcome = await runCheck(fs, git, { json: true, staged: false }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as { violations: { path: string }[] };
    expect(parsed.violations).toEqual([{ path: ".env.secret", pattern: ".env*" }]);
  });

  it("reports GIT_REPOSITORY_NOT_FOUND when the root is not a Git working tree", async () => {
    const fs = contractFs();
    const git = new FakeGitClient({ isRepo: false });
    const outcome = await runCheck(fs, git, { json: true, staged: false }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.CONTRACT_NOT_FOUND);
    const parsed = JSON.parse(outcome.stdout) as { diagnostics: { code: string }[] };
    expect(parsed.diagnostics[0]?.code).toBe("GIT_REPOSITORY_NOT_FOUND");
  });

  it("reports GIT_UNAVAILABLE when the git client throws", async () => {
    const fs = contractFs();
    const git = new FakeGitClient({
      isRepo: true,
      throwOnDiff: new GitClientError("git executable not found"),
    });
    const outcome = await runCheck(fs, git, { json: true, staged: false }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.CONTRACT_NOT_FOUND);
    const parsed = JSON.parse(outcome.stdout) as { diagnostics: { code: string }[] };
    expect(parsed.diagnostics[0]?.code).toBe("GIT_UNAVAILABLE");
  });

  it("passes --staged through as a staged diff base", async () => {
    const fs = contractFs();
    const git = new RecordingGitClient();
    await runCheck(fs, git, { json: false, staged: true }, "/repo");
    expect(git.lastBase).toEqual({ kind: "staged" });
  });

  it("passes --against through as a ref diff base", async () => {
    const fs = contractFs();
    const git = new RecordingGitClient();
    await runCheck(fs, git, { json: false, staged: false, against: "main" }, "/repo");
    expect(git.lastBase).toEqual({ kind: "ref", ref: "main" });
  });

  it("defaults to a working-tree diff base", async () => {
    const fs = contractFs();
    const git = new RecordingGitClient();
    await runCheck(fs, git, { json: false, staged: false }, "/repo");
    expect(git.lastBase).toEqual({ kind: "working-tree" });
  });

  it("returns contract diagnostics unchanged, without calling Git, when the contract is invalid", async () => {
    const fs = new InMemoryFileSystem("/repo");
    fs.addFile("/repo/agent-ready.yaml", "version: 1\nunknownField: true\n");
    const git = new RecordingGitClient();
    const outcome = await runCheck(fs, git, { json: false, staged: false }, "/repo");
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    expect(git.isRepositoryCalls).toBe(0);
  });
});
