import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "../../src/cli/commands/doctor.js";
import { FakeBinaryClient } from "../../src/binary/fakeBinaryClient.js";
import { BinaryClientError } from "../../src/binary/types.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import { FakeGitClient } from "../../src/git/fakeGitClient.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";
import { createTestRepo } from "./testRepo.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

const CONTRACT_HEALTHY = [
  "version: 1",
  "project:",
  "  name: doctor-integration",
  "environment:",
  "  runtimes:",
  '    node: ">=20"',
  "  packageManager:",
  "    name: pnpm",
  '    version: "10"',
  "paths:",
  "  protected:",
  '    - ".env*"',
  "",
].join("\n");

describe("agent-ready doctor (CLI composition)", () => {
  it("exits 0 and prints the expected human text on a healthy environment", async () => {
    const { root, cleanup } = await createTestRepo({
      "agent-ready.yaml": CONTRACT_HEALTHY,
    });
    cleanups.push(cleanup);
    const outcome = await runDoctor(
      new NodeFileSystem(),
      new FakeGitClient({ isRepo: true }),
      new FakeBinaryClient({
        probe: {
          git: { version: "git version 2.43.0", path: "/usr/bin/git" },
          pnpm: { version: "10.5.0", path: "/usr/local/bin/pnpm" },
        },
      }),
      { json: false, config: join(root, "agent-ready.yaml") },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("Agent-Ready doctor");
    expect(outcome.stdout).toContain("[pass] runtime-node");
    expect(outcome.stdout).toContain("[pass] package-manager");
    expect(outcome.stdout).toContain("[pass] git-on-path");
    expect(outcome.stdout).toContain("[pass] git-repository");
  });

  it("exits 1 and emits the documented JSON envelope on a failing package manager", async () => {
    const { root, cleanup } = await createTestRepo({
      "agent-ready.yaml": CONTRACT_HEALTHY,
    });
    cleanups.push(cleanup);
    const outcome = await runDoctor(
      new NodeFileSystem(),
      new FakeGitClient({ isRepo: false }),
      new FakeBinaryClient({
        probe: {
          git: { version: "git version 2.43.0", path: "/usr/bin/git" },
          // pnpm omitted = unavailable
        },
      }),
      { json: true, config: join(root, "agent-ready.yaml") },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as {
      ok: boolean;
      checks: { check: string; status: string }[];
      diagnostics: { code: string }[];
    };
    expect(parsed.ok).toBe(false);
    expect(Object.keys(parsed).sort()).toEqual([
      "checks",
      "contractPath",
      "diagnostics",
      "ok",
      "repoRoot",
    ]);
    expect(parsed.checks.find((c) => c.check === "package-manager")?.status).toBe("fail");
    expect(parsed.diagnostics.some((d) => d.code === "PACKAGE_MANAGER_UNAVAILABLE")).toBe(true);
  });

  it("exits 10 (INTERNAL_ERROR) on an underlying git binary throw", async () => {
    const { root, cleanup } = await createTestRepo({
      "agent-ready.yaml": CONTRACT_HEALTHY,
    });
    cleanups.push(cleanup);
    const outcome = await runDoctor(
      new NodeFileSystem(),
      new FakeGitClient({ isRepo: false }),
      new FakeBinaryClient({
        throwOnProbe: new BinaryClientError("git execFile failed"),
      }),
      { json: true, config: join(root, "agent-ready.yaml") },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.INTERNAL_ERROR);
    const parsed = JSON.parse(outcome.stdout) as {
      diagnostics: { code: string }[];
    };
    expect(parsed.diagnostics.some((d) => d.code === "GIT_UNAVAILABLE")).toBe(true);
  });

  it("reports GIT_REQUIRED_BUT_UNAVAILABLE when git is missing and paths.protected is non-empty", async () => {
    const { root, cleanup } = await createTestRepo({
      "agent-ready.yaml": CONTRACT_HEALTHY,
    });
    cleanups.push(cleanup);
    const outcome = await runDoctor(
      new NodeFileSystem(),
      new FakeGitClient({ isRepo: true }),
      new FakeBinaryClient({
        probe: {}, // git unavailable AND pnpm not declared
      }),
      { json: true, config: join(root, "agent-ready.yaml") },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    const parsed = JSON.parse(outcome.stdout) as {
      diagnostics: { code: string; field?: string }[];
    };
    const gitDiag = parsed.diagnostics.find((d) => d.code === "GIT_REQUIRED_BUT_UNAVAILABLE");
    expect(gitDiag).toBeDefined();
    expect(gitDiag?.field).toBe("/paths/protected");
  });

  it("passes the --config-supplied contract path through to discovery", async () => {
    // Place the contract at a non-canonical location and confirm
    // --config-driven discovery finds it without ancestor walking.
    const { root, cleanup } = await createTestRepo({});
    cleanups.push(cleanup);
    const nestedDir = join(root, "nested");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(nestedDir, "agent-ready.yaml"), CONTRACT_HEALTHY, "utf8");
    const outcome = await runDoctor(
      new NodeFileSystem(),
      new FakeGitClient({ isRepo: false }),
      new FakeBinaryClient({
        probe: {
          git: { version: "git version 2.43.0", path: "/usr/bin/git" },
          pnpm: { version: "10.5.0", path: "/usr/local/bin/pnpm" },
        },
      }),
      { json: false, config: join(nestedDir, "agent-ready.yaml") },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    // Doctor surfaces `repoRoot` (the configured file's *parent directory*),
    // never the contract file path itself. Asserting the parent directory
    // confirms --config discovery walked explicitly instead of via the
    // ancestor-walking contract search that would have failed to find the
    // contract at root's top level.
    expect(outcome.stdout).toContain(nestedDir);
  });
});
